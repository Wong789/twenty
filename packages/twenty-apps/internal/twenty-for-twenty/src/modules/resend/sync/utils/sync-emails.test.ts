import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncEmails } from '@modules/resend/sync/utils/sync-emails';

vi.mock('@modules/resend/sync/utils/upsert-records', () => ({
  upsertRecords: vi.fn(),
}));

vi.mock('@modules/resend/sync/cursor/utils/with-sync-cursor', () => ({
  withSyncCursor: async (
    _client: unknown,
    _step: unknown,
    fn: (ctx: {
      resumeCursor: undefined;
      onCursorAdvance: (cursor: string) => Promise<void>;
    }) => Promise<unknown>,
  ) =>
    fn({
      resumeCursor: undefined,
      onCursorAdvance: async () => undefined,
    }),
}));

vi.mock('@modules/resend/shared/utils/with-rate-limit-retry', () => ({
  withRateLimitRetry: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@modules/resend/shared/utils/find-people-by-email', () => ({
  findPeopleByEmail: vi.fn(),
}));

import { findPeopleByEmail } from '@modules/resend/shared/utils/find-people-by-email';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';

const mockUpsertRecords = upsertRecords as unknown as ReturnType<typeof vi.fn>;
const mockFindPeopleByEmail = findPeopleByEmail as unknown as ReturnType<
  typeof vi.fn
>;

const SYNCED_AT = '2026-01-01T00:00:00.000Z';

const buildResend = (pageEmails: unknown[]): Resend =>
  ({
    emails: {
      list: vi.fn(async () => ({
        data: { data: pageEmails, has_more: false },
        error: null,
      })),
    },
  }) as unknown as Resend;

describe('syncEmails', () => {
  beforeEach(() => {
    mockUpsertRecords.mockReset();
    mockFindPeopleByEmail.mockReset();
  });

  it('looks up people once per page and inlines personId into the upsert payload', async () => {
    const pageEmails = [
      {
        id: 'email-1',
        subject: 'hello',
        from: 'sender@example.com',
        to: ['matched@example.com'],
        cc: null,
        bcc: null,
        reply_to: null,
        last_event: 'delivered',
        created_at: '2026-01-01T00:00:00Z',
        scheduled_at: null,
      },
      {
        id: 'email-2',
        subject: 'world',
        from: 'sender@example.com',
        to: ['unmatched@example.com'],
        cc: null,
        bcc: null,
        reply_to: null,
        last_event: 'delivered',
        created_at: '2026-01-01T00:00:00Z',
        scheduled_at: null,
      },
    ];

    mockFindPeopleByEmail.mockResolvedValue(
      new Map([['matched@example.com', 'person-1']]),
    );

    mockUpsertRecords.mockResolvedValue({
      result: { fetched: 2, created: 2, updated: 0, errors: [] },
      ok: true,
      twentyIdByResendId: new Map([
        ['email-1', 'twenty-email-1'],
        ['email-2', 'twenty-email-2'],
      ]),
    });

    const client = {} as CoreApiClient;
    const resend = buildResend(pageEmails);

    await syncEmails(resend, client, SYNCED_AT);

    expect(mockFindPeopleByEmail).toHaveBeenCalledTimes(1);
    expect(mockFindPeopleByEmail).toHaveBeenCalledWith(client, [
      'matched@example.com',
      'unmatched@example.com',
    ]);

    const upsertCall = mockUpsertRecords.mock.calls[0][0];

    expect(upsertCall.items).toBe(pageEmails);

    const matchedDto = upsertCall.mapCreateData(undefined, pageEmails[0]);
    const unmatchedDto = upsertCall.mapCreateData(undefined, pageEmails[1]);

    expect(matchedDto.personId).toBe('person-1');
    expect(unmatchedDto.personId).toBeUndefined();
  });
});
