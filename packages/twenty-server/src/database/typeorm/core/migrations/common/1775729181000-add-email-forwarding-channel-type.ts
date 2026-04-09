import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddEmailForwardingChannelType1775729181000
  implements MigrationInterface
{
  name = 'AddEmailForwardingChannelType1775729181000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "core"."messageChannel_type_enum" RENAME TO "messageChannel_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "core"."messageChannel_type_enum" AS ENUM('EMAIL', 'SMS', 'EMAIL_FORWARDING')`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."messageChannel" ALTER COLUMN "type" TYPE "core"."messageChannel_type_enum" USING "type"::"text"::"core"."messageChannel_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "core"."messageChannel_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "core"."messageChannel" WHERE "type" = 'EMAIL_FORWARDING'`,
    );
    await queryRunner.query(
      `CREATE TYPE "core"."messageChannel_type_enum_old" AS ENUM('EMAIL', 'SMS')`,
    );
    await queryRunner.query(
      `ALTER TABLE "core"."messageChannel" ALTER COLUMN "type" TYPE "core"."messageChannel_type_enum_old" USING "type"::"text"::"core"."messageChannel_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "core"."messageChannel_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "core"."messageChannel_type_enum_old" RENAME TO "messageChannel_type_enum"`,
    );
  }
}
