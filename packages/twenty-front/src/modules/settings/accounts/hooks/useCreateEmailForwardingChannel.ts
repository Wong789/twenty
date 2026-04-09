import { useMutation } from '@apollo/client/react';

import { CREATE_EMAIL_FORWARDING_CHANNEL } from '@/settings/accounts/graphql/mutations/createEmailForwardingChannel';

type CreateEmailForwardingChannelResult = {
  createEmailForwardingChannel: {
    messageChannel: {
      id: string;
      handle: string;
      visibility: string;
      type: string;
      isSyncEnabled: boolean;
      excludeGroupEmails: boolean;
      contactAutoCreationPolicy: string;
    };
    forwardingAddress: string;
  };
};

export const useCreateEmailForwardingChannel = () => {
  const [createEmailForwardingChannel, { loading, error }] =
    useMutation<CreateEmailForwardingChannelResult>(
      CREATE_EMAIL_FORWARDING_CHANNEL,
    );

  return { createEmailForwardingChannel, loading, error };
};
