import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { APPLICATION_UNIVERSAL_IDENTIFIER } from '@constants/universal-identifiers';
import { isDefined } from '@utils/is-defined';
import { describe, expect, it } from 'vitest';

describe('App installation', () => {
  it('should find the installed app in the applications list', async () => {
    const client = new MetadataApiClient();

    const result = await client.query({
      findManyApplications: {
        id: true,
        name: true,
        universalIdentifier: true,
      },
    });

    const matchingApplication = result.findManyApplications.find(
      (application: { universalIdentifier: string }) =>
        application.universalIdentifier === APPLICATION_UNIVERSAL_IDENTIFIER,
    );

    expect(matchingApplication).toBeDefined();
  });
});

describe('CoreApiClient', () => {
  it('should support CRUD on standard objects', async () => {
    const client = new CoreApiClient();

    const created = await client.mutation({
      createNote: {
        __args: { data: { title: 'Integration test note' } },
        id: true,
      },
    });
    const createdNote = created.createNote;

    expect(createdNote?.id).toBeDefined();

    if (isDefined(createdNote)) {
      await client.mutation({
        destroyNote: {
          __args: { id: createdNote.id },
          id: true,
        },
      });
    }
  });

  it('should support CRUD on resendDetailToFetch objects', async () => {
    const client = new CoreApiClient();
    const createMutationName: string = 'createResendDetailToFetch';
    const destroyMutationName: string = 'destroyResendDetailToFetch';

    const createResult = (await client.mutation({
      [createMutationName]: {
        __args: {
          data: {
            entityType: 'EMAIL',
            resendId: 'test_integration_email_1',
            twentyRecordId: 'test-twenty-id-1',
            status: 'PENDING',
            retryCount: 0,
            queuedAt: new Date().toISOString(),
          },
        },
        id: true,
      },
    })) as unknown as Record<string, { id: string } | undefined>;

    const created = createResult[createMutationName];

    expect(created?.id).toBeDefined();

    if (created !== undefined) {
      await client.mutation({
        [destroyMutationName]: {
          __args: { id: created.id },
          id: true,
        },
      });
    }
  });
});
