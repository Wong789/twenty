import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';

import { WorkspaceExportService } from 'src/database/commands/workspace-export/workspace-export.service';

type WorkspaceExportCommandOptions = {
  workspaceId: string;
  output: string;
  tables?: string;
};

@Command({
  name: 'workspace:export',
  description: 'Export a workspace as SQL INSERT statements',
})
export class WorkspaceExportCommand extends CommandRunner {
  private readonly logger = new Logger(WorkspaceExportCommand.name);

  constructor(private readonly workspaceExportService: WorkspaceExportService) {
    super();
  }

  @Option({
    flags: '--workspace-id <workspaceId>',
    description: 'Workspace UUID to export',
    required: true,
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '-o, --output <output>',
    description: 'Output file path for the .sql export',
    required: true,
  })
  parseOutput(value: string): string {
    return value;
  }

  @Option({
    flags: '--tables <tables>',
    description:
      'Comma-separated workspace table names to export (uses nameSingular from ObjectMetadata)',
  })
  parseTables(value: string): string {
    return value;
  }

  async run(
    _passedParams: string[],
    options: WorkspaceExportCommandOptions,
  ): Promise<void> {
    const tableFilter = options.tables?.split(',').map((table) => table.trim());

    try {
      const filePath = await this.workspaceExportService.exportWorkspace({
        workspaceId: options.workspaceId,
        output: options.output,
        tableFilter,
      });

      this.logger.log(`Export complete: ${filePath}`);
    } catch (error) {
      this.logger.error('Export failed', error);
      throw error;
    }
  }
}
