import { useChangePageLayoutDragSelection } from '@/page-layout/hooks/edit/useChangePageLayoutDragSelection';
import { useEndPageLayoutDragSelection } from '@/page-layout/hooks/edit/useEndPageLayoutDragSelection';
import { useStartPageLayoutDragSelection } from '@/page-layout/hooks/edit/useStartPageLayoutDragSelection';
import { DragSelect } from '@/ui/utilities/drag-select/components/DragSelect';
import { type RefObject } from 'react';

export const PageLayoutGridLayoutDragSelector = ({
  gridContainerRef,
}: {
  gridContainerRef: RefObject<HTMLDivElement>;
}) => {
  const { startPageLayoutDragSelection } = useStartPageLayoutDragSelection();
  const { changePageLayoutDragSelection } = useChangePageLayoutDragSelection();
  const { endPageLayoutDragSelection } = useEndPageLayoutDragSelection();

  return (
    <DragSelect
      selectableItemsContainerRef={gridContainerRef}
      onDragSelectionStart={startPageLayoutDragSelection}
      onDragSelectionChange={changePageLayoutDragSelection}
      onDragSelectionEnd={endPageLayoutDragSelection}
    />
  );
};
