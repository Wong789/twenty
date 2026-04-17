import { AIChatAssistantMessageRenderer } from '@/ai/components/AIChatAssistantMessageRenderer';
import { GET_WORKFLOW_AGENT_TRACE } from '@/ai/graphql/queries/getWorkflowAgentTrace';
import { mapDBMessagesToUIMessages } from '@/ai/utils/mapDBMessagesToUIMessages';
import { useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import Skeleton from 'react-loading-skeleton';
import { type AgentMessage } from '~/generated-metadata/graphql';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type GetWorkflowAgentTraceResult = {
  workflowAgentTrace: {
    id: string;
    messages: AgentMessage[];
  } | null;
};

const StyledMessagesContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledMessageBubble = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledMessageRole = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  text-transform: uppercase;
`;

const StyledMessageContent = styled.div`
  color: ${themeCssVariables.font.color.primary};
  max-width: 100%;
`;

const StyledTraceUnavailable = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.md};
`;

type WorkflowRunAiAgentTraceDetailProps = {
  workflowRunId: string;
  workflowStepId: string;
};

export const WorkflowRunAiAgentTraceDetail = ({
  workflowRunId,
  workflowStepId,
}: WorkflowRunAiAgentTraceDetailProps) => {
  const { data, loading } = useQuery<GetWorkflowAgentTraceResult>(
    GET_WORKFLOW_AGENT_TRACE,
    {
      variables: { workflowRunId, workflowStepId },
    },
  );

  if (loading) {
    return <Skeleton height={100} />;
  }

  const turn = data?.workflowAgentTrace;

  if (!turn || turn.messages.length === 0) {
    return (
      <StyledTraceUnavailable>{t`Trace unavailable`}</StyledTraceUnavailable>
    );
  }

  const displayableMessages = (turn.messages as AgentMessage[]).filter(
    (msg) => msg.parts.length > 0,
  );

  const uiMessages = mapDBMessagesToUIMessages(displayableMessages);

  return (
    <StyledMessagesContainer>
      {uiMessages.map((message) => {
        const roleLabel =
          message.role === 'user'
            ? t`Prompt`
            : message.role === 'system'
              ? t`System`
              : t`Agent Response`;

        return (
          <StyledMessageBubble key={message.id}>
            <StyledMessageRole>{roleLabel}</StyledMessageRole>
            <StyledMessageContent>
              <AIChatAssistantMessageRenderer
                messageParts={message.parts}
                isLastMessageStreaming={false}
              />
            </StyledMessageContent>
          </StyledMessageBubble>
        );
      })}
    </StyledMessagesContainer>
  );
};
