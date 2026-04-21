import { isDefined } from '@utils/is-defined';
import type { Resend } from 'resend';
import { CoreApiClient } from 'twenty-client-sdk/core';

import { findPeopleByEmail } from '@modules/resend/shared/utils/find-people-by-email';
import { forEachPage } from '@modules/resend/shared/utils/for-each-page';
import { mapLastEvent } from '@modules/resend/shared/utils/map-last-event';
import { toEmailsField } from '@modules/resend/shared/utils/to-emails-field';
import {
  toIsoString,
  toIsoStringOrNull,
} from '@modules/resend/shared/utils/to-iso-string';
import { withSyncCursor } from '@modules/resend/sync/cursor/utils/with-sync-cursor';
import type { CreateEmailDto } from '@modules/resend/sync/types/create-email.dto';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import type { UpdateEmailDto } from '@modules/resend/sync/types/update-email.dto';
import { upsertRecords } from '@modules/resend/sync/utils/upsert-records';

export type SyncEmailsOptions = {
  stopBeforeCreatedAtMs?: number;
  resumable?: boolean;
  deadlineAtMs?: number;
};

export const syncEmails = async (
  resend: Resend,
  client: CoreApiClient,
  syncedAt: string,
  options?: SyncEmailsOptions,
): Promise<SyncStepResult> => {
  const aggregate: SyncResult = {
    fetched: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  const resumable = options?.resumable ?? true;
  const stopBeforeCreatedAtMs = options?.stopBeforeCreatedAtMs;
  const cutoffTimestampMs = isDefined(stopBeforeCreatedAtMs)
    ? Date.now() - stopBeforeCreatedAtMs
    : undefined;

  await withSyncCursor(
    client,
    'EMAILS',
    async ({ resumeCursor, onCursorAdvance }) => {
      const { completed } = await forEachPage(
        (paginationParameters) => resend.emails.list(paginationParameters),
        async (pageEmails) => {
          const primaryToByEmail = new Map<string, string>();

          for (const email of pageEmails) {
            const primaryTo = Array.isArray(email.to) ? email.to[0] : email.to;

            if (typeof primaryTo === 'string' && primaryTo.length > 0) {
              primaryToByEmail.set(email.id, primaryTo);
            }
          }

          const personIdByEmail = await findPeopleByEmail(
            client,
            Array.from(primaryToByEmail.values()),
          );

          const resolvePersonId = (resendEmailId: string): string | undefined => {
            const primaryTo = primaryToByEmail.get(resendEmailId);

            if (!isDefined(primaryTo)) return undefined;

            return personIdByEmail.get(primaryTo.trim().toLowerCase());
          };

          const pageOutcome = await upsertRecords({
            items: pageEmails,
            getId: (email) => email.id,
            mapCreateData: (_detail, email): CreateEmailDto => {
              const mappedLastEvent = mapLastEvent(email.last_event);
              const personId = resolvePersonId(email.id);

              return {
                subject: email.subject,
                fromAddress: toEmailsField(email.from),
                toAddresses: toEmailsField(email.to),
                ccAddresses: toEmailsField(email.cc),
                bccAddresses: toEmailsField(email.bcc),
                replyToAddresses: toEmailsField(email.reply_to),
                ...(isDefined(mappedLastEvent) && {
                  lastEvent: mappedLastEvent,
                }),
                createdAt: toIsoString(email.created_at),
                scheduledAt: toIsoStringOrNull(email.scheduled_at),
                lastSyncedFromResend: syncedAt,
                ...(isDefined(personId) && { personId }),
              };
            },
            mapUpdateData: (_detail, email): UpdateEmailDto => {
              const mappedLastEvent = mapLastEvent(email.last_event);
              const personId = resolvePersonId(email.id);

              return {
                subject: email.subject,
                fromAddress: toEmailsField(email.from),
                toAddresses: toEmailsField(email.to),
                ccAddresses: toEmailsField(email.cc),
                bccAddresses: toEmailsField(email.bcc),
                replyToAddresses: toEmailsField(email.reply_to),
                ...(isDefined(mappedLastEvent) && {
                  lastEvent: mappedLastEvent,
                }),
                scheduledAt: toIsoStringOrNull(email.scheduled_at),
                lastSyncedFromResend: syncedAt,
                ...(isDefined(personId) && { personId }),
              };
            },
            client,
            objectNameSingular: 'resendEmail',
            objectNamePlural: 'resendEmails',
          });

          aggregate.fetched += pageOutcome.result.fetched;
          aggregate.created += pageOutcome.result.created;
          aggregate.updated += pageOutcome.result.updated;
          aggregate.errors.push(...pageOutcome.result.errors);

          const reachedCutoff =
            isDefined(cutoffTimestampMs) &&
            pageEmails.some(
              (email) =>
                new Date(email.created_at).getTime() < cutoffTimestampMs,
            );

          return {
            ok: pageOutcome.ok,
            stop: reachedCutoff,
            errors: pageOutcome.result.errors,
          };
        },
        'emails',
        {
          startCursor: resumable ? resumeCursor : undefined,
          ...(resumable && { onCursorAdvance }),
          ...(isDefined(options?.deadlineAtMs) && {
            deadlineAtMs: options.deadlineAtMs,
          }),
        },
      );

      return { value: undefined, completed: resumable ? completed : true };
    },
  );

  return { result: aggregate, value: undefined };
};
