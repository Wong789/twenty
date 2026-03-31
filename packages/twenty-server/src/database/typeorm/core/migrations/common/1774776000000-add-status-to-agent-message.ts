import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusToAgentMessage1774776000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "core"."agentMessage_status_enum" AS ENUM ('queued', 'sent')`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."agentMessage" ADD COLUMN "status" "core"."agentMessage_status_enum" NOT NULL DEFAULT 'sent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."agentMessage" ALTER COLUMN "turnId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "core"."agentMessage" WHERE "turnId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."agentMessage" ALTER COLUMN "turnId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."agentMessage" DROP COLUMN "status"`,
    );
    await queryRunner.query(`DROP TYPE "core"."agentMessage_status_enum"`);
  }
}
