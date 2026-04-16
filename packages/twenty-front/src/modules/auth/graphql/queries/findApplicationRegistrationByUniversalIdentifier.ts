import { gql } from '@apollo/client';
import { APPLICATION_REGISTRATION_FRAGMENT } from '@/settings/application-registrations/graphql/fragments/applicationRegistrationFragment';

export const FIND_APPLICATION_REGISTRATION_BY_UNIVERSAL_IDENTIFIER = gql`
  query findApplicationRegistrationByUniversalIdentifier(
    $universalIdentifier: String!
  ) {
    findApplicationRegistrationByUniversalIdentifier(
      universalIdentifier: $universalIdentifier
    ) {
      ...ApplicationRegistrationFragment
    }
    ${APPLICATION_REGISTRATION_FRAGMENT}
  }
`;
