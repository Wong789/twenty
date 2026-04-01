import { useStore } from 'jotai';
import { useCallback, useState } from 'react';
import { type ExtendedUIMessage } from 'twenty-shared/ai';
import { isDefined, isValidUuid } from 'twenty-shared/utils';
import { v4 } from 'uuid';

import { AGENT_CHAT_INSTANCE_ID } from '@/ai/constants/AgentChatInstanceId';
import { AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME } from '@/ai/constants/AgentChatRefetchMessagesEventName';
import { AGENT_CHAT_SEND_MESSAGE_EVENT_NAME } from '@/ai/constants/AgentChatSendMessageEventName';
import { AGENT_CHAT_STOP_EVENT_NAME } from '@/ai/constants/AgentChatStopEventName';
import { useAgentChatModelId } from '@/ai/hooks/useAgentChatModelId';
import { useAuthenticatedFetch } from '@/ai/hooks/useAuthenticatedFetch';
import { useGetBrowsingContext } from '@/ai/hooks/useBrowsingContext';
import {
  AGENT_CHAT_NEW_THREAD_DRAFT_KEY,
  agentChatDraftsByThreadIdState,
} from '@/ai/states/agentChatDraftsByThreadIdState';
import { agentChatInputState } from '@/ai/states/agentChatInputState';
import { agentChatSelectedFilesState } from '@/ai/states/agentChatSelectedFilesState';
import { agentChatUploadedFilesState } from '@/ai/states/agentChatUploadedFilesState';
import { agentChatFetchedMessagesComponentFamilyState } from '@/ai/states/agentChatFetchedMessagesComponentFamilyState';
import { agentChatIsStreamingState } from '@/ai/states/agentChatIsStreamingState';
import { agentChatMessagesComponentFamilyState } from '@/ai/states/agentChatMessagesComponentFamilyState';
import { agentChatQueuedMessagesComponentFamilyState } from '@/ai/states/agentChatQueuedMessagesComponentFamilyState';
import { currentAIChatThreadState } from '@/ai/states/currentAIChatThreadState';
import { REST_API_BASE_URL } from '@/apollo/constant/rest-api-base-url';
import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { useListenToBrowserEvent } from '@/browser-event/hooks/useListenToBrowserEvent';
import { dispatchBrowserEvent } from '@/browser-event/utils/dispatchBrowserEvent';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';

