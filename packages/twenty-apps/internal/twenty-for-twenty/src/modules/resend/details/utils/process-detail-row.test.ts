import type { Resend } from 'resend';
import type { CoreApiClient } from 'twenty-client-sdk/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DETAILS_FETCH_MAX_RETRIES } from '@modules/resend/constants/sync-config';
import type { DetailToFetchRow } from '@modules/resend/details/types/detail-to-fetch';
import { processDetailRow } from '@modules/resend/details/utils/process-detail-row';

const makeClient = () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const mutation = vi.fn(async (m: Record<string, unknown>) => {
    mutationCalls.push(m);

    return { updateResendEmail: { id: 'ok' } };
  });

  const client = { mutation, query: vi.fn() } as unknown as CoreApiClient;

  return { client, mutationCalls };
};

const makeResend = (overrides: {
  getEmail?: ReturnType<typeof vi.fn>;
  getBroadcast?: ReturnType<typeof vi.fn>;
  getTemplate?: ReturnType<typeof vi.fn>;
}): Resend =>
  ({
    emails: {
      get:
        overrides.getEmail ??
        vi.fn(async () => ({
          data: {
            html: '<p>hi</p>',
            text: 'hi',
            tags: [{ name: 'src', value: 'unit' }],
          },
          error: null,
        })),
    },
    broadcasts: {
      get:
        overrides.getBroadcast ??
        vi.fn(async () => ({
          data: {
            subject: 'sub',
            from: 'a@b.com',
            reply_to: null,
            preview_text: 'pre',
          },
          error: null,
        })),
    },
    templates: {
      get:
        overrides.getTemplate ??
        vi.fn(async () => ({
          data: {
            subject: 'sub',
            from: 'a@b.com',
            reply_to: null,
            html: '<p>t</p>',
            text: 't',
          },
          error: null,
        })),
    },
  }) as unknown as Resend;

const findUpdateForObject = (
  calls: Array<Record<string, unknown>>,
  objectKey: string,
): Record<string, unknown> | undefined => {
  for (const call of calls) {
    if (objectKey in call) {
      const block = call[objectKey] as
        | { __args?: { data?: Record<string, unknown> } }
        | undefined;

      if (block?.__args?.data !== undefined) {
        return block.__args.data;
      }
    }
  }

  return undefined;
};

const baseRow = (
  overrides: Partial<DetailToFetchRow> = {},
): DetailToFetchRow => ({
  id: 'row-id',
  entityType: 'EMAIL',
  resendId: 'email_abc',
  twentyRecordId: 'twenty-abc',
  status: 'PENDING',
  retryCount: 0,
  lastError: null,
  queuedAt: '2020-01-01T00:00:00.000Z',
  processedAt: null,
  ...overrides,
});

describe('processDetailRow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('fetches email detail and marks the row DONE', async () => {
    const { client, mutationCalls } = makeClient();
    const resend = makeResend({});

    const outcome = await processDetailRow(resend, client, baseRow());

    expect(outcome.status).toBe('done');

    const emailUpdate = findUpdateForObject(mutationCalls, 'updateResendEmail');

    expect(emailUpdate).toMatchObject({
      htmlBody: '<p>hi</p>',
      textBody: 'hi',
    });

    const rowUpdate = findUpdateForObject(
      mutationCalls,
      'updateResendDetailToFetch',
    );

    expect(rowUpdate).toMatchObject({ status: 'DONE' });
  });

  it('routes BROADCAST rows to the broadcast processor', async () => {
    const { client, mutationCalls } = makeClient();
    const resend = makeResend({});

    const outcome = await processDetailRow(
      resend,
      client,
      baseRow({
        entityType: 'BROADCAST',
        resendId: 'bc_1',
        twentyRecordId: 'twenty-bc-1',
      }),
    );

    expect(outcome.status).toBe('done');

    const broadcastUpdate = findUpdateForObject(
      mutationCalls,
      'updateResendBroadcast',
    );

    expect(broadcastUpdate).toBeDefined();
  });

  it('routes TEMPLATE rows to the template processor', async () => {
    const { client, mutationCalls } = makeClient();
    const resend = makeResend({});

    const outcome = await processDetailRow(
      resend,
      client,
      baseRow({
        entityType: 'TEMPLATE',
        resendId: 'tmpl_1',
        twentyRecordId: 'twenty-tmpl-1',
      }),
    );

    expect(outcome.status).toBe('done');

    const templateUpdate = findUpdateForObject(
      mutationCalls,
      'updateResendTemplate',
    );

    expect(templateUpdate).toBeDefined();
  });

  it('marks the row as pending-retry when below the retry cap', async () => {
    const { client, mutationCalls } = makeClient();
    const resend = makeResend({
      getEmail: vi.fn(async () => ({ data: null, error: { message: 'nope' } })),
    });

    const outcome = await processDetailRow(
      resend,
      client,
      baseRow({ retryCount: 0 }),
    );

    expect(outcome.status).toBe('pending-retry');

    const rowUpdate = findUpdateForObject(
      mutationCalls,
      'updateResendDetailToFetch',
    );

    expect(rowUpdate).toMatchObject({ status: 'PENDING', retryCount: 1 });
  });

  it('marks the row as FAILED once the retry cap is hit', async () => {
    const { client, mutationCalls } = makeClient();
    const resend = makeResend({
      getEmail: vi.fn(async () => ({ data: null, error: { message: 'nope' } })),
    });

    const outcome = await processDetailRow(
      resend,
      client,
      baseRow({ retryCount: DETAILS_FETCH_MAX_RETRIES - 1 }),
    );

    expect(outcome.status).toBe('failed');

    const rowUpdate = findUpdateForObject(
      mutationCalls,
      'updateResendDetailToFetch',
    );

    expect(rowUpdate).toMatchObject({
      status: 'FAILED',
      retryCount: DETAILS_FETCH_MAX_RETRIES,
    });
  });
});
