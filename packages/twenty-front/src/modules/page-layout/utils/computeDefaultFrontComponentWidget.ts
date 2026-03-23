import { type PageLayoutWidget } from '@/page-layout/types/PageLayoutWidget';
import {
  type GridPosition,
  PageLayoutTabLayoutMode,
  WidgetConfigurationType,
  WidgetType,
} from '~/generated-metadata/graphql';

export const computeDefaultFrontComponentWidget = (
  id: string,
  pageLayoutTabId: string,
  title: string,
  frontComponentId: string,
  gridPosition: GridPosition,
): PageLayoutWidget => {
  return {
    __typename: 'PageLayoutWidget',
    id,
    pageLayoutTabId,
    title,
    type: WidgetType.FRONT_COMPONENT,
    configuration: {
      __typename: 'FrontComponentConfiguration',
      configurationType: WidgetConfigurationType.FRONT_COMPONENT,
      frontComponentId,
    },
    gridPosition,
    position: {
      __typename: 'PageLayoutWidgetGridPosition',
      layoutMode: PageLayoutTabLayoutMode.GRID,
      row: gridPosition.row,
      column: gridPosition.column,
      rowSpan: gridPosition.rowSpan,
      columnSpan: gridPosition.columnSpan,
    },
    objectMetadataId: null,
    isOverridden: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
};
