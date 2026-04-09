import { Injectable, Logger } from '@nestjs/common';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

import { INBOUND_EMAIL_S3_PREFIXES } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/constants/inbound-email.constants';
import { InboundEmailS3ClientProvider } from 'src/modules/messaging/message-import-manager/drivers/inbound-email/providers/inbound-email-s3-client.provider';

// Thin wrapper around S3 that implements the "bucket-as-queue" pattern:
// listIncoming => pull work, getRawMessage => download, moveTo* => ack.
// Archive destinations are date-partitioned so operators can browse the
// bucket by day when triaging failures.
@Injectable()
export class InboundEmailStorageService {
  private readonly logger = new Logger(InboundEmailStorageService.name);

  constructor(
    private readonly inboundEmailS3ClientProvider: InboundEmailS3ClientProvider,
  ) {}

  async listIncoming(maxKeys: number): Promise<string[]> {
    const client = this.inboundEmailS3ClientProvider.getClient();
    const Bucket = this.inboundEmailS3ClientProvider.getBucket();

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: INBOUND_EMAIL_S3_PREFIXES.incoming,
        MaxKeys: maxKeys,
      }),
    );

    const keys = (response.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === 'string')
      .filter((key) => key !== INBOUND_EMAIL_S3_PREFIXES.incoming);

    return keys;
  }

  async getRawMessage(key: string): Promise<Buffer> {
    const client = this.inboundEmailS3ClientProvider.getClient();
    const Bucket = this.inboundEmailS3ClientProvider.getBucket();

    const response = await client.send(
      new GetObjectCommand({ Bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error(`S3 object ${key} has no body`);
    }

    // AWS SDK v3 returns Body as a stream in Node; collect it to a Buffer so
    // postal-mime can parse it in one shot.
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  async moveToProcessed(key: string): Promise<void> {
    await this.moveToArchive(key, INBOUND_EMAIL_S3_PREFIXES.processed);
  }

  async moveToUnmatched(key: string): Promise<void> {
    await this.moveToArchive(key, INBOUND_EMAIL_S3_PREFIXES.unmatched);
  }

  async moveToFailed(key: string): Promise<void> {
    await this.moveToArchive(key, INBOUND_EMAIL_S3_PREFIXES.failed);
  }

  private async moveToArchive(
    key: string,
    destinationPrefix: string,
  ): Promise<void> {
    const client = this.inboundEmailS3ClientProvider.getClient();
    const Bucket = this.inboundEmailS3ClientProvider.getBucket();

    const destinationKey = this.buildArchiveKey(key, destinationPrefix);

    try {
      await client.send(
        new CopyObjectCommand({
          Bucket,
          CopySource: `${Bucket}/${encodeURIComponent(key)}`,
          Key: destinationKey,
        }),
      );

      await client.send(
        new DeleteObjectCommand({ Bucket, Key: key }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to move S3 key ${key} to ${destinationKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  buildArchiveKey(sourceKey: string, destinationPrefix: string): string {
    const bareKey = sourceKey.startsWith(INBOUND_EMAIL_S3_PREFIXES.incoming)
      ? sourceKey.slice(INBOUND_EMAIL_S3_PREFIXES.incoming.length)
      : sourceKey;

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');

    return `${destinationPrefix}${year}-${month}-${day}/${bareKey}`;
  }
}
