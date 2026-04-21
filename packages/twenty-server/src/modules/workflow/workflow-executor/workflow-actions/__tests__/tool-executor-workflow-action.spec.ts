import { Test, type TestingModule } from '@nestjs/testing';

import { DraftEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/draft-email-tool';
import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { HttpTool } from 'src/engine/core-modules/tool/tools/http-tool/http-tool';
import { ToolExecutorWorkflowAction } from 'src/modules/workflow/workflow-executor/workflow-actions/tool-executor-workflow-action';
import { type WorkflowActionSettings } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action-settings.type';
import { WorkflowActionType } from 'src/modules/workflow/workflow-executor/workflow-actions/types/workflow-action.type';

jest.mock(
  'src/engine/core-modules/tool/tools/email-tool/utils/render-rich-text-to-html.util',
  () => ({
    renderRichTextToHtml: jest
      .fn()
      .mockResolvedValue('<p>rendered html</p>'),
  }),
);

const { renderRichTextToHtml } = jest.requireMock(
  'src/engine/core-modules/tool/tools/email-tool/utils/render-rich-text-to-html.util',
);

const baseSettings: WorkflowActionSettings = {
  outputSchema: {},
  errorHandlingOptions: {
    retryOnFailure: { value: false },
    continueOnFailure: { value: false },
  },
  input: {},
};

const buildSendEmailStep = (input: Record<string, unknown>) => ({
  id: 'step-1',
  type: WorkflowActionType.SEND_EMAIL as const,
  name: 'Send Email',
  valid: true,
  settings: { ...baseSettings, input },
});

describe('ToolExecutorWorkflowAction', () => {
  let action: ToolExecutorWorkflowAction;
  let mockSendEmailTool: jest.Mocked<Pick<SendEmailTool, 'execute'>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockSendEmailTool = {
      execute: jest.fn().mockResolvedValue({
        result: { success: true },
        error: undefined,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutorWorkflowAction,
        { provide: HttpTool, useValue: { execute: jest.fn() } },
        { provide: SendEmailTool, useValue: mockSendEmailTool },
        { provide: DraftEmailTool, useValue: { execute: jest.fn() } },
      ],
    }).compile();

    action = module.get(ToolExecutorWorkflowAction);
  });

  const executeWithBody = (body: string | undefined) =>
    action.execute({
      currentStepId: 'step-1',
      steps: [
        buildSendEmailStep({
          connectedAccountId: 'account-1',
          recipients: { to: 'test@example.com' },
          subject: 'Test',
          body,
        }),
      ],
      context: {
        trigger: {
          name: 'John',
          email: 'john@example.com',
        },
      },
      runInfo: {
        workspaceId: 'workspace-1',
        workflowRunId: 'run-1',
        attemptCount: 1,
      },
    });

  describe('email body handling', () => {
    it('should render TipTap JSON body to HTML', async () => {
      const tipTapBody = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      });

      await executeWithBody(tipTapBody);

      expect(renderRichTextToHtml).toHaveBeenCalledWith(
        JSON.parse(tipTapBody),
      );
      expect(mockSendEmailTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ body: '<p>rendered html</p>' }),
        expect.any(Object),
      );
    });

    it('should pass plain text body through without rendering', async () => {
      const plainTextBody =
        '{{trigger.name}}\n{{trigger.email}}';

      await executeWithBody(plainTextBody);

      expect(renderRichTextToHtml).not.toHaveBeenCalled();
      expect(mockSendEmailTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'John\njohn@example.com' }),
        expect.any(Object),
      );
    });

    it('should not crash when body is undefined', async () => {
      await executeWithBody(undefined);

      expect(renderRichTextToHtml).not.toHaveBeenCalled();
      expect(mockSendEmailTool.execute).toHaveBeenCalled();
    });
  });
});
