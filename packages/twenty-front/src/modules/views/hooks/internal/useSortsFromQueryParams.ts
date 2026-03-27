import qs from 'qs';
import { useCallback, useMemo } from 'react';

import { objectMetadataItemFamilySelector } from '@/object-metadata/states/objectMetadataItemFamilySelector';
import { type RecordSort } from '@/object-record/record-sort/types/RecordSort';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { sortUrlQueryParamsSchema } from '@/views/schemas/sortUrlQueryParamsSchema';
import { useParams, useSearchParams } from 'react-router-dom';
import { isDefined } from 'twenty-shared/utils';
import { type ViewSortDirection } from '~/generated-metadata/graphql';

export const useSortsFromQueryParams = () => {
  const [searchParams] = useSearchParams();
  const { objectNamePlural = '' } = useParams();

  const objectMetadataItem = useAtomFamilySelectorValue(
    objectMetadataItemFamilySelector,
    {
      objectName: objectNamePlural,
      objectNameType: 'plural',
    },
  );

  const queryParamsValidation = sortUrlQueryParamsSchema.safeParse(
    qs.parse(searchParams.toString()),
  );

  const sortQueryParams = useMemo(
    () =>
      queryParamsValidation.success ? queryParamsValidation.data.sort : {},
    [queryParamsValidation],
  );

  const hasSortsQueryParams =
    isDefined(sortQueryParams) && Object.entries(sortQueryParams).length > 0;

  const fields = objectMetadataItem?.fields ?? [];

  const getSortsFromQueryParams = useCallback((): RecordSort[] => {
    if (!hasSortsQueryParams) return [];

    return Object.entries(sortQueryParams)
      .map(([fieldName, direction]) => {
        const fieldMetadataItem = fields.find(
          (field) => field.name === fieldName,
        );

        if (!fieldMetadataItem) return null;

        return {
          id: `tmp-sort-${fieldName}`,
          fieldMetadataId: fieldMetadataItem.id,
          direction: direction as ViewSortDirection,
        };
      })
      .filter(isDefined);
  }, [hasSortsQueryParams, sortQueryParams, fields]);

  return {
    hasSortsQueryParams,
    getSortsFromQueryParams,
    objectMetadataItem,
  };
};
