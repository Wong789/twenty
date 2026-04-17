import { Logger } from '@nestjs/common';

import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceMigrationRunnerException } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/exceptions/workspace-migration-runner.exception';
import { type AllUniversalWorkspaceMigrationAction } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/workspace-migration-action-common';

import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';

describe('WorkspaceIteratorService', () => {
  describe('iterate - error logging', () => {
    let service: WorkspaceIteratorService;
    let loggerErrorSpy: jest.SpyInstance;

    const workspaceRepository = {
      findOne: jest.fn().mockResolvedValue({ databaseSchema: null }),
      find: jest.fn(),
    } as any;

    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (cb: () => Promise<unknown>) => cb(),
      ),
      getGlobalWorkspaceDataSource: jest.fn(),
    } as unknown as GlobalWorkspaceOrmManager;

    beforeEach(() => {
      jest.clearAllMocks();

      service = new WorkspaceIteratorService(
        workspaceRepository,
        globalWorkspaceOrmManager,
      );

      loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should log inner errors of WorkspaceMigrationRunnerException with their stacks', async () => {
      const workspaceId = '7914ba64-3b2a-4008-8a3d-b9f3fdd85740';

      const innerTranspilationError = new Error(
        'pageLayoutWidget with universalIdentifier "foo" already exists',
      );

      const action = {
        type: 'create',
        metadataName: 'pageLayoutWidget',
        flatEntity: { universalIdentifier: 'foo' },
      } as unknown as AllUniversalWorkspaceMigrationAction;

      const runnerException = new WorkspaceMigrationRunnerException({
        action,
        errors: { actionTranspilation: innerTranspilationError },
        code: 'EXECUTION_FAILED',
      });

      await service.iterate({
        workspaceIds: [workspaceId],
        callback: async () => {
          throw runnerException;
        },
      });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Error in workspace ${workspaceId}: Migration action 'create' for 'pageLayoutWidget' failed`,
        runnerException.stack,
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Caused by actionTranspilation in workspace ${workspaceId}: ${innerTranspilationError.message}`,
        innerTranspilationError.stack,
      );
    });

    it('should log all inner errors when multiple are present', async () => {
      const workspaceId = 'ws-multi';

      const metadataError = new Error('metadata broken');
      const schemaError = new Error('schema broken');

      const runnerException = new WorkspaceMigrationRunnerException({
        action: {
          type: 'create',
          metadataName: 'objectMetadata',
        } as unknown as AllUniversalWorkspaceMigrationAction,
        errors: { metadata: metadataError, workspaceSchema: schemaError },
        code: 'EXECUTION_FAILED',
      });

      await service.iterate({
        workspaceIds: [workspaceId],
        callback: async () => {
          throw runnerException;
        },
      });

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Caused by metadata in workspace ${workspaceId}: metadata broken`,
        metadataError.stack,
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Caused by workspaceSchema in workspace ${workspaceId}: schema broken`,
        schemaError.stack,
      );
    });

    it('should not emit "Caused by" log lines for plain errors', async () => {
      const workspaceId = 'ws-plain';
      const plainError = new Error('boom');

      await service.iterate({
        workspaceIds: [workspaceId],
        callback: async () => {
          throw plainError;
        },
      });

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Error in workspace ${workspaceId}: boom`,
        plainError.stack,
      );
    });
  });
});
