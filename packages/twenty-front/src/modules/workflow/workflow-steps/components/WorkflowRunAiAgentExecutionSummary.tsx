import { GET_WORKFLOW_AGENT_TRACE } from '@/ai/graphql/queries/getWorkflowAgentTrace';
import { formatAiDisplayCost } from '@/ai/utils/formatAiDisplayCost';
import { billingState } from '@/client-config/states/billingState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { StepStatus } from 'twenty-shared/workflow';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { formatNumber } from '~/utils/format/formatNumber';

type WorkflowRunAiAgentExecutionSummaryProps = {
  workflowRunId: string;
  workflowStepId: string;
  status: StepStatus;
};

type WorkflowAgentTraceSummaryResult = {
  workflowAgentTrace: {
    id: string;
    thread: {
      id: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalInputCredits: number;
      totalOutputCredits: number;
    } | null;
  } | null;
};

const StyledSummaryRow = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
  line-height: ${themeCssVariables.text.lineHeight.md};
  max-width: 360px;
  min-width: 0;
  overflow: hidden;
  padding-right: ${themeCssVariables.spacing[3]};
  white-space: nowrap;
`;

const StyledSummarySeparator = styled.span`
  color: ${themeCssVariables.font.color.light};
`;

const getStatusLabel = (status: StepStatus) => {
  switch (status) {
    case StepStatus.SUCCESS:
      return t`Completed`;
    case StepStatus.FAILED:
    case StepStatus.FAILED_SAFELY:
      return t`Failed`;
    case StepStatus.RUNNING:
      return t`Running`;
    case StepStatus.PENDING:
      return t`Pending`;
    case StepStatus.STOPPED:
      return t`Stopped`;
    case StepStatus.SKIPPED:
      return t`Skipped`;
    default:
      return String(status);
  }
};

const getTokenCountLabel = (tokenCount: number) => {
  const formattedTokenCount = formatNumber(tokenCount, {
    abbreviate: true,
    decimals: 1,
  });

  return tokenCount === 1
    ? t`${formattedTokenCount} token`
    : t`${formattedTokenCount} tokens`;
};

export const WorkflowRunAiAgentExecutionSummary = ({
  workflowRunId,
  workflowStepId,
  status,
}: WorkflowRunAiAgentExecutionSummaryProps) => {
  const { data } = useQuery<WorkflowAgentTraceSummaryResult>(
    GET_WORKFLOW_AGENT_TRACE,
    {
      variables: { workflowRunId, workflowStepId },
      fetchPolicy: 'cache-first',
    },
  );

  const billing = useAtomStateValue(billingState);
  const isBillingEnabled = billing?.isBillingEnabled ?? false;

  const thread = data?.workflowAgentTrace?.thread ?? null;
  const totalTokens = isDefined(thread)
    ? thread.totalInputTokens + thread.totalOutputTokens
    : 0;
  const totalCredits = isDefined(thread)
    ? thread.totalInputCredits + thread.totalOutputCredits
    : 0;

  const summaryItems = [
    getStatusLabel(status),
    ...(totalTokens > 0 ? [getTokenCountLabel(totalTokens)] : []),
    ...(totalCredits > 0
      ? [formatAiDisplayCost(totalCredits, { isBillingEnabled })]
      : []),
  ];

  return (
    <StyledSummaryRow>
      {summaryItems.map((summaryItem, index) => (
        <span key={summaryItem}>
          {index > 0 && (
            <StyledSummarySeparator>&middot; </StyledSummarySeparator>
          )}
          {summaryItem}
        </span>
      ))}
    </StyledSummaryRow>
  );
};
