import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddPermissionFlagRoleIdIndex1775090400000
  implements MigrationInterface
{
  name = 'AddPermissionFlagRoleIdIndex1775090400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_PERMISSION_FLAG_ROLE_ID" ON "core"."permissionFlag" ("roleId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "core"."IDX_PERMISSION_FLAG_ROLE_ID"`,
    );
  }
}
