import { FieldMetadataType } from 'twenty-shared/types';

import { AI_SDK_OPENAI, AI_SDK_XAI } from 'src/engine/metadata-modules/ai/ai-models/constants/ai-sdk-package.const';
import { type AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

import { DatabaseToolProvider } from './database-tool.provider';

describe('DatabaseToolProvider', () => {
  const flatField = {
    id: 'field-id',
    universalIdentifier: 'company.name',
    name: 'name',
    type: FieldMetadataType.TEXT,
    isNullable: true,
    isSystem: false,
  } as const;

  const flatObject = {
    id: 'object-id',
    universalIdentifier: 'company',
    nameSingular: 'company',
    namePlural: 'companies',
    labelSingular: 'Company',
    labelPlural: 'Companies',
    fieldIds: [flatField.id],
    isActive: true,
    isSystem: false,
    icon: 'IconBuilding',
  } as const;

  const rolesPermissions = {
    'role-id': {
      [flatObject.id]: {
        canReadObjectRecords: true,
        canUpdateObjectRecords: true,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
        restrictedFields: {},
        rowLevelPermissionPredicates: [],
        rowLevelPermissionPredicateGroups: [],
      },
    },
  } as const;

  const flatObjectMetadataMaps = {
    byUniversalIdentifier: {
      [flatObject.universalIdentifier]: flatObject,
    },
    universalIdentifierById: {
      [flatObject.id]: flatObject.universalIdentifier,
    },
  };

  const flatFieldMetadataMaps = {
    byUniversalIdentifier: {
      [flatField.universalIdentifier]: flatField,
    },
    universalIdentifierById: {
      [flatField.id]: flatField.universalIdentifier,
    },
  };

  const createProvider = (sdkPackage: string) => {
    const workspaceCacheService = {
      getOrRecompute: jest.fn().mockResolvedValue({
        rolesPermissions,
      }),
    } as Pick<WorkspaceCacheService, 'getOrRecompute'>;

    const flatEntityMapsCacheService = {
      getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
        flatObjectMetadataMaps,
        flatFieldMetadataMaps,
      }),
    } as Pick<
      WorkspaceManyOrAllFlatEntityMapsCacheService,
      'getOrRecomputeManyOrAllFlatEntityMaps'
    >;

    const aiModelRegistryService = {
      resolveModelForAgent: jest.fn().mockReturnValue({
        sdkPackage,
      }),
    } as Pick<AiModelRegistryService, 'resolveModelForAgent'>;

    return new DatabaseToolProvider(
      workspaceCacheService as WorkspaceCacheService,
      flatEntityMapsCacheService as WorkspaceManyOrAllFlatEntityMapsCacheService,
      aiModelRegistryService as AiModelRegistryService,
    );
  };

  const context = {
    workspaceId: 'workspace-id',
    roleId: 'role-id',
    rolePermissionConfig: { unionOf: ['role-id'] },
    executionScope: 'workflow_agent' as const,
    agent: {
      modelId: 'xai/grok-4',
      modelConfiguration: {},
    },
  };

  it('excludes recursive-filter database tools for xai workflow agents', async () => {
    const provider = createProvider(AI_SDK_XAI);

    const descriptors = await provider.generateDescriptors(context, {
      includeSchemas: false,
    });

    const toolNames = descriptors.map((descriptor) => descriptor.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'find_one_company',
        'create_company',
        'create_many_companies',
        'update_company',
      ]),
    );
    expect(toolNames).not.toEqual(
      expect.arrayContaining([
        'find_companies',
        'group_by_companies',
        'update_many_companies',
      ]),
    );
  });

  it('keeps recursive-filter database tools for non-xai workflow agents', async () => {
    const provider = createProvider(AI_SDK_OPENAI);

    const descriptors = await provider.generateDescriptors(context, {
      includeSchemas: false,
    });

    const toolNames = descriptors.map((descriptor) => descriptor.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'find_companies',
        'find_one_company',
        'group_by_companies',
        'update_many_companies',
      ]),
    );
  });
});
