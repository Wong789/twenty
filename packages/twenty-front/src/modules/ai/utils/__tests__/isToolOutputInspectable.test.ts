import { isToolOutputInspectable } from '@/ai/utils/isToolOutputInspectable';

describe('isToolOutputInspectable', () => {
  it('should return false for missing output', () => {
    expect(isToolOutputInspectable(null)).toBe(false);
    expect(isToolOutputInspectable(undefined)).toBe(false);
  });

  it('should return false for empty output containers', () => {
    expect(isToolOutputInspectable({})).toBe(false);
    expect(isToolOutputInspectable([])).toBe(false);
    expect(isToolOutputInspectable('')).toBe(false);
    expect(isToolOutputInspectable('   ')).toBe(false);
  });

  it('should return true for inspectable output', () => {
    expect(isToolOutputInspectable({ result: 'ok' })).toBe(true);
    expect(isToolOutputInspectable(['ok'])).toBe(true);
    expect(isToolOutputInspectable('ok')).toBe(true);
    expect(isToolOutputInspectable(0)).toBe(true);
    expect(isToolOutputInspectable(false)).toBe(true);
  });
});
