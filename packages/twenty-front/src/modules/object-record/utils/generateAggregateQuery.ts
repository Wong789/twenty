import gql from 'graphql-tag';

import { type ObjectMetadataItem } from '@/object-metadata/types/ObjectMetadataItem';
import { type RecordGqlFields } from '@/object-record/graphql/record-gql-fields/types/RecordGqlFields';
import { getAggregateQueryName } from '@/object-record/utils/getAggregateQueryName';
import { capitalize } from 'twenty-shared/utils';

// Aggregate queries use a GraphQL alias to avoid Apollo cache collisions
// with findMany queries that target the same field (e.g. Query.companies).
// Without the alias, both queries write to the same cache key, causing
// the aggregate result to overwrite the findMany result (or vice versa).
export const getAggregateQueryAlias = (namePlural: string): string =>
  `aggregate_${namePlural}`;

export const generateAggregateQuery = ({
  objectMetadataItem,
  recordGqlFields,
}: {
  objectMetadataItem: ObjectMetadataItem;
  recordGqlFields: RecordGqlFields;
}) => {
  const selectedFields = Object.entries(recordGqlFields)
    .filter(([_, shouldBeQueried]) => Boolean(shouldBeQueried))
    .map(([fieldName]) => fieldName)
    .join('\n      ');

  const alias = getAggregateQueryAlias(objectMetadataItem.namePlural);

  return gql`
    query ${getAggregateQueryName(objectMetadataItem.namePlural)}($filter: ${capitalize(
      objectMetadataItem.nameSingular,
    )}FilterInput) {
      ${alias}: ${objectMetadataItem.namePlural}(filter: $filter) {
        ${selectedFields ? '' : '__typename'}
        ${selectedFields}
      }
    }
  `;
};
