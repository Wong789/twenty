import { styled } from '@linaria/react';

import { AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME } from '@/ai/constants/AgentChatRefetchMessagesEventName';
import { agentChatFetchedMessagesComponentFamilyState } from '@/ai/states/agentChatFetchedMessagesComponentFamilyState';
import { currentAIChatThreadState } from '@/ai/states/currentAIChatThreadState';
import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { dispatchBrowserEvent } from '@/browser-event/utils/dispatchBrowserEvent';
import { useAtomComponentFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useMemo } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { IconX } from 'twenty-ui/display';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledQueueContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  padding: 0 ${themeCssVariables.spacing[3]};
`;

const StyledQueueLabel = styled.div`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.xs};
  padding-left: ${themeCssVariables.spacing[1]};
`;

const StyledQueuedItem = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.tertiary};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  font-size: ${themeCssVariables.font.size.md};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledQueuedText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const AIChatQueuedMessages = () => {
  const currentAIChatThread = useAtomStateValue(currentAIChatThreadState);
  const agentChatFetchedMessages = useAtomComponentFamilyStateValue(
    agentChatFetchedMessagesComponentFamilyState,
    { threadId: currentAIChatThread },
  );

  const queuedMessages = useMemo(
    () =>
      agentChatFetchedMessages.filter((message) => message.status === 'queued'),
    [agentChatFetchedMessages],
  );

  if (!isDefined(currentAIChatThread) || queuedMessages.length === 0) {
    return null;
  }

  const handleRemove = (messageId: string) => {
    const tokenPair = getTokenPair();

    if (!isDefined(tokenPair)) {
      return;
    }

    fetch(
      `${REST_API_BASE_URL}/agent-chat/${currentAIChatThread}/queue/${messageId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenPair.accessOrWorkspaceAgnosticToken.token}`,
        },
      },
    )
      .then(() => {
        dispatchBrowserEvent(AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME);
      })
      .catch(() => {});
  };

  return (
    <StyledQueueContainer>
      <StyledQueueLabel>{queuedMessages.length} Queued</StyledQueueLabel>
      {queuedMessages.map((message) => {
        const textPart = message.parts?.find((part) => part.type === 'text');
        const displayText = textPart && 'text' in textPart ? textPart.text : '';

        return (
          <StyledQueuedItem key={message.id}>
            <StyledQueuedText>{displayText}</StyledQueuedText>
            <LightIconButton
              Icon={IconX}
              onClick={() => handleRemove(message.id)}
              size="small"
            />
          </StyledQueuedItem>
        );
      })}
    </StyledQueueContainer>
  );
};
