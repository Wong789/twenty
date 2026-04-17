import { AIChatAssistantMessageRenderer } from '@/ai/components/AIChatAssistantMessageRenderer';
import { GET_WORKFLOW_AGENT_TRACE } from '@/ai/graphql/queries/getWorkflowAgentTrace';
import { mapDBMessagesToUIMessages } from '@/ai/utils/mapDBMessagesToUIMessages';
import { useQuery } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { type ReactNode, useState } from 'react';
import Skeleton from 'react-loading-skeleton';
import { IconChevronRight } from 'twenty-ui/display';
import { AnimatedExpandableContainer } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { type AgentMessage } from '~/generated-metadata/graphql';

type GetWorkflowAgentTraceResult = {
  workflowAgentTrace: {
    id: string;
    messages: AgentMessage[];
  } | null;
};

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledCollapsibleSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledSectionToggle = styled.button`
  align-items: center;
  background: none;
  border: none;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.regular};
  gap: ${themeCssVariables.spacing[2]};
  line-height: ${themeCssVariables.text.lineHeight.md};
  min-height: 24px;
  padding: 0;
  transition: color calc(${themeCssVariables.animation.duration.fast} * 1s)
    ease-in-out;
  width: fit-content;

  &:hover {
    color: ${themeCssVariables.font.color.primary};
  }

  &:focus-visible {
    outline: 2px solid ${themeCssVariables.color.blue};
    outline-offset: 2px;
  }
`;

const StyledChevron = styled.span<{ isExpanded: boolean }>`
  align-items: center;
  color: ${themeCssVariables.font.color.light};
  display: inline-flex;
  justify-content: center;
  transform: rotate(${({ isExpanded }) => (isExpanded ? '90deg' : '0deg')});
  transition: transform calc(${themeCssVariables.animation.duration.fast} * 1s)
    ease-in-out;
`;

const StyledSectionBody = styled.div`
  color: ${themeCssVariables.font.color.primary};
  padding-top: ${themeCssVariables.spacing[1]};
`;

const StyledPromptBody = styled.div`
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.md};
  line-height: ${themeCssVariables.text.lineHeight.lg};
  padding: ${themeCssVariables.spacing[3]};
  white-space: pre-wrap;
`;

const StyledMessagesList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledAssistantMessage = styled.div`
  color: ${themeCssVariables.font.color.primary};
`;

const StyledTraceUnavailable = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.md};
`;

type CollapsibleSectionProps = {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

const CollapsibleSection = ({
  label,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(defaultOpen);

  return (
    <StyledCollapsibleSection>
      <StyledSectionToggle
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((previous) => !previous)}
      >
        <StyledChevron isExpanded={isExpanded}>
          <IconChevronRight size={14} />
        </StyledChevron>
        {label}
      </StyledSectionToggle>
      <AnimatedExpandableContainer isExpanded={isExpanded} mode="fit-content">
        <StyledSectionBody>{children}</StyledSectionBody>
      </AnimatedExpandableContainer>
    </StyledCollapsibleSection>
  );
};

const extractPromptText = (userMessage: AgentMessage | undefined): string => {
  if (!userMessage) return '';

  return userMessage.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.textContent ?? '')
    .join('\n')
    .trim();
};

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

  const userMessage = turn.messages.find((message) => message.role === 'user');
  const assistantMessages = turn.messages.filter(
    (message) => message.role === 'assistant' && message.parts.length > 0,
  );
  const promptText = extractPromptText(userMessage);
  const uiMessages = mapDBMessagesToUIMessages(assistantMessages);

  return (
    <StyledContainer>
      {promptText.length > 0 && (
        <CollapsibleSection label={t`Prompt`}>
          <StyledPromptBody>{promptText}</StyledPromptBody>
        </CollapsibleSection>
      )}
      <StyledMessagesList>
        {uiMessages.map((message) => (
          <StyledAssistantMessage key={message.id}>
            <AIChatAssistantMessageRenderer
              messageParts={message.parts}
              isLastMessageStreaming={false}
            />
          </StyledAssistantMessage>
        ))}
      </StyledMessagesList>
    </StyledContainer>
  );
};
