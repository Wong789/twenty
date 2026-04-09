import { useContext } from 'react';

import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { assertFieldMetadata } from '@/object-record/record-field/ui/types/guards/assertFieldMetadata';
import { isFieldTextValue } from '@/object-record/record-field/ui/types/guards/isFieldTextValue';
import { isFieldUuid } from '@/object-record/record-field/ui/types/guards/isFieldUuid';
import { recordStoreFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreFamilySelector';
import { useAtomFamilySelectorState } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorState';
import { FieldMetadataType } from '~/generated-metadata/graphql';

export const useUuidField = () => {
  const { recordId, fieldDefinition } = useContext(FieldContext);

  assertFieldMetadata(FieldMetadataType.UUID, isFieldUuid, fieldDefinition);

  const fieldName = fieldDefinition.metadata.fieldName;

  const [fieldValue, setFieldValue] = useAtomFamilySelectorState(
    recordStoreFamilySelector,
    { recordId, fieldName },
  );

  const fieldTextValue = isFieldTextValue(fieldValue) ? fieldValue : '';

  return {
    fieldDefinition,
    fieldValue: fieldTextValue,
    setFieldValue,
  };
};
