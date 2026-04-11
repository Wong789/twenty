import { gql } from '@apollo/client';

export const GET_ADMIN_WORKSPACE_CHAT_THREADS = gql`
  query GetAdminWorkspaceChatThreads($workspaceId: String!) {
    getAdminWorkspaceChatThreads(workspaceId: $workspaceId) {
      id
      title
      totalInputTokens
      totalOutputTokens
      conversationSize
      createdAt
      updatedAt
    }
  }
`;
