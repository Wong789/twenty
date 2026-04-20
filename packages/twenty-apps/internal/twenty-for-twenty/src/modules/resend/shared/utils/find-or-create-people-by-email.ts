import { isNonEmptyString } from '@sniptt/guards';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

type PersonName = {
  firstName?: string;
  lastName?: string;
};

export type FindOrCreatePersonInput = {
  email: string | undefined | null;
  name?: PersonName;
};

type PeopleConnection = {
  edges: Array<{
    node: { id: string; emails?: { primaryEmail?: string | null } | null };
  }>;
};

const normalize = (email: string): string => email.trim().toLowerCase();

const PERSON_CREATION_CONCURRENCY = 5;

const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (true) {
        const currentIndex = nextIndex++;

        if (currentIndex >= tasks.length) return;

        results[currentIndex] = await tasks[currentIndex]();
      }
    },
  );

  await Promise.all(workers);

  return results;
};

export const findOrCreatePeopleByEmail = async (
  client: CoreApiClient,
  inputs: ReadonlyArray<FindOrCreatePersonInput>,
): Promise<Map<string, string>> => {
  const personIdByEmail = new Map<string, string>();

  const validInputs = inputs.filter(
    (input): input is { email: string; name?: PersonName } =>
      isNonEmptyString(input.email),
  );

  if (validInputs.length === 0) return personIdByEmail;

  const dedupedInputs = new Map<string, FindOrCreatePersonInput>();

  for (const input of validInputs) {
    const key = normalize(input.email as string);

    if (!dedupedInputs.has(key)) {
      dedupedInputs.set(key, input);
    }
  }

  const emailKeys = Array.from(dedupedInputs.keys());

  const { people } = await client.query({
    people: {
      __args: {
        filter: {
          emails: {
            primaryEmail: { in: emailKeys },
          },
        },
        first: emailKeys.length,
      },
      edges: {
        node: {
          id: true,
          emails: { primaryEmail: true },
        },
      },
    },
  });

  for (const edge of (people as PeopleConnection | undefined)?.edges ?? []) {
    const primaryEmail = edge.node.emails?.primaryEmail;

    if (isNonEmptyString(primaryEmail)) {
      personIdByEmail.set(normalize(primaryEmail), edge.node.id);
    }
  }

  const missingInputs = emailKeys
    .filter((key) => !personIdByEmail.has(key))
    .map((key) => dedupedInputs.get(key))
    .filter((input): input is FindOrCreatePersonInput => isDefined(input));

  const tasks = missingInputs.map((input) => async () => {
    const { createPerson } = await client.mutation({
      createPerson: {
        __args: {
          data: {
            name: {
              firstName: input.name?.firstName ?? '',
              lastName: input.name?.lastName ?? '',
            },
            emails: {
              primaryEmail: input.email,
            },
          },
        },
        id: true,
      },
    });

    const id = (createPerson as { id: string } | undefined)?.id;

    if (isDefined(id) && isNonEmptyString(input.email)) {
      personIdByEmail.set(normalize(input.email), id);
    }
  });

  await runWithConcurrency(tasks, PERSON_CREATION_CONCURRENCY);

  return personIdByEmail;
};
