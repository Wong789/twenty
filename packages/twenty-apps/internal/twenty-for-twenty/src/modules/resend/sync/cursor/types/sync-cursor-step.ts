export type SyncCursorStep =
  | 'SEGMENTS'
  | 'TEMPLATES'
  | 'CONTACTS'
  | 'EMAILS'
  | 'BROADCASTS';

export type SyncCursorRow = {
  id: string;
  step: SyncCursorStep;
  cursor: string | null;
};
