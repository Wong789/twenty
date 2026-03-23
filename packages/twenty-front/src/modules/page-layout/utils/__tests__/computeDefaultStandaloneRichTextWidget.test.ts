import { computeDefaultStandaloneRichTextWidget } from '@/page-layout/utils/computeDefaultStandaloneRichTextWidget';
import {
  PageLayoutTabLayoutMode,
  WidgetType,
} from '~/generated-metadata/graphql';

describe('computeDefaultStandaloneRichTextWidget', () => {
  it('should create a standalone rich text widget with correct structure', () => {
    const widget = computeDefaultStandaloneRichTextWidget(
      'widget-1',
      'tab-1',
      { blocknote: '[{"type":"paragraph","content":"Test"}]' },
      { row: 0, column: 0, rowSpan: 4, columnSpan: 4 },
    );

    expect(widget).toMatchObject({
      __typename: 'PageLayoutWidget',
      id: 'widget-1',
      pageLayoutTabId: 'tab-1',
      type: WidgetType.STANDALONE_RICH_TEXT,
      title: 'Untitled Rich Text',
      configuration: {
        body: { blocknote: '[{"type":"paragraph","content":"Test"}]' },
      },
      gridPosition: { row: 0, column: 0, rowSpan: 4, columnSpan: 4 },
      position: {
        __typename: 'PageLayoutWidgetGridPosition',
        layoutMode: PageLayoutTabLayoutMode.GRID,
        row: 0,
        column: 0,
        rowSpan: 4,
        columnSpan: 4,
      },
    });
  });

  it('should use provided objectMetadataId or default to null', () => {
    const withObjectId = computeDefaultStandaloneRichTextWidget(
      'w1',
      't1',
      { blocknote: '[]' },
      { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
      'object-1',
    );

    const withoutObjectId = computeDefaultStandaloneRichTextWidget(
      'w2',
      't1',
      { blocknote: '[]' },
      { row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
    );

    expect(withObjectId.objectMetadataId).toBe('object-1');
    expect(withoutObjectId.objectMetadataId).toBeNull();
  });
});
