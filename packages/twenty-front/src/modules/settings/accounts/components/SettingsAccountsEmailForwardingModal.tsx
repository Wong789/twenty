import { ModalStatefulWrapper } from '@/ui/layout/modal/components/ModalStatefulWrapper';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { IconCopy, IconMail } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard';

export const EMAIL_FORWARDING_MODAL_ID = 'email-forwarding-address-modal';

const StyledModalContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[6]};
  padding: ${themeCssVariables.spacing[6]};
`;

const StyledTitle = styled.h2`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: 0;
`;

const StyledDescription = styled.p`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.5;
  margin: 0;
`;

const StyledAddressContainer = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.lighter};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[3]} ${themeCssVariables.spacing[4]};
`;

const StyledAddress = styled.span`
  color: ${themeCssVariables.font.color.primary};
  flex: 1;
  font-family: monospace;
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledInstructions = styled.ol`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: 1.6;
  margin: 0;
  padding-left: ${themeCssVariables.spacing[6]};
`;

const StyledButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
`;

type SettingsAccountsEmailForwardingModalProps = {
  forwardingAddress: string;
  onClose?: () => void;
};

export const SettingsAccountsEmailForwardingModal = ({
  forwardingAddress,
  onClose,
}: SettingsAccountsEmailForwardingModalProps) => {
  const { t } = useLingui();
  const { copyToClipboard } = useCopyToClipboard();
  const { closeModal } = useModal();

  return (
    <ModalStatefulWrapper
      modalInstanceId={EMAIL_FORWARDING_MODAL_ID}
      size="medium"
      isClosable
    >
      <StyledModalContent>
        <StyledTitle>{t`Email Forwarding Channel Created`}</StyledTitle>
        <StyledDescription>
          {t`Add this address to a Google Group or Microsoft 365 shared mailbox to start receiving emails in Twenty.`}
        </StyledDescription>

        <StyledAddressContainer>
          <IconMail size={16} />
          <StyledAddress>{forwardingAddress}</StyledAddress>
          <Button
            Icon={IconCopy}
            title={t`Copy`}
            variant="secondary"
            size="small"
            onClick={() =>
              copyToClipboard(
                forwardingAddress,
                t`Forwarding address copied to clipboard`,
              )
            }
          />
        </StyledAddressContainer>

        <StyledInstructions>
          <li>{t`Copy the forwarding address above`}</li>
          <li>{t`Add it as a member of your Google Group or Microsoft 365 shared mailbox`}</li>
          <li>{t`Emails sent to the group will automatically appear in Twenty`}</li>
        </StyledInstructions>

        <StyledButtonContainer>
          <Button
            title={t`Done`}
            variant="primary"
            size="small"
            onClick={() => {
              closeModal(EMAIL_FORWARDING_MODAL_ID);
              onClose?.();
            }}
          />
        </StyledButtonContainer>
      </StyledModalContent>
    </ModalStatefulWrapper>
  );
};
