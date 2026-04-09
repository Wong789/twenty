import { type Repository } from 'typeorm';

import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type InboundEmailParserService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-parser.service';
import { type InboundEmailS3ClientProvider } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/providers/inbound-email-s3-client.provider';
import { type InboundEmailStorageService } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-storage.service';
import {
  InboundEmailImportService,
  type InboundEmailImportOutcome,
} from 'src/modules/messaging/message-import-manager/drivers/inbound-email/services/inbound-email-import.service';
import { type MessagingSaveMessagesAndEnqueueContactCreationService } from 'src/modules/messaging/message-import-manager/services/messaging-save-messages-and-enqueue-contact-creation.service';
import { MessageChannelType } from 'twenty-shared/types';

const TEST_S3_KEY = 'incoming/test-email-001';
const TEST_DOMAIN = 'in.twenty.com';
const TEST_WORKSPACE_ID = 'ws-123';
const TEST_CHANNEL_ID = 'ch-456';
const TEST_CONNECTED_ACCOUNT_ID = 'ca-789';
const TEST_HANDLE = `ch_abc123@${TEST_DOMAIN}`;

const buildMockChannel = (): Partial<MessageChannelEntity> => ({
  id: TEST_CHANNEL_ID,
  handle: TEST_HANDLE,
  type: MessageChannelType.EMAIL_FORWARDING,
  workspaceId: TEST_WORKSPACE_ID,
  connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
});

const buildMockConnectedAccount = (): Partial<ConnectedAccountEntity> => ({
  id: TEST_CONNECTED_ACCOUNT_ID,
  workspaceId: TEST_WORKSPACE_ID,
});

const buildMockParsedResult = (
  overrides: { originWorkspaceId?: string | null } = {},
) => ({
  parsed: {
    headers: [
      {
        key: 'delivered-to',
        originalKey: 'Delivered-To',
        value: TEST_HANDLE,
      },
    ],
    to: [{ address: TEST_HANDLE, name: '' }],
    from: { address: 'sender@example.com', name: 'Sender' },
    subject: 'Test',
    text: 'body',
    messageId: '<test@example.com>',
    date: new Date().toISOString(),
    cc: [],
    bcc: [],
    html: '',
    attachments: [],
  },
  originWorkspaceId: overrides.originWorkspaceId ?? null,
  message: {
    externalId: `inbound-email:${TEST_S3_KEY}`,
    messageThreadExternalId: '<test@example.com>',
    headerMessageId: '<test@example.com>',
    subject: 'Test',
    text: 'body',
    receivedAt: new Date(),
    direction: 'incoming',
    attachments: [],
    participants: [],
  },
});

