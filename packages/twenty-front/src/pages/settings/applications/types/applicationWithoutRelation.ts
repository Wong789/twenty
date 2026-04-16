import { type Application } from '~/generated-metadata/graphql';

export type ApplicationWithoutRelation = Pick<
  Application,
  | 'id'
  | 'universalIdentifier'
  | 'name'
  | 'description'
  | 'version'
  | 'applicationRegistrationId'
  | 'applicationRegistration'
>;