export const useAgentChat = (
  ensureThreadIdForSend: () => Promise<string | null>,
) => {
  const { modelIdForRequest } = useAgentChatModelId();
  const { authenticatedFetch } = useAuthenticatedFetch();
  const { getBrowsingContext } = useGetBrowsingContext();
  const setCurrentAIChatThread = useSetAtomState(currentAIChatThreadState);
  const store = useStore();

  const agentChatSelectedFiles = useAtomStateValue(agentChatSelectedFilesState);

  const [, setPendingThreadIdAfterFirstSend] = useState<string | null>(null);

  const [agentChatUploadedFiles, setAgentChatUploadedFiles] = useAtomState(
    agentChatUploadedFilesState,
  );

  const [, setAgentChatInput] = useAtomState(agentChatInputState);
  const setAgentChatDraftsByThreadId = useSetAtomState(
    agentChatDraftsByThreadIdState,
  );

  const handleSendMessage = useCallback(async () => {
    const draftKey =
      store.get(currentAIChatThreadState.atom) ??
      AGENT_CHAT_NEW_THREAD_DRAFT_KEY;
    const contentToSend =
      draftKey === AGENT_CHAT_NEW_THREAD_DRAFT_KEY
        ? (
            store.get(agentChatDraftsByThreadIdState.atom)[
              AGENT_CHAT_NEW_THREAD_DRAFT_KEY
            ] ?? store.get(agentChatInputState.atom)
          ).trim()
        : store.get(agentChatInputState.atom).trim();

    if (contentToSend === '') {
      return;
    }

    const isLoading = agentChatSelectedFiles.length > 0;

    if (isLoading) {
      return;
    }

    const threadId = await ensureThreadIdForSend();

    if (!isDefined(threadId)) {
      return;
    }

    if (draftKey === AGENT_CHAT_NEW_THREAD_DRAFT_KEY) {
      setPendingThreadIdAfterFirstSend(threadId);
    }

    setAgentChatInput('');
    setAgentChatDraftsByThreadId((prev) => ({
      ...prev,
      [draftKey]: '',
    }));

    const browsingContext = getBrowsingContext();

    const fetchedMessages = store.get(
      agentChatFetchedMessagesComponentFamilyState.atomFamily({
        instanceId: AGENT_CHAT_INSTANCE_ID,
        familyKey: { threadId },
      }),
    );

    const optimisticUserMessage: ExtendedUIMessage = {
      id: v4(),
      role: 'user',
      parts: [
        { type: 'text' as const, text: contentToSend },
        ...agentChatUploadedFiles,
      ],
      metadata: {
        createdAt: new Date().toISOString(),
      },
      status: 'sent',
    };

    const atomKey = {
      instanceId: AGENT_CHAT_INSTANCE_ID,
      familyKey: { threadId },
    };

    // If already streaming, place the optimistic message in the queue
    // to mirror the server's queue decision and avoid a visible flash.
    const isCurrentlyStreaming = store.get(agentChatIsStreamingState.atom);
    const targetAtom = isCurrentlyStreaming
      ? agentChatQueuedMessagesComponentFamilyState
      : agentChatMessagesComponentFamilyState;

    const currentTargetMessages = store.get(targetAtom.atomFamily(atomKey));

    store.set(targetAtom.atomFamily(atomKey), [
      ...currentTargetMessages,
      optimisticUserMessage,
    ]);

    setAgentChatUploadedFiles([]);

    const tokenPair = getTokenPair();

    if (!isDefined(tokenPair)) {
      return;
    }

    const allMessages = [...fetchedMessages, optimisticUserMessage];

    try {
      const response = await authenticatedFetch(
        `${REST_API_BASE_URL}/agent-chat/${threadId}/message`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenPair.accessOrWorkspaceAgnosticToken.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: contentToSend,
            messages: allMessages,
            browsingContext,
            ...(isDefined(modelIdForRequest) && {
              modelId: modelIdForRequest,
            }),
          }),
        },
      );

      const result = await response.json();

      if (result.queued) {
        if (!isCurrentlyStreaming) {
          // Server queued it but we optimistically placed in main thread.
          // Move it to the queue (edge case: streaming started between
          // our check and the server's decision).
          const latestMessages = store.get(
            agentChatMessagesComponentFamilyState.atomFamily(atomKey),
          );

          store.set(
            agentChatMessagesComponentFamilyState.atomFamily(atomKey),
            latestMessages.filter(
              (message) => message.id !== optimisticUserMessage.id,
            ),
          );
        }

        dispatchBrowserEvent(AGENT_CHAT_REFETCH_MESSAGES_EVENT_NAME);
      }

      setPendingThreadIdAfterFirstSend((pendingId) => {
        if (isDefined(pendingId)) {
          setCurrentAIChatThread(pendingId);
        }

        return null;
      });
    } catch {
      const latestMessages = store.get(targetAtom.atomFamily(atomKey));

      store.set(
        targetAtom.atomFamily(atomKey),
        latestMessages.filter(
          (message) => message.id !== optimisticUserMessage.id,
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store,
    agentChatSelectedFiles,
    ensureThreadIdForSend,
    setAgentChatInput,
    getBrowsingContext,
    agentChatUploadedFiles,
    setAgentChatUploadedFiles,
    setAgentChatDraftsByThreadId,
    modelIdForRequest,
    setCurrentAIChatThread,
  ]);

  useListenToBrowserEvent({
    eventName: AGENT_CHAT_SEND_MESSAGE_EVENT_NAME,
    onBrowserEvent: handleSendMessage,
  });

  const handleStop = useCallback(async () => {
    const threadId = store.get(currentAIChatThreadState.atom);

    if (!isDefined(threadId) || !isValidUuid(threadId)) {
      return;
    }

    const tokenPair = getTokenPair();

    if (!isDefined(tokenPair)) {
      return;
    }

    authenticatedFetch(`${REST_API_BASE_URL}/agent-chat/${threadId}/stream`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${tokenPair.accessOrWorkspaceAgnosticToken.token}`,
      },
    }).catch(() => {});
  }, [store, authenticatedFetch]);

  useListenToBrowserEvent({
    eventName: AGENT_CHAT_STOP_EVENT_NAME,
    onBrowserEvent: handleStop,
  });

  // TODO: implement proper retry (re-send last user message to /message)
  // The AIChatErrorMessage UI still dispatches AGENT_CHAT_RETRY_EVENT_NAME
  // but no listener is wired until retry is properly implemented.

  return {
    handleSendMessage,
    handleStop,
  };
};
