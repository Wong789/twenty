import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('AdminChatMessagePart')
export class AdminChatMessagePartDTO {
  @Field(() => String)
  type: string;

  @Field(() => String, { nullable: true })
  textContent: string | null;

  @Field(() => String, { nullable: true })
  toolName: string | null;
}

@ObjectType('AdminChatMessage')
export class AdminChatMessageDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  role: string;

  @Field(() => [AdminChatMessagePartDTO])
  parts: AdminChatMessagePartDTO[];

  @Field(() => Date)
  createdAt: Date;
}
