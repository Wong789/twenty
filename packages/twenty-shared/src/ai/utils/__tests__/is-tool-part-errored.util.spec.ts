import { isToolPartErrored } from '../is-tool-part-errored.util';

describe('isToolPartErrored', () => {
  it('returns true for error states', () => {
    expect(isToolPartErrored('output-error')).toBe(true);
    expect(isToolPartErrored('output-denied')).toBe(true);
  });

  it('returns false for non-error states', () => {
    expect(isToolPartErrored('input-streaming')).toBe(false);
    expect(isToolPartErrored('input-available')).toBe(false);
    expect(isToolPartErrored('approval-requested')).toBe(false);
    expect(isToolPartErrored('approval-responded')).toBe(false);
    expect(isToolPartErrored('output-available')).toBe(false);
  });
});
