import { FieldMetadataType } from 'twenty-shared/types';

// Raw string kept for pre-upgrade workspaces that haven't yet run
// the 1.20 migrate-rich-text-to-text command (RICH_TEXT V1 → TEXT).
export const isTextColumnType = (type: FieldMetadataType) => {
  return (
    type === FieldMetadataType.TEXT ||
    type === FieldMetadataType.ARRAY ||
    type === FieldMetadataType.RICH_TEXT ||
    (type as string) === 'RICH_TEXT'
  );
};
