import { QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('1.23.0', 1786375159878)
export class MakeAgentChatThreadSourcePolymorphicFastInstanceCommand
  implements FastInstanceCommand
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" ADD "workflowRunId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" ADD "workflowStepId" varchar',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" ALTER COLUMN "userWorkspaceId" DROP NOT NULL',
    );
    await queryRunner.query(
      `ALTER TABLE "core"."agentChatThread" ADD CONSTRAINT "CHK_agent_chat_thread_source" CHECK (("userWorkspaceId" IS NOT NULL AND "workflowRunId" IS NULL AND "workflowStepId" IS NULL) OR ("userWorkspaceId" IS NULL AND "workflowRunId" IS NOT NULL AND "workflowStepId" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_AGENT_CHAT_THREAD_WORKFLOW" ON "core"."agentChatThread" ("workspaceId", "workflowRunId", "workflowStepId") WHERE "workflowRunId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "core"."IDX_AGENT_CHAT_THREAD_WORKFLOW"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" DROP CONSTRAINT IF EXISTS "CHK_agent_chat_thread_source"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" ALTER COLUMN "userWorkspaceId" SET NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" DROP COLUMN "workflowStepId"',
    );
    await queryRunner.query(
      'ALTER TABLE "core"."agentChatThread" DROP COLUMN "workflowRunId"',
    );
  }
}
