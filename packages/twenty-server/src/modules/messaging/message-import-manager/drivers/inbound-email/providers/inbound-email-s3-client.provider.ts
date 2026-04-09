import { Injectable, Logger } from '@nestjs/common';

import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { isNonEmptyString } from '@sniptt/guards';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

// Lazy S3 client: constructed on first call so the server boots cleanly in
// workspaces that don't enable email forwarding. Credentials are reused from
// the AWS_SES_* config block — SES inbound action already writes to this
// bucket, so the same principal can read it.
@Injectable()
export class InboundEmailS3ClientProvider {
  private readonly logger = new Logger(InboundEmailS3ClientProvider.name);
  private s3Client: S3Client | null = null;

  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  isConfigured(): boolean {
    const bucket = this.twentyConfigService.get('INBOUND_EMAIL_S3_BUCKET');
    const domain = this.twentyConfigService.get('INBOUND_EMAIL_DOMAIN');

    return isNonEmptyString(bucket) && isNonEmptyString(domain);
  }

  getBucket(): string {
    const bucket = this.twentyConfigService.get('INBOUND_EMAIL_S3_BUCKET');

    if (!isNonEmptyString(bucket)) {
      throw new Error(
        'INBOUND_EMAIL_S3_BUCKET is not configured; email forwarding is disabled.',
      );
    }

    return bucket;
  }

  getDomain(): string {
    const domain = this.twentyConfigService.get('INBOUND_EMAIL_DOMAIN');

    if (!isNonEmptyString(domain)) {
      throw new Error(
        'INBOUND_EMAIL_DOMAIN is not configured; email forwarding is disabled.',
      );
    }

    return domain;
  }

  getClient(): S3Client {
    if (this.s3Client) {
      return this.s3Client;
    }

    const region =
      this.twentyConfigService.get('INBOUND_EMAIL_S3_REGION') ||
      this.twentyConfigService.get('AWS_SES_REGION');

    if (!isNonEmptyString(region)) {
      throw new Error(
        'INBOUND_EMAIL_S3_REGION or AWS_SES_REGION must be set to use email forwarding.',
      );
    }

    const config: S3ClientConfig = { region };

    const accessKeyId = this.twentyConfigService.get('AWS_SES_ACCESS_KEY_ID');
    const secretAccessKey = this.twentyConfigService.get(
      'AWS_SES_SECRET_ACCESS_KEY',
    );
    const sessionToken = this.twentyConfigService.get('AWS_SES_SESSION_TOKEN');

    if (
      isNonEmptyString(accessKeyId) &&
      isNonEmptyString(secretAccessKey) &&
      isNonEmptyString(sessionToken)
    ) {
      config.credentials = { accessKeyId, secretAccessKey, sessionToken };
    } else if (
      isNonEmptyString(accessKeyId) &&
      isNonEmptyString(secretAccessKey)
    ) {
      config.credentials = { accessKeyId, secretAccessKey };
    }

    this.s3Client = new S3Client(config);
    this.logger.log(`Inbound-email S3 client initialized in region ${region}`);

    return this.s3Client;
  }
}
