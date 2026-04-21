export type DetailToFetchEntityType = 'BROADCAST' | 'TEMPLATE';

export type DetailToFetchStatus = 'PENDING' | 'DONE' | 'FAILED';

export type DetailToFetchRow = {
  id: string;
  entityType: DetailToFetchEntityType;
  resendId: string;
  twentyRecordId: string;
  status: DetailToFetchStatus;
  retryCount: number;
  lastError: string | null;
  queuedAt: string | null;
  processedAt: string | null;
};
