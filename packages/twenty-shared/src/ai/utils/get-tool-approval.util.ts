export type ToolApproval = {
  id: string;
  approved?: boolean;
  reason?: string;
};

export const getToolApproval = (
  errorDetails: unknown,
): ToolApproval | undefined => {
  const approval =
    errorDetails &&
    typeof errorDetails === 'object' &&
    'approval' in errorDetails &&
    typeof errorDetails.approval === 'object' &&
    errorDetails.approval !== null
      ? (errorDetails.approval as Record<string, unknown>)
      : null;

  if (!approval || typeof approval.id !== 'string') {
    return undefined;
  }

  return {
    id: approval.id,
    approved:
      typeof approval.approved === 'boolean' ? approval.approved : undefined,
    reason: typeof approval.reason === 'string' ? approval.reason : undefined,
  };
};
