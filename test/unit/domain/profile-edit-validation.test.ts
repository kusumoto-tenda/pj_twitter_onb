import { describe, expect, it } from 'vitest';
import { validateEditProfileInput } from '@/domain/value_objects/users/profile-edit-validation';

const valid = { name: 'アリス', displayId: 'Alice_1', bio: 'よろしく' };

function errorsOf(input: Partial<typeof valid>) {
  const result = validateEditProfileInput({ ...valid, ...input });
  return result.ok ? {} : result.fieldErrors;
}

describe('validateEditProfileInput', () => {
  it('パスワードなしで検証し、検証済みの3項目だけを返す', () => {
    const result = validateEditProfileInput({ ...valid, password: 'x' } as typeof valid);

    expect(result).toEqual({ ok: true, value: valid });
  });

  describe('名前', () => {
    it.each([
      ['1文字', 'a'],
      ['50文字', 'あ'.repeat(50)],
      ['絵文字50個', '😀'.repeat(50)],
    ])('%sなら有効', (_label, name) => {
      expect(errorsOf({ name }).name).toBeUndefined();
    });

    it.each([
      ['空', ''],
      ['trim後に空', ' 　 '],
      ['51文字', 'あ'.repeat(51)],
    ])('%sならname欄のエラーになる', (_label, name) => {
      expect(errorsOf({ name }).name).toBeDefined();
    });

    it('前後の空白だけをtrimする', () => {
      const result = validateEditProfileInput({ ...valid, name: '  アリス 改 ' });
      expect(result.ok && result.value.name).toBe('アリス 改');
    });
  });

  describe('ユーザーID', () => {
    it.each([
      ['5文字', 'abcde'],
      ['15文字', 'a'.repeat(15)],
      ['許可文字', 'Ab_09'],
    ])('%sなら有効', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeUndefined();
    });

    it.each([
      ['4文字', 'abcd'],
      ['16文字', 'a'.repeat(16)],
      ['全角', 'ａｂｃｄｅ'],
      ['空白', 'abc de'],
      ['前後の空白', ' abcde '],
      ['@', '@abcde'],
    ])('%sならdisplayId欄のエラーになる', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeDefined();
    });

    it('大文字小文字を保持して加工しない', () => {
      const result = validateEditProfileInput({ ...valid, displayId: 'ALICE_1' });
      expect(result.ok && result.value.displayId).toBe('ALICE_1');
    });
  });

  describe('自己紹介', () => {
    it.each([
      ['空', ''],
      ['160文字', 'あ'.repeat(160)],
    ])('%sなら有効', (_label, bio) => {
      expect(errorsOf({ bio }).bio).toBeUndefined();
    });

    it('161文字ならbio欄のエラーになる', () => {
      expect(errorsOf({ bio: 'あ'.repeat(161) }).bio).toBeDefined();
    });

    it('改行・前後の空白を保持する', () => {
      const result = validateEditProfileInput({ ...valid, bio: ' 一行目\n二行目 ' });
      expect(result.ok && result.value.bio).toBe(' 一行目\n二行目 ');
    });

    it('省略時は空文字にする', () => {
      const result = validateEditProfileInput({ name: 'アリス', displayId: 'Alice_1' });
      expect(result.ok && result.value.bio).toBe('');
    });
  });

  it('複数欄の違反をまとめて返す', () => {
    const result = validateEditProfileInput({ name: '', displayId: 'ab', bio: 'あ'.repeat(161) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors).sort()).toEqual(['bio', 'displayId', 'name']);
  });
});
