import { useContext } from 'react';

import { recordStoreFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreFamilySelector';
import { FieldMetadataType } from '~/generated-metadata/graphql';

import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { assertFieldMetadata } from '@/object-record/record-field/ui/types/guards/assertFieldMetadata';
import { isFieldBoolean } from '@/object-record/record-field/ui/types/guards/isFieldBoolean';
import { isFieldBooleanValue } from '@/object-record/record-field/ui/types/guards/isFieldBooleanValue';
import { useAtomFamilySelectorState } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorState';

export const useBooleanField = () => {
  const { recordId, fieldDefinition } = useContext(FieldContext);

  assertFieldMetadata(
    FieldMetadataType.BOOLEAN,
    isFieldBoolean,
    fieldDefinition,
  );

  const fieldName = fieldDefinition.metadata.fieldName;

  const [fieldValue, setFieldValue] = useAtomFamilySelectorState(
    recordStoreFamilySelector,
    { recordId, fieldName },
  );

  const typedFieldValue = isFieldBooleanValue(fieldValue) ? fieldValue : false;

  return {
    fieldDefinition,
    fieldValue: typedFieldValue,
    setFieldValue,
  };
};
