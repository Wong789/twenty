import { mapDBPartToUIMessagePart } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapDBPartToUIMessagePart';
import { type AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';

const createToolMessagePartEntity = (
  overrides: Partial<AgentMessagePartEntity> = {},
): AgentMessagePartEntity =>
  ({
    id: 'part-id',
    workspaceId: 'workspace-id',
    messageId: 'message-id',
    orderIndex: 0,
    type: 'tool-learn_tools',
    textContent: null,
    reasoningContent: null,
    toolName: 'learn_tools',
    toolCallId: 'tool-call-id',
    toolInput: { toolNames: ['findCompanies'] },
    toolOutput: {
      tools: [{ name: 'findCompanies', description: 'Find companies' }],
      notFound: [],
      message: 'Learned 1 tool(s): findCompanies.',
    },
    state: 'output-available',
    errorMessage: null,
    errorDetails: null,
    sourceUrlSourceId: null,
    sourceUrlUrl: null,
    sourceUrlTitle: null,
    sourceDocumentSourceId: null,
    sourceDocumentMediaType: null,
    sourceDocumentTitle: null,
    sourceDocumentFilename: null,
    fileFilename: null,
    fileId: null,
    file: null,
    providerMetadata: null,
    createdAt: new Date(),
    ...overrides,
  }) as AgentMessagePartEntity;

describe('mapDBPartToUIMessagePart', () => {
  it('should omit errorText for successful persisted tool parts', () => {
    const uiMessagePart = mapDBPartToUIMessagePart(
      createToolMessagePartEntity(),
    );

    expect(uiMessagePart).toMatchObject({
      type: 'tool-learn_tools',
      toolCallId: 'tool-call-id',
      input: { toolNames: ['findCompanies'] },
      output: {
        tools: [{ name: 'findCompanies', description: 'Find companies' }],
        notFound: [],
        message: 'Learned 1 tool(s): findCompanies.',
      },
      state: 'output-available',
    });
    expect(uiMessagePart).not.toHaveProperty('errorText');
  });

  it('should include errorText for failed persisted tool parts', () => {
    const uiMessagePart = mapDBPartToUIMessagePart(
      createToolMessagePartEntity({
        toolOutput: null,
        state: 'output-error',
        errorMessage: 'Tool failed',
      }),
    );

    expect(uiMessagePart).toMatchObject({
      type: 'tool-learn_tools',
      errorText: 'Tool failed',
      state: 'output-error',
    });
  });
});
