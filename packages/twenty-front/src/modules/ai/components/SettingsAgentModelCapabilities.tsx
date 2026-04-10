import { aiModelsState } from '@/client-config/states/aiModelsState';
import { InputLabel } from '@/ui/input/components/InputLabel';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { t } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { IconBrandX, IconWorld } from 'twenty-ui/display';
import { Section } from 'twenty-ui/layout';
import { MenuItemToggle } from 'twenty-ui/navigation';

type ModelConfiguration = {
  webSearch?: {
    enabled: boolean;
    configuration?: Record<string, unknown>;
  };
  twitterSearch?: {
    enabled: boolean;
    configuration?: Record<string, unknown>;
  };
};

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

  const selectedModel = aiModels.find((m) => m.modelId === selectedModelId);
  const capabilities = selectedModel?.capabilities;

  if (!isDefined(capabilities)) {
    return null;
  }

  if (!capabilities.webSearch && !capabilities.twitterSearch) {
    return null;
  }

  const handleCapabilityToggle = (
    capability: 'webSearch' | 'twitterSearch',
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
    ...(capabilities.webSearch
      ? [
          {
            key: 'webSearch' as const,
            label: t`Web Search`,
            Icon: IconWorld,
            enabled: modelConfiguration.webSearch?.enabled || false,
          },
        ]
      : []),
    ...(capabilities.twitterSearch
      ? [
          {
            key: 'twitterSearch' as const,
            label: t`Twitter/X Search`,
            Icon: IconBrandX,
            enabled: modelConfiguration.twitterSearch?.enabled || false,
          },
        ]
      : []),
  ];

  return (
    <Section>
      <InputLabel>{t`Capabilities`}</InputLabel>
      <div>
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
      </div>
    </Section>
  );
};
