import { Field, ObjectType } from '@nestjs/graphql';

import { IsDateString } from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { AgentMessageDTO } from 'src/engine/metadata-modules/ai/ai-agent-execution/dtos/agent-message.dto';
import { AgentTurnThreadSummaryDTO } from 'src/engine/metadata-modules/ai/ai-agent-execution/dtos/agent-turn-thread-summary.dto';
import { AgentTurnEvaluationDTO } from 'src/engine/metadata-modules/ai/ai-agent-monitor/dtos/agent-turn-evaluation.dto';

@ObjectType('AgentTurn')
export class AgentTurnDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => UUIDScalarType)
  threadId: string;

  @Field(() => UUIDScalarType, { nullable: true })
  agentId: string | null;

  @Field(() => [AgentTurnEvaluationDTO])
  evaluations: AgentTurnEvaluationDTO[];

  @Field(() => [AgentMessageDTO])
  messages: AgentMessageDTO[];

  @Field(() => AgentTurnThreadSummaryDTO, { nullable: true })
  thread: AgentTurnThreadSummaryDTO | null;

  @IsDateString()
  @Field()
  createdAt: Date;
}
