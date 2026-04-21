import { isDefined } from '@utils/is-defined';
import { useEffect, useState } from 'react';
import { CoreApiClient } from 'twenty-client-sdk/core';
import {
  Callout,
  H2Title,
  IconAlertCircle,
  IconRefresh,
  Section,
  Status,
  Tag,
  themeCssVariables,
} from 'twenty-sdk/ui';

import { extractConnection } from '@modules/resend/shared/utils/typed-client';

type CursorRowStatus = 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';

type CursorRow = {
  id: string;
  step: string;
  cursor: string | null;
  lastRunAt: string | null;
  lastRunStatus: CursorRowStatus | null;
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

type StatusThemeColor = 'green' | 'red' | 'orange' | 'gray';

const STATUS_COLOR_BY_RUN_STATUS: Record<CursorRowStatus, StatusThemeColor> = {
  SUCCESS: 'green',
  FAILED: 'red',
  IN_PROGRESS: 'orange',
};

const STATUS_LABEL_BY_RUN_STATUS: Record<CursorRowStatus, string> = {
  SUCCESS: 'Success',
  FAILED: 'Failed',
  IN_PROGRESS: 'In progress',
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

const formatStepLabel = (step: string): string =>
  step
    .toLowerCase()
    .split('_')
    .map((part) =>
      part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part,
    )
    .join(' ');

const getStyles = (): Record<string, React.CSSProperties> => ({
  container: {
    fontFamily: themeCssVariables.font.family,
    fontSize: themeCssVariables.font.size.sm,
    color: themeCssVariables.font.color.primary,
    display: 'flex',
    flexDirection: 'column',
    gap: themeCssVariables.spacing[3],
  },
  card: {
    padding: themeCssVariables.spacing[3],
    borderRadius: themeCssVariables.border.radius.md,
    background: themeCssVariables.background.secondary,
    border: `1px solid ${themeCssVariables.border.color.light}`,
    display: 'flex',
    flexDirection: 'column',
    gap: themeCssVariables.spacing[2],
    userSelect: 'text',
    WebkitUserSelect: 'text',
    cursor: 'text',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: themeCssVariables.spacing[2],
  },
  cursorCode: {
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    verticalAlign: 'bottom',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: themeCssVariables.font.size.xs,
    color: themeCssVariables.font.color.secondary,
    background: themeCssVariables.background.transparent.light,
    borderRadius: themeCssVariables.border.radius.sm,
    padding: `0 ${themeCssVariables.spacing[1]}`,
  },
  queueTagsRow: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: themeCssVariables.spacing[2],
  },
  // H2Title hard-codes a bottom margin on its container; this wrapper negates
  // it so the title aligns flush with sibling content inside the card header.
  h2TitleNoMargin: {
    display: 'flex',
    marginBottom: `calc(-1 * ${themeCssVariables.spacing[4]})`,
  },
});

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

  const styles = getStyles();

  if (state.loading) {
    return (
      <div style={styles.container}>
        <Callout
          variant="neutral"
          title="Loading sync status"
          description="Fetching cursors and queue counts…"
          Icon={IconRefresh}
        />
      </div>
    );
  }

  if (isDefined(state.error)) {
    return (
      <div style={styles.container}>
        <Callout
          variant="error"
          title="Failed to load sync status"
          description={state.error}
          Icon={IconAlertCircle}
        />
      </div>
    );
  }

  const sortedRows = [...state.rows].sort((a, b) =>
    a.step.localeCompare(b.step),
  );

  return (
    <div style={styles.container}>
      {isDefined(state.detailMetrics) && (
        <Section>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <div style={styles.h2TitleNoMargin}>
                <H2Title title="Detail queue" />
              </div>
              <div style={styles.queueTagsRow}>
                <Tag
                  color="orange"
                  weight="medium"
                  text={`Pending: ${state.detailMetrics.pending}`}
                />
                <Tag
                  color="green"
                  weight="medium"
                  text={`Done: ${state.detailMetrics.done}`}
                />
                <Tag
                  color="red"
                  weight="medium"
                  text={`Failed: ${state.detailMetrics.failed}`}
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      {sortedRows.length === 0 ? (
        <Callout
          variant="neutral"
          title="No sync runs yet"
          description="Trigger a sync from the command menu to populate this dashboard."
        />
      ) : (
        sortedRows.map((row) => {
          const runStatus = row.lastRunStatus;
          const statusColor: StatusThemeColor = isDefined(runStatus)
            ? STATUS_COLOR_BY_RUN_STATUS[runStatus]
            : 'gray';
          const statusLabel = isDefined(runStatus)
            ? STATUS_LABEL_BY_RUN_STATUS[runStatus]
            : 'Never run';

          return (
            <div key={row.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={styles.h2TitleNoMargin}>
                  <H2Title title={formatStepLabel(row.step)} />
                </div>
                <Status
                  color={statusColor}
                  text={statusLabel}
                  isLoaderVisible={runStatus === 'IN_PROGRESS'}
                />
              </div>
              <div style={styles.cardLine}>
                Last run: {formatTimestamp(row.lastRunAt)}
              </div>
              {isDefined(row.cursor) && row.cursor !== '' && (
                <div style={styles.cardLine}>
                  Resume cursor:{' '}
                  <code style={styles.cursorCode}>{row.cursor}</code>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
