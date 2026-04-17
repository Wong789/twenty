import { UseGuards } from '@nestjs/common';
import { Float, Parent, ResolveField } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { toDisplayCredits } from 'src/engine/core-modules/usage/utils/to-display-credits.util';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { AgentTurnThreadSummaryDTO } from 'src/engine/metadata-modules/ai/ai-agent-execution/dtos/agent-turn-thread-summary.dto';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';

@UseGuards(WorkspaceAuthGuard, SettingsPermissionGuard(PermissionFlagType.AI))
@MetadataResolver(() => AgentTurnThreadSummaryDTO)
export class AgentTurnThreadSummaryResolver {
  @ResolveField(() => Float)
  totalInputCredits(@Parent() thread: AgentChatThreadEntity): number {
    return toDisplayCredits(thread.totalInputCredits);
  }

  @ResolveField(() => Float)
  totalOutputCredits(@Parent() thread: AgentChatThreadEntity): number {
    return toDisplayCredits(thread.totalOutputCredits);
  }
}
