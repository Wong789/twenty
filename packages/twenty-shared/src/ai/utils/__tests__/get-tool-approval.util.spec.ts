import { getToolApproval } from '../get-tool-approval.util';

describe('getToolApproval', () => {
  it('returns undefined when errorDetails is missing or malformed', () => {
    expect(getToolApproval(null)).toBeUndefined();
    expect(getToolApproval(undefined)).toBeUndefined();
    expect(getToolApproval('string')).toBeUndefined();
    expect(getToolApproval({})).toBeUndefined();
    expect(getToolApproval({ approval: null })).toBeUndefined();
    expect(getToolApproval({ approval: 'not-an-object' })).toBeUndefined();
    expect(getToolApproval({ approval: {} })).toBeUndefined();
  });

  it('returns the approval with only the id when optional fields are missing', () => {
    expect(getToolApproval({ approval: { id: 'approval-1' } })).toEqual({
      id: 'approval-1',
      approved: undefined,
      reason: undefined,
    });
  });

  it('returns all fields when present and correctly typed', () => {
    expect(
      getToolApproval({
        approval: { id: 'approval-1', approved: true, reason: 'Looks good' },
      }),
    ).toEqual({
      id: 'approval-1',
      approved: true,
      reason: 'Looks good',
    });
  });

  it('omits optional fields that have the wrong runtime type', () => {
    expect(
      getToolApproval({
        approval: { id: 'approval-1', approved: 'yes', reason: 42 },
      }),
    ).toEqual({
      id: 'approval-1',
      approved: undefined,
      reason: undefined,
    });
  });
});
