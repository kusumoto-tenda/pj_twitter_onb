import { describe, expect, it } from 'vitest';
import {
  countCharacters,
  normalizeDisplayId,
  validateAccountInput,
} from '@/domain/value_objects/users/account-validation';

const valid = { name: 'アリス', displayId: 'Alice_1', bio: '', password: 'password123' };

function errorsOf(input: Partial<typeof valid> & { bio?: string }) {
  const result = validateAccountInput({ ...valid, ...input });
  return result.ok ? {} : result.fieldErrors;
}

describe('validateAccountInput', () => {
  it('有効な入力なら整形済みの値を返す', () => {
    const result = validateAccountInput(valid);
    expect(result).toEqual({ ok: true, value: valid });
  });

  describe('名前', () => {
    it('空ならname欄のエラーになる', () => {
      expect(errorsOf({ name: '' }).name).toBeDefined();
    });

    it('空白のみならname欄のエラーになる', () => {
      expect(errorsOf({ name: ' 　 ' }).name).toBeDefined();
    });

    it.each([
      ['1文字', 'a'],
      ['50文字', 'あ'.repeat(50)],
      ['絵文字50個', '😀'.repeat(50)],
    ])('%sなら有効', (_label, name) => {
      expect(errorsOf({ name }).name).toBeUndefined();
    });

    it('51コードポイントならname欄のエラーになる', () => {
      expect(errorsOf({ name: 'あ'.repeat(51) }).name).toBeDefined();
    });

    it('前後の空白をtrimして検証・保存する', () => {
      const result = validateAccountInput({ ...valid, name: '  ' + 'あ'.repeat(50) + ' ' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.name).toBe('あ'.repeat(50));
    });
  });

  describe('ユーザーID', () => {
    it.each([
      ['5文字', 'abcde'],
      ['15文字', 'a'.repeat(15)],
      ['英大小文字・数字・アンダーバー', 'Ab_09'],
      ['アンダーバーのみ', '_____'],
    ])('%sなら有効', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeUndefined();
    });

    it.each([
      ['4文字', 'abcd'],
      ['16文字', 'a'.repeat(16)],
      ['空', ''],
    ])('%sならdisplayId欄のエラーになる', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeDefined();
    });

    it.each([
      ['全角英字', 'ａｂｃｄｅ'],
      ['ハイフン', 'abc-de'],
      ['空白', 'abc de'],
      ['前後の空白', ' abcde '],
      ['先頭の@', '@abcde'],
      ['ひらがな', 'あいうえお'],
    ])('%sを含むならdisplayId欄のエラーになる', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeDefined();
    });

    it('入力の大文字小文字を保持する', () => {
      const result = validateAccountInput({ ...valid, displayId: 'Alice_1' });
      expect(result.ok && result.value.displayId).toBe('Alice_1');
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

    it('省略時は空文字にする', () => {
      const { bio: _omit, ...withoutBio } = valid;
      const result = validateAccountInput(withoutBio);
      expect(result.ok && result.value.bio).toBe('');
    });

    it('入力をそのまま保持する', () => {
      const result = validateAccountInput({ ...valid, bio: ' よろしく\n' });
      expect(result.ok && result.value.bio).toBe(' よろしく\n');
    });
  });

  describe('パスワード', () => {
    it.each([
      ['8文字', 'a'.repeat(8)],
      ['50文字', 'a'.repeat(50)],
      ['多バイト50文字', 'パ'.repeat(50)],
    ])('%sなら有効', (_label, password) => {
      expect(errorsOf({ password }).password).toBeUndefined();
    });

    it.each([
      ['7文字', 'a'.repeat(7)],
      ['51文字', 'a'.repeat(51)],
      ['空', ''],
    ])('%sならpassword欄のエラーになる', (_label, password) => {
      expect(errorsOf({ password }).password).toBeDefined();
    });

    it('前後の空白を含めてそのまま保持する', () => {
      const result = validateAccountInput({ ...valid, password: ' pass word ' });
      expect(result.ok && result.value.password).toBe(' pass word ');
    });
  });

  it('複数項目のエラーを一括で返す', () => {
    const result = validateAccountInput({
      name: '',
      displayId: 'ab',
      bio: 'あ'.repeat(161),
      password: 'short',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(
        ['bio', 'displayId', 'name', 'password'].sort(),
      );
    }
  });
});

describe('countCharacters', () => {
  it('絵文字をUTF-16の2文字ではなく1文字として数える', () => {
    expect('😀'.length).toBe(2);
    expect(countCharacters('😀')).toBe(1);
  });
});

describe('normalizeDisplayId', () => {
  it('ASCII小文字に正規化する', () => {
    expect(normalizeDisplayId('Alice_1')).toBe('alice_1');
  });
});
