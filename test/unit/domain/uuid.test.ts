import { describe, expect, it } from 'vitest';
import { normalizeUuid } from '@/shared/uuid';

describe('normalizeUuid', () => {
  it('UUIDは小文字に揃えて返す', () => {
    expect(normalizeUuid('00000000-0000-4000-8000-0000000000AB')).toBe('00000000-0000-4000-8000-0000000000ab');
  });

  it.each(['', 'nope', '00000000-0000-4000-8000-0000000000a', ' 00000000-0000-4000-8000-0000000000ab', '00000000000040008000000000000ab0'])(
    'UUIDでない値（%j）はnull',
    (value) => {
      expect(normalizeUuid(value)).toBeNull();
    },
  );
});
