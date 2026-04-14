import { styled } from '@linaria/react';
import { Suspense, lazy } from 'react';

import { LayoutRenderingProvider } from '@/ui/layout/contexts/LayoutRenderingContext';
import { PageLayoutType } from '~/generated-metadata/graphql';

const FrontComponentRenderer = lazy(() =>
  import('@/front-components/components/FrontComponentRenderer').then(
    (module) => ({ default: module.FrontComponentRenderer }),
  ),
);

const StyledContainer = styled.div`
  height: 100%;
  overflow: auto;
  width: 100%;
`;

type SettingsApplicationCustomTabProps = {
  settingsCustomTabFrontComponentId: string;
};

export const SettingsApplicationCustomTab = ({
  settingsCustomTabFrontComponentId,
}: SettingsApplicationCustomTabProps) => {
  return (
    <StyledContainer>
      <LayoutRenderingProvider
        value={{
          targetRecordIdentifier: undefined,
          layoutType: PageLayoutType.DASHBOARD,
          isInSidePanel: false,
        }}
      >
        <Suspense fallback={null}>
          <FrontComponentRenderer
            frontComponentId={settingsCustomTabFrontComponentId}
          />
        </Suspense>
      </LayoutRenderingProvider>
    </StyledContainer>
  );
};
