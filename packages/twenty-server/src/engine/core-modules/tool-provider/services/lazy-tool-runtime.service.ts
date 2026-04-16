import { Injectable } from '@nestjs/common';

import { type ToolSet } from 'ai';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import {
  createExecuteToolTool,
  createLearnToolsTool,
  EXECUTE_TOOL_TOOL_NAME,
  LEARN_TOOLS_TOOL_NAME,
} from 'src/engine/core-modules/tool-provider/tools';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { ToolCategory } from 'twenty-shared/ai';

export type LazyToolRuntime = {
  toolCatalog: ToolIndexEntry[];
  lazyToolCatalog: ToolIndexEntry[];
  directTools: ToolSet;
  directToolNames: string[];
  runtimeTools: ToolSet;
};

@Injectable()
export class LazyToolRuntimeService {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async buildToolRuntime({
    context,
    directTools = {},
    lazyToolCategories,
  }: {
    context: ToolProviderContext;
    directTools?: ToolSet;
    lazyToolCategories?: readonly ToolCategory[];
  }): Promise<LazyToolRuntime> {
    const toolCatalog = await this.toolRegistry.getCatalog(context);
    const lazyToolCatalog = this.filterLazyToolCatalog(
      toolCatalog,
      lazyToolCategories,
    );

    const lazyToolNames = new Set(lazyToolCatalog.map((tool) => tool.name));
    const excludedToolNames = new Set([
      ...toolCatalog
        .filter((tool) => !lazyToolNames.has(tool.name))
        .map((tool) => tool.name),
      ...Object.keys(directTools),
    ]);

    return {
      toolCatalog,
      lazyToolCatalog,
      directTools,
      directToolNames: Object.keys(directTools),
      runtimeTools: {
        ...directTools,
        [LEARN_TOOLS_TOOL_NAME]: createLearnToolsTool(
          this.toolRegistry,
          context,
          excludedToolNames,
        ),
        [EXECUTE_TOOL_TOOL_NAME]: createExecuteToolTool(
          this.toolRegistry,
          context,
          directTools,
          excludedToolNames,
        ),
      },
    };
  }

  private filterLazyToolCatalog(
    toolCatalog: ToolIndexEntry[],
    lazyToolCategories?: readonly ToolCategory[],
  ): ToolIndexEntry[] {
    if (!lazyToolCategories) {
      return toolCatalog;
    }

    const categorySet = new Set(lazyToolCategories);

    return toolCatalog.filter((tool) => categorySet.has(tool.category));
  }
}
