// S3 key prefixes used to shard incoming/processed/unmatched/failed mail.
// The bucket itself IS the work queue: presence of a key in "incoming/"
// means the object is pending import. Moving an object to any other prefix
// removes it from the queue, which gives us at-least-once semantics without
// needing a separate dedupe store.
export const INBOUND_EMAIL_S3_PREFIXES = {
  incoming: 'incoming/',
  processed: 'processed/',
  unmatched: 'unmatched/',
  failed: 'failed/',
} as const;

// Custom header stamped on outbound mail so we can drop echoes when group
// replies hit the inbound pipeline. The value is the workspace id that sent
// the message, which lets us scope the loop check to a single workspace.
export const X_TWENTY_ORIGIN_HEADER = 'x-twenty-origin';

// Local part prefix for forwarding-channel addresses: "ch_" + 24 hex chars.
export const INBOUND_EMAIL_LOCAL_PART_PREFIX = 'ch_';
export const INBOUND_EMAIL_LOCAL_PART_RANDOM_BYTES = 12;
