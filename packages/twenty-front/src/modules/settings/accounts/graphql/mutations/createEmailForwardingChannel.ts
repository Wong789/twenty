import { gql } from '@apollo/client';

export const CREATE_EMAIL_FORWARDING_CHANNEL = gql`
  mutation CreateEmailForwardingChannel {
    createEmailForwardingChannel {
      messageChannel {
        id
        handle
        visibility
        type
        isSyncEnabled
        excludeGroupEmails
        contactAutoCreationPolicy
      }
      forwardingAddress
    }
  }
`;
