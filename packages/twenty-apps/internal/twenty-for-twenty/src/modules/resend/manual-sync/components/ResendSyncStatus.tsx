import { useEffect, useState } from 'react';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { isDefined } from '@utils/is-defined';

import { extractConnection } from '@modules/resend/shared/utils/typed-client';

type CursorRow = {
  id: string;
  step: string;
  cursor: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' | null;
};

type DetailToFetchStatus = 'PENDING' | 'DONE' | 'FAILED';

type DetailMetrics = {
  pending: number;
  done: number;
  failed: number;
};

type FetchState = {
  rows: CursorRow[];
  detailMetrics: DetailMetrics | null;
  loading: boolean;
  error: string | null;
};

const STATUS_COLORS: Record<NonNullable<CursorRow['lastRunStatus']>, string> = {
  SUCCESS: '#1f9d55',
  FAILED: '#c53030',
  IN_PROGRESS: '#b7791f',
};

const RESEND_DETAILS_TO_FETCH_PLURAL: string = 'resendDetailsToFetch';

const fetchDetailCount = async (
  client: CoreApiClient,
  status: DetailToFetchStatus,
): Promise<number> => {
  const result = (await client.query({
    [RESEND_DETAILS_TO_FETCH_PLURAL]: {
      __args: { filter: { status: { eq: status } }, first: 0 },
      totalCount: true,
    },
  })) as unknown as Record<string, { totalCount?: number | null } | undefined>;

  return result[RESEND_DETAILS_TO_FETCH_PLURAL]?.totalCount ?? 0;
};

const formatTimestamp = (value: string | null): string => {
  if (!isDefined(value)) {
    return '—';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

export const ResendSyncStatus = () => {
  const [state, setState] = useState<FetchState>({
    rows: [],
    detailMetrics: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const client = new CoreApiClient();

        const [cursorResult, pending, done, failed] = await Promise.all([
          client.query({
            resendSyncCursors: {
              __args: { first: 50 },
              edges: {
                node: {
                  id: true,
                  step: true,
                  cursor: true,
                  lastRunAt: true,
                  lastRunStatus: true,
                },
              },
            },
          }),
          fetchDetailCount(client, 'PENDING'),
          fetchDetailCount(client, 'DONE'),
          fetchDetailCount(client, 'FAILED'),
        ]);

        const connection = extractConnection<CursorRow>(
          cursorResult,
          'resendSyncCursors',
        );

        if (!cancelled) {
          setState({
            rows: connection.edges.map((edge) => edge.node),
            detailMetrics: { pending, done, failed },
            loading: false,
            error: null,
          });
        }
      } catch (fetchError) {
        if (!cancelled) {
          setState({
            rows: [],
            detailMetrics: null,
            loading: false,
            error:
              fetchError instanceof Error
                ? fetchError.message
                : String(fetchError),
          });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div
        style={{
          padding: '16px',
          fontFamily: 'sans-serif',
          fontSize: '13px',
          color: '#666',
        }}
      >
        Loading sync status…
      </div>
    );
  }

  if (isDefined(state.error)) {
    return (
      <div
        style={{
          padding: '16px',
          fontFamily: 'sans-serif',
          fontSize: '13px',
          color: '#c53030',
        }}
      >
        Failed to load sync status: {state.error}
      </div>
    );
  }

  const sortedRows = [...state.rows].sort((a, b) =>
    a.step.localeCompare(b.step),
  );

  return (
    <div
      style={{
        padding: '16px',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: '#333',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {isDefined(state.detailMetrics) && (
        <div
          style={{
            padding: '12px',
            borderRadius: '6px',
            background: '#f7f7f7',
            border: '1px solid #ececec',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <strong>Detail queue</strong>
          <div style={{ color: '#555' }}>
            <span style={{ color: STATUS_COLORS.IN_PROGRESS, fontWeight: 600 }}>
              Pending: {state.detailMetrics.pending}
            </span>
            {' · '}
            <span style={{ color: STATUS_COLORS.SUCCESS, fontWeight: 600 }}>
              Done: {state.detailMetrics.done}
            </span>
            {' · '}
            <span style={{ color: STATUS_COLORS.FAILED, fontWeight: 600 }}>
              Failed: {state.detailMetrics.failed}
            </span>
          </div>
        </div>
      )}
      {state.rows.length === 0 && (
        <div style={{ color: '#666' }}>No sync runs yet.</div>
      )}
      {sortedRows.map((row) => {
        const statusLabel = row.lastRunStatus ?? 'NEVER';
        const statusColor =
          row.lastRunStatus !== null && isDefined(row.lastRunStatus)
            ? STATUS_COLORS[row.lastRunStatus]
            : '#888';

        return (
          <div
            key={row.id}
            style={{
              padding: '12px',
              borderRadius: '6px',
              background: '#f7f7f7',
              border: '1px solid #ececec',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong>{row.step}</strong>
              <span
                style={{
                  color: statusColor,
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                {statusLabel}
              </span>
            </div>
            <div style={{ color: '#555' }}>
              Last run: {formatTimestamp(row.lastRunAt)}
            </div>
            {isDefined(row.cursor) && row.cursor !== '' && (
              <div style={{ color: '#555' }}>
                Resume cursor: <code>{row.cursor}</code>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
