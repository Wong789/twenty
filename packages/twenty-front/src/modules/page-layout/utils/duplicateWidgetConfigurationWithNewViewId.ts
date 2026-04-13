import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import { v4 as uuidv4 } from 'uuid';
import { WidgetConfigurationType } from '~/generated-metadata/graphql';

export const duplicateWidgetConfigurationWithNewViewId = (
  configuration: PageLayoutWidget['configuration'],
): PageLayoutWidget['configuration'] => {
  if (configuration.configurationType === WidgetConfigurationType.FIELDS) {
    return {
      ...configuration,
      viewId: uuidv4(),
    };
  }

  return configuration;
};
