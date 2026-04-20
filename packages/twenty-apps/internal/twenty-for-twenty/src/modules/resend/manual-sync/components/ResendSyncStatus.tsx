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

type FetchState = {
  rows: CursorRow[];
  loading: boolean;
  error: string | null;
};

const STATUS_COLORS: Record<NonNullable<CursorRow['lastRunStatus']>, string> = {
  SUCCESS: '#1f9d55',
  FAILED: '#c53030',
  IN_PROGRESS: '#b7791f',
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
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await new CoreApiClient().query({
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
        });

        const connection = extractConnection<CursorRow>(
          result,
          'resendSyncCursors',
        );

        if (!cancelled) {
          setState({
            rows: connection.edges.map((edge) => edge.node),
            loading: false,
            error: null,
          });
        }
      } catch (fetchError) {
        if (!cancelled) {
          setState({
            rows: [],
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

  if (state.rows.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          fontFamily: 'sans-serif',
          fontSize: '13px',
          color: '#666',
        }}
      >
        No sync runs yet.
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
