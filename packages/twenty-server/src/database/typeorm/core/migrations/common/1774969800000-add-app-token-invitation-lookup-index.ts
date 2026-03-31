import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddAppTokenInvitationLookupIndex1774969800000
  implements MigrationInterface
{
  name = 'AddAppTokenInvitationLookupIndex1774969800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_APP_TOKEN_TYPE_CONTEXT_EMAIL" ON "core"."appToken" ("type", (context->>'email')) WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "core"."IDX_APP_TOKEN_TYPE_CONTEXT_EMAIL"`,
    );
  }
}
