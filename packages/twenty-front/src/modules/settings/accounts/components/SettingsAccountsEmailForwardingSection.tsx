import { type MessageChannel } from '@/accounts/types/MessageChannel';
import { useMyConnectedAccounts } from '@/settings/accounts/hooks/useMyConnectedAccounts';
import { useMyMessageChannels } from '@/settings/accounts/hooks/useMyMessageChannels';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { MessageChannelType } from 'twenty-shared/types';
import { H2Title, IconCopy, IconMail } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { Card, CardContent, Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard';

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[2]};
`;

const StyledLeft = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  min-width: 0;
`;

const StyledHandle = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
  white-space: nowrap;
`;

const StyledAddress = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-family: monospace;
  font-size: ${themeCssVariables.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledArrow = styled.span`
  color: ${themeCssVariables.font.color.light};
  flex-shrink: 0;
`;

type ForwardingChannelRow = {
  channelId: string;
  handle: string;
  forwardingAddress: string;
};

export const SettingsAccountsEmailForwardingSection = () => {
  const { t } = useLingui();
  const { copyToClipboard } = useCopyToClipboard();
  const { channels } = useMyMessageChannels();
  const { accounts } = useMyConnectedAccounts();

  const forwardingRows = useMemo<ForwardingChannelRow[]>(() => {
    const accountHandleMap = new Map<string, string>();

    for (const account of accounts) {
      accountHandleMap.set(account.id, account.handle);
    }

    return channels
      .filter(
        (ch): ch is MessageChannel =>
          ch.type === MessageChannelType.EMAIL_FORWARDING,
      )
      .map((ch) => ({
        channelId: ch.id,
        handle: accountHandleMap.get(ch.connectedAccountId) ?? ch.handle,
        forwardingAddress: ch.handle,
      }));
  }, [channels, accounts]);

  if (forwardingRows.length === 0) {
    return null;
  }

  return (
    <Section>
      <H2Title
        title={t`Email Forwarding`}
        description={t`Forward emails from these addresses to their corresponding Twenty forwarding address.`}
      />
      <Card rounded>
        {forwardingRows.map((row) => (
          <CardContent key={row.channelId}>
            <StyledRow>
              <StyledLeft>
                <IconMail size={16} />
                <StyledHandle>{row.handle}</StyledHandle>
                <StyledArrow>{'\u2192'}</StyledArrow>
                <StyledAddress>{row.forwardingAddress}</StyledAddress>
              </StyledLeft>
              <Button
                Icon={IconCopy}
                title={t`Copy`}
                variant="secondary"
                size="small"
                onClick={() =>
                  copyToClipboard(
                    row.forwardingAddress,
                    t`Forwarding address copied to clipboard`,
                  )
                }
              />
            </StyledRow>
          </CardContent>
        ))}
      </Card>
    </Section>
  );
};
