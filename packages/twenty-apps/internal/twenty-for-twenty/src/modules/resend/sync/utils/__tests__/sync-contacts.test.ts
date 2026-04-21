import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncContacts } from '@modules/resend/sync/utils/sync-contacts';

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

vi.mock(
  '@modules/resend/sync/utils/backfill-resend-emails-from-contacts',
  () => ({
    backfillResendEmailsFromContacts: vi.fn(),
  }),
);

import { findPeopleByEmail } from '@modules/resend/shared/utils/find-people-by-email';
import { backfillResendEmailsFromContacts } from '@modules/resend/sync/utils/backfill-resend-emails-from-contacts';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';

const mockUpsertRecords = upsertRecords as unknown as ReturnType<typeof vi.fn>;
const mockFindPeopleByEmail = findPeopleByEmail as unknown as ReturnType<
  typeof vi.fn
>;
const mockBackfillResendEmailsFromContacts =
  backfillResendEmailsFromContacts as unknown as ReturnType<typeof vi.fn>;

const SYNCED_AT = '2026-01-01T00:00:00.000Z';

const buildResend = (pageContacts: unknown[]): Resend =>
  ({
    contacts: {
      list: vi.fn(async () => ({
        data: { data: pageContacts, has_more: false },
        error: null,
      })),
    },
  }) as unknown as Resend;

describe('syncContacts', () => {
  beforeEach(() => {
    mockUpsertRecords.mockReset();
    mockFindPeopleByEmail.mockReset();
    mockBackfillResendEmailsFromContacts.mockReset();
    mockBackfillResendEmailsFromContacts.mockResolvedValue({
      updated: 0,
      errors: [],
    });
  });

  it('inlines personId into the upsert payload using a single batched lookup', async () => {
    const pageContacts = [
      {
        id: 'contact-1',
        email: 'matched@example.com',
        first_name: 'Matched',
        last_name: 'Person',
        unsubscribed: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'contact-2',
        email: 'unmatched@example.com',
        first_name: 'Unmatched',
        last_name: 'Person',
        unsubscribed: true,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    mockFindPeopleByEmail.mockResolvedValue(
      new Map([['matched@example.com', 'person-1']]),
    );

    mockUpsertRecords.mockResolvedValue({
      result: { fetched: 2, created: 2, updated: 0, errors: [] },
      ok: true,
      twentyIdByResendId: new Map(),
    });

    const client = {} as CoreApiClient;
    const resend = buildResend(pageContacts);

    await syncContacts(resend, client, SYNCED_AT);

    expect(mockFindPeopleByEmail).toHaveBeenCalledTimes(1);

    const upsertCall = mockUpsertRecords.mock.calls[0][0];

    const matched = upsertCall.mapCreateData(undefined, pageContacts[0]);
    const unmatched = upsertCall.mapCreateData(undefined, pageContacts[1]);

    expect(matched.personId).toBe('person-1');
    expect(unmatched.personId).toBeUndefined();
  });

  it('backfills resendEmails with each upserted contact, including personId when known', async () => {
    const pageContacts = [
      {
        id: 'contact-1',
        email: 'Matched@Example.com',
        first_name: 'Matched',
        last_name: 'Person',
        unsubscribed: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'contact-2',
        email: 'unmatched@example.com',
        first_name: 'Unmatched',
        last_name: 'Person',
        unsubscribed: true,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    mockFindPeopleByEmail.mockResolvedValue(
      new Map([['matched@example.com', 'person-1']]),
    );

    mockUpsertRecords.mockResolvedValue({
      result: { fetched: 2, created: 2, updated: 0, errors: [] },
      ok: true,
      twentyIdByResendId: new Map([
        ['contact-1', 'twenty-contact-1'],
        ['contact-2', 'twenty-contact-2'],
      ]),
    });

    const client = {} as CoreApiClient;
    const resend = buildResend(pageContacts);

    await syncContacts(resend, client, SYNCED_AT);

    expect(mockBackfillResendEmailsFromContacts).toHaveBeenCalledTimes(1);

    const [, entriesByEmail] =
      mockBackfillResendEmailsFromContacts.mock.calls[0];

    expect(entriesByEmail).toEqual(
      new Map([
        [
          'matched@example.com',
          { contactId: 'twenty-contact-1', personId: 'person-1' },
        ],
        ['unmatched@example.com', { contactId: 'twenty-contact-2' }],
      ]),
    );
  });

  it('skips backfill entries for contacts whose upsert did not return a Twenty id', async () => {
    const pageContacts = [
      {
        id: 'contact-1',
        email: 'one@example.com',
        first_name: null,
        last_name: null,
        unsubscribed: false,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'contact-2',
        email: 'two@example.com',
        first_name: null,
        last_name: null,
        unsubscribed: false,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    mockFindPeopleByEmail.mockResolvedValue(new Map());

    mockUpsertRecords.mockResolvedValue({
      result: { fetched: 2, created: 1, updated: 0, errors: [] },
      ok: true,
      twentyIdByResendId: new Map([['contact-1', 'twenty-contact-1']]),
    });

    const client = {} as CoreApiClient;
    const resend = buildResend(pageContacts);

    await syncContacts(resend, client, SYNCED_AT);

    expect(mockBackfillResendEmailsFromContacts).toHaveBeenCalledTimes(1);

    const [, entriesByEmail] =
      mockBackfillResendEmailsFromContacts.mock.calls[0];

    expect(entriesByEmail).toEqual(
      new Map([['one@example.com', { contactId: 'twenty-contact-1' }]]),
    );
  });
});
