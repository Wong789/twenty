import { aiModelsState } from '@/client-config/states/aiModelsState';
import { isCodeInterpreterEnabledState } from '@/client-config/states/isCodeInterpreterEnabledState';
import { InputLabel } from '@/ui/input/components/InputLabel';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import {
  type AgentCapability,
  isAgentCapabilityEnabled,
  type ModelConfiguration,
} from 'twenty-shared/ai';
import { IconBrandX, IconCode, IconWorld } from 'twenty-ui/display';
import { Section } from 'twenty-ui/layout';
import { MenuItemToggle } from 'twenty-ui/navigation';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledCapabilitiesContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
`;

type SettingsAgentModelCapabilitiesProps = {
  selectedModelId: string;
  modelConfiguration: ModelConfiguration;
  onConfigurationChange: (configuration: ModelConfiguration) => void;
  disabled?: boolean;
};

export const SettingsAgentModelCapabilities = ({
  selectedModelId,
  modelConfiguration,
  onConfigurationChange,
  disabled = false,
}: SettingsAgentModelCapabilitiesProps) => {
  const aiModels = useAtomStateValue(aiModelsState);
  const isCodeInterpreterEnabled = useAtomStateValue(
    isCodeInterpreterEnabledState,
  );

  const selectedModel = aiModels.find((m) => m.modelId === selectedModelId);
  const modelCapabilities = selectedModel?.capabilities;

  if (
    !modelCapabilities?.webSearch &&
    !modelCapabilities?.twitterSearch &&
    !isCodeInterpreterEnabled
  ) {
    return null;
  }

  const handleCapabilityToggle = (
    capability: AgentCapability,
    enabled: boolean,
  ) => {
    if (disabled) {
      return;
    }

    onConfigurationChange({
      ...modelConfiguration,
      [capability]: {
        enabled,
        configuration: modelConfiguration[capability]?.configuration || {},
      },
    });
  };

  const capabilityItems = [
    ...(modelCapabilities?.webSearch
      ? [
          {
            key: 'webSearch' as const,
            label: t`Web Search`,
            Icon: IconWorld,
            enabled: isAgentCapabilityEnabled(modelConfiguration, 'webSearch'),
          },
        ]
      : []),
    ...(modelCapabilities?.twitterSearch
      ? [
          {
            key: 'twitterSearch' as const,
            label: t`Twitter/X Search`,
            Icon: IconBrandX,
            enabled: isAgentCapabilityEnabled(
              modelConfiguration,
              'twitterSearch',
            ),
          },
        ]
      : []),
    ...(isCodeInterpreterEnabled
      ? [
          {
            key: 'codeInterpreter' as const,
            label: t`Code Interpreter`,
            Icon: IconCode,
            enabled: isAgentCapabilityEnabled(
              modelConfiguration,
              'codeInterpreter',
            ),
          },
        ]
      : []),
  ];

  return (
    <Section>
      <InputLabel>{t`Capabilities`}</InputLabel>
      <StyledCapabilitiesContainer>
        {capabilityItems.map((capability) => (
          <MenuItemToggle
            key={capability.key}
            LeftIcon={capability.Icon}
            text={capability.label}
            toggled={capability.enabled}
            onToggleChange={(toggled) =>
              handleCapabilityToggle(capability.key, toggled)
            }
            disabled={disabled}
          />
        ))}
      </StyledCapabilitiesContainer>
    </Section>
  );
};
