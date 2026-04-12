import { gql } from '@apollo/client';

export const GET_ADMIN_CHAT_THREAD_MESSAGES = gql`
  query GetAdminChatThreadMessages($workspaceId: String!, $threadId: String!) {
    getAdminChatThreadMessages(workspaceId: $workspaceId, threadId: $threadId) {
      thread {
        id
        title
        totalInputTokens
        totalOutputTokens
        conversationSize
        createdAt
        updatedAt
      }
      messages {
        id
        role
        parts {
          type
          textContent
          toolName
        }
        createdAt
      }
    }
  }
`;
