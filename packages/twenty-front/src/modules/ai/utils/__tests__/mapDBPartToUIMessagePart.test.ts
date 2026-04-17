import { mapDBPartToUIMessagePart } from '@/ai/utils/mapDBPartToUIMessagePart';
import { type AgentMessagePart } from '~/generated-metadata/graphql';

const createToolMessagePart = (
  overrides: Partial<AgentMessagePart> = {},
): AgentMessagePart =>
  ({
    id: 'part-id',
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
    fileMediaType: null,
    fileFilename: null,
    fileId: null,
    fileUrl: null,
    providerMetadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }) as AgentMessagePart;

describe('mapDBPartToUIMessagePart', () => {
  it('should omit errorText for successful persisted tool parts', () => {
    const uiMessagePart = mapDBPartToUIMessagePart(createToolMessagePart());

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
      createToolMessagePart({
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
