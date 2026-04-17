import { TabList } from '@/ui/layout/tab-list/components/TabList';
import { activeTabIdComponentState } from '@/ui/layout/tab-list/states/activeTabIdComponentState';
import { type SingleTabProps } from '@/ui/layout/tab-list/types/SingleTabProps';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useWorkflowRun } from '@/workflow/hooks/useWorkflowRun';
import { useWorkflowRunIdOrThrow } from '@/workflow/hooks/useWorkflowRunIdOrThrow';
import { getStepDefinitionOrThrow } from '@/workflow/utils/getStepDefinitionOrThrow';
import { WorkflowStepBody } from '@/workflow/workflow-steps/components/WorkflowStepBody';
import { WorkflowRunAiAgentExecutionSummary } from '@/workflow/workflow-steps/components/WorkflowRunAiAgentExecutionSummary';
import { WorkflowRunAiAgentTraceDetail } from '@/workflow/workflow-steps/components/WorkflowRunAiAgentTraceDetail';
import { WorkflowRunStepJsonContainer } from '@/workflow/workflow-steps/components/WorkflowRunStepJsonContainer';
import { useWorkflowRunStepInfo } from '@/workflow/workflow-steps/hooks/useWorkflowRunStepInfo';
import { getWorkflowRunStepInfoToDisplayAsOutput } from '@/workflow/workflow-steps/utils/getWorkflowRunStepInfoToDisplayAsOutput';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type ReactNode } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { type StepStatus } from 'twenty-shared/workflow';
import {
  type GetJsonNodeHighlighting,
  isTwoFirstDepths,
  JsonTree,
} from 'twenty-ui/json-visualizer';
import { IconJson, IconTimelineEvent } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard';

const WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS = {
  RESULT: 'result',
  TRACE: 'trace',
} as const;

type WorkflowRunAiAgentOutputTabId =
  (typeof WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS)[keyof typeof WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS];

const StyledTabListContainer = styled.div`
  background-color: ${themeCssVariables.background.secondary};
  padding-left: ${themeCssVariables.spacing[2]};
`;

const getAiAgentOutputTabListComponentInstanceId = ({
  workflowRunId,
  workflowStepId,
}: {
  workflowRunId: string;
  workflowStepId: string;
}) => `workflow-run-ai-agent-output-tabs-${workflowRunId}-${workflowStepId}`;

const WorkflowRunAiAgentOutputDetail = ({
  workflowRunId,
  workflowStepId,
  hasError,
  status,
  resultTree,
}: {
  workflowRunId: string;
  workflowStepId: string;
  hasError: boolean;
  status: StepStatus;
  resultTree: ReactNode;
}) => {
  const { t } = useLingui();
  const aiAgentOutputTabListComponentInstanceId =
    getAiAgentOutputTabListComponentInstanceId({
      workflowRunId,
      workflowStepId,
    });

  const activeTabId = useAtomComponentStateValue(
    activeTabIdComponentState,
    aiAgentOutputTabListComponentInstanceId,
  );
  const currentAiAgentOutputTabId =
    (activeTabId as WorkflowRunAiAgentOutputTabId) ??
    WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS.RESULT;
  const aiAgentOutputTabs: SingleTabProps<WorkflowRunAiAgentOutputTabId>[] = [
    {
      id: WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS.RESULT,
      title: hasError ? t`Error` : t`Result`,
      Icon: IconJson,
    },
    {
      id: WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS.TRACE,
      title: t`Trace`,
      Icon: IconTimelineEvent,
    },
  ];

  return (
    <>
      <StyledTabListContainer>
        <TabList
          tabs={aiAgentOutputTabs}
          behaveAsLinks={false}
          componentInstanceId={aiAgentOutputTabListComponentInstanceId}
          rightComponent={
            <WorkflowRunAiAgentExecutionSummary
              workflowRunId={workflowRunId}
              workflowStepId={workflowStepId}
              status={status}
            />
          }
        />
      </StyledTabListContainer>
      {currentAiAgentOutputTabId ===
      WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS.RESULT ? (
        <WorkflowStepBody overflow="auto">{resultTree}</WorkflowStepBody>
      ) : null}

      {currentAiAgentOutputTabId === WORKFLOW_RUN_AI_AGENT_OUTPUT_TABS.TRACE ? (
        <WorkflowStepBody overflow="auto">
          <WorkflowRunAiAgentTraceDetail
            workflowRunId={workflowRunId}
            workflowStepId={workflowStepId}
            status={status}
          />
        </WorkflowStepBody>
      ) : null}
    </>
  );
};

export const WorkflowRunStepOutputDetail = ({ stepId }: { stepId: string }) => {
  const { t } = useLingui();
  const { copyToClipboard } = useCopyToClipboard();

  const workflowRunId = useWorkflowRunIdOrThrow();
  const workflowRun = useWorkflowRun({ workflowRunId });

  const stepInfo = useWorkflowRunStepInfo({ stepId });

  if (!isDefined(workflowRun?.state) || !isDefined(stepInfo)) {
    return null;
  }

  const stepInfoToDisplay = getWorkflowRunStepInfoToDisplayAsOutput({
    stepInfo,
  });

  const stepDefinition = getStepDefinitionOrThrow({
    stepId,
    trigger: workflowRun.state.flow.trigger,
    steps: workflowRun.state.flow.steps,
  });
  if (!isDefined(stepDefinition?.definition)) {
    throw new Error('The step is expected to be properly shaped.');
  }

  const isAiAgentStep =
    stepDefinition.type === 'action' &&
    stepDefinition.definition.type === 'AI_AGENT';

  const setRedHighlightingForEveryNode: GetJsonNodeHighlighting = (keyPath) => {
    if (keyPath.startsWith('error')) {
      return 'red';
    }

    return undefined;
  };

  const resultTree = (
    <JsonTree
      value={stepInfoToDisplay ?? t`No output available`}
      shouldExpandNodeInitially={isTwoFirstDepths}
      emptyArrayLabel={t`Empty Array`}
      emptyObjectLabel={t`Empty Object`}
      emptyStringLabel={t`[empty string]`}
      arrowButtonCollapsedLabel={t`Expand`}
      arrowButtonExpandedLabel={t`Collapse`}
      getNodeHighlighting={
        isDefined(stepInfo?.error) ? setRedHighlightingForEveryNode : undefined
      }
      onNodeValueClick={copyToClipboard}
    />
  );

  if (isAiAgentStep) {
    const hasError = isDefined(stepInfo.error);

    return (
      <WorkflowRunAiAgentOutputDetail
        workflowRunId={workflowRunId}
        workflowStepId={stepId}
        hasError={hasError}
        status={stepInfo.status}
        resultTree={resultTree}
      />
    );
  }

  return (
    <>
      <WorkflowRunStepJsonContainer>{resultTree}</WorkflowRunStepJsonContainer>
    </>
  );
};
