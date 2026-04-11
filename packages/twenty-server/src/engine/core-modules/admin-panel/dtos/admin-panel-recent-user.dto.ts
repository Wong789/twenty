import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('AdminPanelRecentUser')
export class AdminPanelRecentUserDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  email: string;

  @Field(() => String, { nullable: true })
  firstName?: string | null;

  @Field(() => String, { nullable: true })
  lastName?: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => String, { nullable: true })
  workspaceName?: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  workspaceId?: string | null;
}
