import { gql } from '@apollo/client';

export const WORKSPACE_LOOKUP_ADMIN_PANEL = gql`
  query WorkspaceLookupAdminPanel($workspaceId: String!) {
    workspaceLookupAdminPanel(workspaceId: $workspaceId) {
      user {
        id
        email
        firstName
        lastName
      }
      workspaces {
        id
        name
        allowImpersonation
        logo
        totalUsers
        workspaceUrls {
          customUrl
          subdomainUrl
        }
        users {
          id
          email
          firstName
          lastName
        }
        featureFlags {
          key
          value
        }
      }
    }
  }
`;
