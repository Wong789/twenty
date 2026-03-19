import { DataSource, type EntityMetadata, Repository } from 'typeorm';

import { WorkspaceExportService } from 'src/database/commands/workspace-export/workspace-export.service';

type MockColumnMetadata = {
  databaseName: string;
  isNullable?: boolean;
  referencedColumn?: MockColumnMetadata;
};

type MockRelationMetadata = {
  inverseEntityMetadata: EntityMetadata;
  isNullable?: boolean;
  joinColumns: MockColumnMetadata[];
  inverseRelation?: MockRelationMetadata;
};

function makeColumn({
  databaseName,
  isNullable = false,
  referencedColumnName,
}: {
  databaseName: string;
  isNullable?: boolean;
  referencedColumnName?: string;
}): MockColumnMetadata {
  return {
    databaseName,
    isNullable,
    referencedColumn: referencedColumnName
      ? { databaseName: referencedColumnName }
      : undefined,
  };
}

function makeEntityMetadata({
  tableName,
  columns = [],
  manyToOneRelations = [],
}: {
  tableName: string;
  columns?: MockColumnMetadata[];
  manyToOneRelations?: MockRelationMetadata[];
}): EntityMetadata {
  return {
    tableName,
    schema: 'core',
    columns,
    manyToOneRelations,
  } as EntityMetadata;
}

function makeRelationMetadata({
  inverseEntityMetadata,
  isNullable = false,
  joinColumns,
  inverseRelation,
}: {
  inverseEntityMetadata: EntityMetadata;
  isNullable?: boolean;
  joinColumns: MockColumnMetadata[];
  inverseRelation?: MockRelationMetadata;
}): MockRelationMetadata {
  return {
    inverseEntityMetadata,
    isNullable,
    joinColumns,
    inverseRelation,
  };
}

function discover(entityMetadatas: EntityMetadata[]): Map<string, string> {
  const service = new WorkspaceExportService(
    { entityMetadatas } as DataSource,
    {} as Repository<any>,
    {} as Repository<any>,
  );

  return new Map(
    (
      (service as any).discoverWorkspaceScopedEntities() as Array<{
        entityMetadata: EntityMetadata;
        whereClause: string;
      }>
    ).map(({ entityMetadata, whereClause }) => [
      entityMetadata.tableName,
      whereClause,
    ]),
  );
}

describe('WorkspaceExportService', () => {
  it('discovers direct, forward, and required reverse relations', () => {
    const workspace = makeEntityMetadata({
      tableName: 'workspace',
      columns: [makeColumn({ databaseName: 'id' })],
    });
    const user = makeEntityMetadata({
      tableName: 'user',
      columns: [makeColumn({ databaseName: 'id' })],
    });
    const userWorkspace = makeEntityMetadata({
      tableName: 'userWorkspace',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'workspaceId' }),
        makeColumn({ databaseName: 'userId' }),
      ],
    });
    const indexMetadata = makeEntityMetadata({
      tableName: 'indexMetadata',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'workspaceId' }),
      ],
    });
    const indexFieldMetadata = makeEntityMetadata({
      tableName: 'indexFieldMetadata',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'indexMetadataId' }),
      ],
    });

    userWorkspace.manyToOneRelations = [
      makeRelationMetadata({
        inverseEntityMetadata: user,
        isNullable: true,
        joinColumns: [
          makeColumn({
            databaseName: 'userId',
            referencedColumnName: 'id',
          }),
        ],
        inverseRelation: {} as MockRelationMetadata,
      }),
    ] as EntityMetadata['manyToOneRelations'];
    indexFieldMetadata.manyToOneRelations = [
      makeRelationMetadata({
        inverseEntityMetadata: indexMetadata,
        joinColumns: [
          makeColumn({
            databaseName: 'indexMetadataId',
            referencedColumnName: 'id',
          }),
        ],
      }),
    ] as EntityMetadata['manyToOneRelations'];

    const scopedEntities = discover([
      workspace,
      user,
      userWorkspace,
      indexMetadata,
      indexFieldMetadata,
    ]);

    expect(scopedEntities.get('userWorkspace')).toBe('"workspaceId" = $1');
    expect(scopedEntities.get('user')).toBe(
      '"id" IN (SELECT "userId" FROM "core"."userWorkspace" WHERE "workspaceId" = $1)',
    );
    expect(scopedEntities.get('indexMetadata')).toBe('"workspaceId" = $1');
    expect(scopedEntities.get('indexFieldMetadata')).toBe(
      '"indexMetadataId" IN (SELECT "id" FROM "core"."indexMetadata" WHERE "workspaceId" = $1)',
    );
  });

  it('does not reverse-include optional bidirectional relations', () => {
    const workspace = makeEntityMetadata({
      tableName: 'workspace',
      columns: [makeColumn({ databaseName: 'id' })],
    });
    const user = makeEntityMetadata({
      tableName: 'user',
      columns: [makeColumn({ databaseName: 'id' })],
    });
    const appToken = makeEntityMetadata({
      tableName: 'appToken',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'workspaceId' }),
        makeColumn({ databaseName: 'userId', isNullable: true }),
      ],
    });

    appToken.manyToOneRelations = [
      makeRelationMetadata({
        inverseEntityMetadata: user,
        isNullable: true,
        joinColumns: [
          makeColumn({
            databaseName: 'userId',
            isNullable: true,
            referencedColumnName: 'id',
          }),
        ],
        inverseRelation: {} as MockRelationMetadata,
      }),
    ] as EntityMetadata['manyToOneRelations'];

    const scopedEntities = discover([workspace, user, appToken]);

    expect(scopedEntities.get('appToken')).toBe('"workspaceId" = $1');
    expect(scopedEntities.has('user')).toBe(false);
  });

  it('does not reverse-include unidirectional relations', () => {
    const workspace = makeEntityMetadata({
      tableName: 'workspace',
      columns: [makeColumn({ databaseName: 'id' })],
    });
    const billingSubscription = makeEntityMetadata({
      tableName: 'billingSubscription',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'workspaceId' }),
      ],
    });
    const billingSubscriptionItem = makeEntityMetadata({
      tableName: 'billingSubscriptionItem',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'billingSubscriptionId' }),
        makeColumn({ databaseName: 'stripeProductId' }),
      ],
    });
    const billingProduct = makeEntityMetadata({
      tableName: 'billingProduct',
      columns: [
        makeColumn({ databaseName: 'id' }),
        makeColumn({ databaseName: 'stripeProductId' }),
      ],
    });

    billingSubscriptionItem.manyToOneRelations = [
      makeRelationMetadata({
        inverseEntityMetadata: billingSubscription,
        joinColumns: [
          makeColumn({
            databaseName: 'billingSubscriptionId',
            referencedColumnName: 'id',
          }),
        ],
      }),
      makeRelationMetadata({
        inverseEntityMetadata: billingProduct,
        joinColumns: [
          makeColumn({
            databaseName: 'stripeProductId',
            referencedColumnName: 'stripeProductId',
          }),
        ],
      }),
    ] as EntityMetadata['manyToOneRelations'];

    const scopedEntities = discover([
      workspace,
      billingSubscription,
      billingSubscriptionItem,
      billingProduct,
    ]);

    expect(scopedEntities.get('billingSubscription')).toBe(
      '"workspaceId" = $1',
    );
    expect(scopedEntities.get('billingSubscriptionItem')).toBe(
      '"billingSubscriptionId" IN (SELECT "id" FROM "core"."billingSubscription" WHERE "workspaceId" = $1)',
    );
    expect(scopedEntities.has('billingProduct')).toBe(false);
  });
});
