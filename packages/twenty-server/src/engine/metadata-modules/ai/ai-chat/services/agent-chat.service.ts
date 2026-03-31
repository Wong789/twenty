import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ExtendedUIMessage } from 'twenty-shared/ai';
import { Repository } from 'typeorm';

import type { UIDataTypes, UIMessagePart, UITools } from 'ai';

import { AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';
import {
  AgentMessageEntity,
  AgentMessageRole,
  AgentMessageStatus,
} from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message.entity';
import { AgentTurnEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-turn.entity';
import { mapUIMessagePartsToDBParts } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/mapUIMessagePartsToDBParts';
import {
  AgentException,
  AgentExceptionCode,
} from 'src/engine/metadata-modules/ai/ai-agent/agent.exception';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';

import { AgentTitleGenerationService } from './agent-title-generation.service';

@Injectable()
export class AgentChatService {
  constructor(
    @InjectRepository(AgentChatThreadEntity)
    private readonly threadRepository: Repository<AgentChatThreadEntity>,
    @InjectRepository(AgentTurnEntity)
    private readonly turnRepository: Repository<AgentTurnEntity>,
    @InjectRepository(AgentMessageEntity)
    private readonly messageRepository: Repository<AgentMessageEntity>,
    @InjectRepository(AgentMessagePartEntity)
    private readonly messagePartRepository: Repository<AgentMessagePartEntity>,
    private readonly titleGenerationService: AgentTitleGenerationService,
  ) {}

  async createThread(userWorkspaceId: string) {
    const thread = this.threadRepository.create({
      userWorkspaceId,
    });

    return this.threadRepository.save(thread);
  }

  async getThreadById(threadId: string, userWorkspaceId: string) {
    const thread = await this.threadRepository.findOne({
      where: {
        id: threadId,
        userWorkspaceId,
      },
    });

    if (!thread) {
      throw new AgentException(
        'Thread not found',
        AgentExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }

    return thread;
  }

  async addMessage({
    threadId,
    uiMessage,
    agentId,
    turnId,
  }: {
    threadId: string;
    uiMessage: Omit<ExtendedUIMessage, 'id'>;
    uiMessageParts?: UIMessagePart<UIDataTypes, UITools>[];
    agentId?: string;
    turnId?: string;
  }) {
    let actualTurnId = turnId;

    if (!actualTurnId) {
      const turn = this.turnRepository.create({
        threadId,
        agentId: agentId ?? null,
      });

      const savedTurn = await this.turnRepository.save(turn);

      actualTurnId = savedTurn.id;
    }

    const message = this.messageRepository.create({
      threadId,
      turnId: actualTurnId,
      role: uiMessage.role as AgentMessageRole,
      agentId: agentId ?? null,
    });

    const savedMessage = await this.messageRepository.save(message);

    if (uiMessage.parts && uiMessage.parts.length > 0) {
      const dbParts = mapUIMessagePartsToDBParts(
        uiMessage.parts,
        savedMessage.id,
      );

      await this.messagePartRepository.save(dbParts);
    }

    return savedMessage;
  }

  async getMessagesForThread(threadId: string, userWorkspaceId: string) {
    const thread = await this.threadRepository.findOne({
      where: {
        id: threadId,
        userWorkspaceId,
      },
    });

    if (!thread) {
      throw new AgentException(
        'Thread not found',
        AgentExceptionCode.AGENT_EXECUTION_FAILED,
      );
    }

    return this.messageRepository.find({
      where: { threadId },
      order: { createdAt: 'ASC' },
      relations: ['parts', 'parts.file'],
    });
  }

  async queueMessage({
    threadId,
    text,
  }: {
    threadId: string;
    text: string;
  }): Promise<AgentMessageEntity> {
    const message = this.messageRepository.create({
      threadId,
      turnId: null,
      role: AgentMessageRole.USER,
      agentId: null,
      status: AgentMessageStatus.QUEUED,
    });

    const savedMessage = await this.messageRepository.save(message);

    const part = this.messagePartRepository.create({
      messageId: savedMessage.id,
      orderIndex: 0,
      type: 'text',
      textContent: text,
    });

    await this.messagePartRepository.save(part);

    return savedMessage;
  }

  async getQueuedMessages(threadId: string): Promise<AgentMessageEntity[]> {
    return this.messageRepository.find({
      where: {
        threadId,
        status: AgentMessageStatus.QUEUED,
      },
      order: { createdAt: 'ASC' },
      relations: ['parts'],
    });
  }

  async deleteQueuedMessage(
    messageId: string,
    threadId: string,
  ): Promise<boolean> {
    const result = await this.messageRepository.delete({
      id: messageId,
      threadId,
      status: AgentMessageStatus.QUEUED,
    });

    return (result.affected ?? 0) > 0;
  }

  async promoteQueuedMessage(
    messageId: string,
    threadId: string,
  ): Promise<void> {
    await this.messageRepository.update(
      { id: messageId, threadId, status: AgentMessageStatus.QUEUED },
      { status: AgentMessageStatus.SENT },
    );
  }

  async generateTitleIfNeeded(
    threadId: string,
    messageContent: string,
  ): Promise<string | null> {
    const thread = await this.threadRepository.findOne({
      where: { id: threadId },
      select: ['id', 'title'],
    });

    if (!thread || thread.title || !messageContent) {
      return null;
    }

    const title =
      await this.titleGenerationService.generateThreadTitle(messageContent);

    await this.threadRepository.update(threadId, { title });

    return title;
  }
}
