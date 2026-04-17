import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('AgentTurnThreadSummary')
export class AgentTurnThreadSummaryDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => Int)
  totalInputTokens: number;

  @Field(() => Int)
  totalOutputTokens: number;

  // Credits are converted from internal precision to display precision
  // (internal / 1000) at the resolver level. 1000 display credits = $1.
  @Field(() => Float)
  totalInputCredits: number;

  @Field(() => Float)
  totalOutputCredits: number;
}
