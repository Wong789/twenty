import { gql } from '@apollo/client';

export const AGGREGATE_QUERY = gql`
  query AggregateOpportunities($filter: OpportunityFilterInput) {
    aggregate_opportunities: opportunities(filter: $filter) {
      totalCount
      sumAmount
      avgAmount
    }
  }
`;

export const mockResponse = {
  aggregate_opportunities: {
    totalCount: 42,
    sumAmount: 1000000,
    avgAmount: 23800,
  },
};
