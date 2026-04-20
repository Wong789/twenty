import { describe, expect, it, vi } from 'vitest';

import type { StepOutcome } from '@modules/resend/sync/types/step-outcome';
import type { SyncResult } from '@modules/resend/sync/types/sync-result';
import type { SyncStepResult } from '@modules/resend/sync/types/sync-step-result';
import { orchestrateSyncResend } from '@modules/resend/sync/utils/orchestrate-sync-resend';
import {
  MAX_ERRORS_IN_THROWN_MESSAGE,
  reportAndThrowIfErrors,
} from '@modules/resend/sync/utils/report-and-throw-if-errors';
import type { SegmentIdMap } from '@modules/resend/sync/utils/sync-segments';

const emptyResult = (): SyncResult => ({
  fetched: 0,
  created: 0,
  updated: 0,
  errors: [],
});

const emptySegmentMap: SegmentIdMap = new Map();

const successfulSegmentsStep = (): Promise<SyncStepResult<SegmentIdMap>> =>
  Promise.resolve({ result: emptyResult(), value: emptySegmentMap });

const successfulTemplatesStep = (): Promise<SyncStepResult> =>
  Promise.resolve({ result: emptyResult(), value: undefined });

const successfulStep = (): Promise<SyncStepResult> =>
  Promise.resolve({ result: emptyResult(), value: undefined });

describe('orchestrateSyncResend', () => {
  it('runs segments, templates, contacts and emails concurrently', async () => {
    const order: string[] = [];

    const trackStart =
      <T,>(name: string, value: T) =>
      (): Promise<SyncStepResult<T>> => {
        order.push(`${name}:start`);

        return new Promise((resolve) => {
          setImmediate(() => {
            order.push(`${name}:end`);
            resolve({ result: emptyResult(), value });
          });
        });
      };

    await orchestrateSyncResend({
      syncSegments: trackStart('SEGMENTS', emptySegmentMap),
      syncTemplates: trackStart('TEMPLATES', undefined),
      syncContacts: trackStart('CONTACTS', undefined),
      syncEmails: trackStart('EMAILS', undefined),
      syncBroadcasts: () => successfulStep(),
    });

    expect(order.slice(0, 4)).toEqual([
      'SEGMENTS:start',
      'TEMPLATES:start',
      'CONTACTS:start',
      'EMAILS:start',
    ]);
  });

  it('runs broadcasts after segments resolved', async () => {
    const broadcastsArguments: SegmentIdMap[] = [];
    const segmentMap: SegmentIdMap = new Map([['seg-1', 'twenty-seg-1']]);

    const outcomes = await orchestrateSyncResend({
      syncSegments: () =>
        Promise.resolve({ result: emptyResult(), value: segmentMap }),
      syncTemplates: successfulTemplatesStep,
      syncContacts: () => successfulStep(),
      syncEmails: () => successfulStep(),
      syncBroadcasts: (segmentIdMap) => {
        broadcastsArguments.push(segmentIdMap);

        return successfulStep();
      },
    });

    expect(broadcastsArguments).toHaveLength(1);
    expect(broadcastsArguments[0]).toBe(segmentMap);

    const broadcasts = outcomes.find(
      (outcome) => outcome.name === 'BROADCASTS',
    );

    expect(broadcasts?.status).toBe('ok');
  });

  it('runs broadcasts when templates fails but segments succeeds', async () => {
    const syncBroadcasts = vi.fn(() => successfulStep());

    const outcomes = await orchestrateSyncResend({
      syncSegments: successfulSegmentsStep,
      syncTemplates: () => Promise.reject(new Error('templates boom')),
      syncContacts: successfulStep,
      syncEmails: successfulStep,
      syncBroadcasts,
    });

    expect(syncBroadcasts).toHaveBeenCalledTimes(1);

    const broadcasts = outcomes.find(
      (outcome) => outcome.name === 'BROADCASTS',
    );

    expect(broadcasts?.status).toBe('ok');
  });

  it('skips broadcasts with structured reason when segments fails', async () => {
    const syncBroadcasts = vi.fn(() => successfulStep());

    const outcomes = await orchestrateSyncResend({
      syncSegments: () => Promise.reject(new Error('segments boom')),
      syncTemplates: successfulTemplatesStep,
      syncContacts: successfulStep,
      syncEmails: successfulStep,
      syncBroadcasts,
    });

    expect(syncBroadcasts).not.toHaveBeenCalled();

    const broadcasts = outcomes.find(
      (outcome) => outcome.name === 'BROADCASTS',
    );

    expect(broadcasts?.status).toBe('skipped');
    if (broadcasts?.status !== 'skipped') {
      throw new Error('expected skipped outcome');
    }
    expect(broadcasts.reason).toContain('segments');
  });
});

describe('reportAndThrowIfErrors', () => {
  it('does nothing when no step has errors', () => {
    const outcomes: ReadonlyArray<StepOutcome<unknown>> = [
      {
        name: 'segments',
        status: 'ok',
        durationMs: 1,
        result: emptyResult(),
        value: undefined,
      },
    ];

    expect(() => reportAndThrowIfErrors(outcomes)).not.toThrow();
  });

  it('surfaces non-throwing per-item errors collected in result.errors', () => {
    const outcomes: ReadonlyArray<StepOutcome<unknown>> = [
      {
        name: 'contacts',
        status: 'ok',
        durationMs: 1,
        result: {
          fetched: 1,
          created: 0,
          updated: 0,
          errors: ['contact 123: boom'],
        },
        value: undefined,
      },
    ];

    expect(() => reportAndThrowIfErrors(outcomes)).toThrowError(
      /Sync completed with 1 error/,
    );
    expect(() => reportAndThrowIfErrors(outcomes)).toThrowError(
      /\[contacts\] contact 123: boom/,
    );
  });

  it('surfaces step-level failures', () => {
    const outcomes: ReadonlyArray<StepOutcome<unknown>> = [
      {
        name: 'segments',
        status: 'failed',
        durationMs: 5,
        error: 'top level boom',
      },
    ];

    expect(() => reportAndThrowIfErrors(outcomes)).toThrowError(
      /\[segments\] top level boom/,
    );
  });

  it('truncates the thrown message after MAX_ERRORS_IN_THROWN_MESSAGE entries', () => {
    const tooMany = MAX_ERRORS_IN_THROWN_MESSAGE + 7;
    const outcomes: ReadonlyArray<StepOutcome<unknown>> = [
      {
        name: 'emails',
        status: 'ok',
        durationMs: 1,
        result: {
          fetched: tooMany,
          created: 0,
          updated: 0,
          errors: Array.from(
            { length: tooMany },
            (_, errorIndex) => `error-${errorIndex}`,
          ),
        },
        value: undefined,
      },
    ];

    let caught: Error | undefined;
    try {
      reportAndThrowIfErrors(outcomes);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain(`Sync completed with ${tooMany} error`);
    expect(caught?.message).toContain('...and 7 more');

    const renderedErrorLines = caught?.message
      .split('\n')
      .filter((line) => line.startsWith('  - ')) ?? [];

    expect(renderedErrorLines).toHaveLength(MAX_ERRORS_IN_THROWN_MESSAGE);
  });
});
