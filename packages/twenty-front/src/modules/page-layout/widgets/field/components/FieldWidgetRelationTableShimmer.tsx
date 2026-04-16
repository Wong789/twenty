import { SKELETON_LOADER_HEIGHT_SIZES } from '@/activities/components/SkeletonLoader';
import { styled } from '@linaria/react';
import { useContext } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledRow = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
`;

const SHIMMER_ROW_COUNT = 5;
const SHIMMER_COLUMN_WIDTHS = [140, 100, 120, 80];

export const FieldWidgetRelationTableShimmer = () => {
  const { theme } = useContext(ThemeContext);

  return (
    <SkeletonTheme
      baseColor={theme.background.tertiary}
      highlightColor={theme.background.transparent.lighter}
      borderRadius={4}
    >
      <StyledContainer>
        {Array.from({ length: SHIMMER_ROW_COUNT }).map((_, rowIndex) => (
          <StyledRow key={rowIndex}>
            {SHIMMER_COLUMN_WIDTHS.map((width, columnIndex) => (
              <Skeleton
                key={columnIndex}
                width={width}
                height={SKELETON_LOADER_HEIGHT_SIZES.standard.m}
              />
            ))}
          </StyledRow>
        ))}
      </StyledContainer>
    </SkeletonTheme>
  );
};
