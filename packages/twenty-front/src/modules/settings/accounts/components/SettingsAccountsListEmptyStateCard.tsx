import { isGoogleCalendarEnabledState } from '@/client-config/states/isGoogleCalendarEnabledState';
import { isGoogleMessagingEnabledState } from '@/client-config/states/isGoogleMessagingEnabledState';
import { isImapSmtpCaldavEnabledState } from '@/client-config/states/isImapSmtpCaldavEnabledState';
import { isMicrosoftCalendarEnabledState } from '@/client-config/states/isMicrosoftCalendarEnabledState';
import { isMicrosoftMessagingEnabledState } from '@/client-config/states/isMicrosoftMessagingEnabledState';
import {
  EMAIL_FORWARDING_MODAL_ID,
  SettingsAccountsEmailForwardingModal,
} from '@/settings/accounts/components/SettingsAccountsEmailForwardingModal';
import { useCreateEmailForwardingChannel } from '@/settings/accounts/hooks/useCreateEmailForwardingChannel';
import { useTriggerApisOAuth } from '@/settings/accounts/hooks/useTriggerApiOAuth';
import { SettingsCard } from '@/settings/components/SettingsCard';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useCallback, useContext, useState } from 'react';
import { ConnectedAccountProvider, SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { IconAt, IconGoogle, IconMail, IconMicrosoft } from 'twenty-ui/display';
import { UndecoratedLink } from 'twenty-ui/navigation';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledCardsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
`;

export const SettingsAccountsListEmptyStateCard = () => {
  const { theme } = useContext(ThemeContext);
  const { triggerApisOAuth } = useTriggerApisOAuth();

  const { t } = useLingui();
  const { enqueueErrorSnackBar } = useSnackBar();
  const { openModal } = useModal();
  const { createEmailForwardingChannel, loading: isCreatingForwarding } =
    useCreateEmailForwardingChannel();
  const [forwardingAddress, setForwardingAddress] = useState<string | null>(
    null,
  );

  const isGoogleMessagingEnabled = useAtomStateValue(
    isGoogleMessagingEnabledState,
  );
  const isMicrosoftMessagingEnabled = useAtomStateValue(
    isMicrosoftMessagingEnabledState,
  );

  const isGoogleCalendarEnabled = useAtomStateValue(
    isGoogleCalendarEnabledState,
  );

  const isMicrosoftCalendarEnabled = useAtomStateValue(
    isMicrosoftCalendarEnabledState,
  );

  const isImapSmtpCaldavEnabled = useAtomStateValue(
    isImapSmtpCaldavEnabledState,
  );

  const handleCreateEmailForwardingChannel = useCallback(async () => {
    try {
      const result = await createEmailForwardingChannel();

      const address =
        result.data?.createEmailForwardingChannel.forwardingAddress;

      if (address) {
        setForwardingAddress(address);
        openModal(EMAIL_FORWARDING_MODAL_ID);
      }
    } catch {
      enqueueErrorSnackBar({
        message: t`Failed to create email forwarding channel. Email forwarding may not be configured on this server.`,
      });
    }
  }, [createEmailForwardingChannel, openModal, enqueueErrorSnackBar, t]);

  return (
    <>
      <StyledCardsContainer>
        {(isGoogleMessagingEnabled || isGoogleCalendarEnabled) && (
          <SettingsCard
            Icon={<IconGoogle size={theme.icon.size.md} />}
            title={t`Connect with Google`}
            onClick={() => triggerApisOAuth(ConnectedAccountProvider.GOOGLE)}
          />
        )}

        {(isMicrosoftMessagingEnabled || isMicrosoftCalendarEnabled) && (
          <SettingsCard
            Icon={<IconMicrosoft size={theme.icon.size.md} />}
            title={t`Connect with Microsoft`}
            onClick={() => triggerApisOAuth(ConnectedAccountProvider.MICROSOFT)}
          />
        )}

        {isImapSmtpCaldavEnabled && (
          <UndecoratedLink
            to={getSettingsPath(SettingsPath.NewImapSmtpCaldavConnection)}
          >
            <SettingsCard
              Icon={<IconAt size={theme.icon.size.md} />}
              title={t`Connect Account`}
            />
          </UndecoratedLink>
        )}

        <SettingsCard
          Icon={<IconMail size={theme.icon.size.md} />}
          title={t`Add Email Forwarding`}
          description={t`Receive emails from a shared mailbox or Google Group`}
          disabled={isCreatingForwarding}
          onClick={handleCreateEmailForwardingChannel}
        />
      </StyledCardsContainer>

      {forwardingAddress && (
        <SettingsAccountsEmailForwardingModal
          forwardingAddress={forwardingAddress}
          onClose={() => setForwardingAddress(null)}
        />
      )}
    </>
  );
};