describe('InboundEmailImportService', () => {
  let service: InboundEmailImportService;
  let s3ClientProvider: jest.Mocked<InboundEmailS3ClientProvider>;
  let storageService: jest.Mocked<InboundEmailStorageService>;
  let parserService: jest.Mocked<InboundEmailParserService>;
  let globalWorkspaceOrmManager: jest.Mocked<GlobalWorkspaceOrmManager>;
  let saveMessagesService: jest.Mocked<MessagingSaveMessagesAndEnqueueContactCreationService>;
  let messageChannelRepo: jest.Mocked<Repository<MessageChannelEntity>>;
  let connectedAccountRepo: jest.Mocked<Repository<ConnectedAccountEntity>>;

  beforeEach(() => {
    s3ClientProvider = {
      isConfigured: jest.fn().mockReturnValue(true),
      getDomain: jest.fn().mockReturnValue(TEST_DOMAIN),
      getBucket: jest.fn(),
      getClient: jest.fn(),
    } as unknown as jest.Mocked<InboundEmailS3ClientProvider>;

    storageService = {
      getRawMessage: jest.fn().mockResolvedValue(Buffer.from('raw-email')),
      moveToProcessed: jest.fn().mockResolvedValue(undefined),
      moveToUnmatched: jest.fn().mockResolvedValue(undefined),
      moveToFailed: jest.fn().mockResolvedValue(undefined),
      listIncoming: jest.fn(),
    } as unknown as jest.Mocked<InboundEmailStorageService>;

    parserService = {
      parse: jest.fn().mockResolvedValue(buildMockParsedResult()),
    } as unknown as jest.Mocked<InboundEmailParserService>;

    globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest
        .fn()
        .mockImplementation(async (fn: () => Promise<void>) => fn()),
    } as unknown as jest.Mocked<GlobalWorkspaceOrmManager>;

    saveMessagesService = {
      saveMessagesAndEnqueueContactCreation: jest
        .fn()
        .mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MessagingSaveMessagesAndEnqueueContactCreationService>;

    messageChannelRepo = {
      findOne: jest.fn().mockResolvedValue(buildMockChannel()),
    } as unknown as jest.Mocked<Repository<MessageChannelEntity>>;

    connectedAccountRepo = {
      findOne: jest.fn().mockResolvedValue(buildMockConnectedAccount()),
    } as unknown as jest.Mocked<Repository<ConnectedAccountEntity>>;

    service = new InboundEmailImportService(
      s3ClientProvider,
      storageService,
      parserService,
      globalWorkspaceOrmManager,
      saveMessagesService,
      messageChannelRepo,
      connectedAccountRepo,
    );
  });

  it('should return "imported" when everything succeeds', async () => {
    const outcome: InboundEmailImportOutcome =
      await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({
      kind: 'imported',
      workspaceId: TEST_WORKSPACE_ID,
      messageChannelId: TEST_CHANNEL_ID,
    });
    expect(storageService.moveToProcessed).toHaveBeenCalledWith(TEST_S3_KEY);
    expect(
      saveMessagesService.saveMessagesAndEnqueueContactCreation,
    ).toHaveBeenCalled();
  });

  it('should return "unconfigured" when S3 is not configured', async () => {
    s3ClientProvider.isConfigured.mockReturnValue(false);

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({ kind: 'unconfigured' });
    expect(storageService.getRawMessage).not.toHaveBeenCalled();
  });

  it('should return "unmatched" when no channel matches the recipient', async () => {
    messageChannelRepo.findOne.mockResolvedValue(null);

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome.kind).toBe('unmatched');
    expect(storageService.moveToUnmatched).toHaveBeenCalledWith(TEST_S3_KEY);
  });

  it('should return "loop_dropped" when X-Twenty-Origin matches workspace', async () => {
    parserService.parse.mockResolvedValue(
      buildMockParsedResult({ originWorkspaceId: TEST_WORKSPACE_ID }) as never,
    );

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({
      kind: 'loop_dropped',
      workspaceId: TEST_WORKSPACE_ID,
    });
    expect(storageService.moveToProcessed).toHaveBeenCalledWith(TEST_S3_KEY);
  });

  it('should return "parse_failed" and move to failed/ when download fails', async () => {
    storageService.getRawMessage.mockRejectedValue(
      new Error('S3 download error'),
    );

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({
      kind: 'parse_failed',
      error: 'S3 download error',
    });
    expect(storageService.moveToFailed).toHaveBeenCalledWith(TEST_S3_KEY);
  });

  it('should return "parse_failed" when parsing fails', async () => {
    parserService.parse.mockRejectedValue(new Error('Invalid MIME'));

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({
      kind: 'parse_failed',
      error: 'Invalid MIME',
    });
    expect(storageService.moveToFailed).toHaveBeenCalledWith(TEST_S3_KEY);
  });

  it('should return "persist_failed" when save throws', async () => {
    saveMessagesService.saveMessagesAndEnqueueContactCreation.mockRejectedValue(
      new Error('DB error'),
    );

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({
      kind: 'persist_failed',
      error: 'DB error',
    });
    expect(storageService.moveToFailed).toHaveBeenCalledWith(TEST_S3_KEY);
  });

  it('should return "persist_failed" when connected account is missing', async () => {
    connectedAccountRepo.findOne.mockResolvedValue(null);

    const outcome = await service.importFromS3Key(TEST_S3_KEY);

    expect(outcome).toEqual({
      kind: 'persist_failed',
      error: 'connected_account_missing',
    });
    expect(storageService.moveToFailed).toHaveBeenCalledWith(TEST_S3_KEY);
  });
});
