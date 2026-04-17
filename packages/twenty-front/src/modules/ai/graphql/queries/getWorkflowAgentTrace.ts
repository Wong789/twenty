import { gql } from '@apollo/client';

export const GET_WORKFLOW_AGENT_TRACE = gql`
  query GetWorkflowAgentTrace($workflowRunId: UUID!, $workflowStepId: String!) {
    workflowAgentTrace(
      workflowRunId: $workflowRunId
      workflowStepId: $workflowStepId
    ) {
      id
      thread {
        id
        totalInputTokens
        totalOutputTokens
        totalInputCredits
        totalOutputCredits
      }
      messages {
        id
        threadId
        turnId
        agentId
        role
        status
        processedAt
        createdAt
        parts {
          id
          messageId
          orderIndex
          type
          textContent
          reasoningContent
          toolName
          toolCallId
          toolInput
          toolOutput
          errorMessage
          state
          errorDetails
          sourceUrlSourceId
          sourceUrlUrl
          sourceUrlTitle
          sourceDocumentSourceId
          sourceDocumentMediaType
          sourceDocumentTitle
          sourceDocumentFilename
          fileMediaType
          fileFilename
          fileUrl
          fileId
          providerMetadata
          createdAt
        }
      }
    }
  }
`;
