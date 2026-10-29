import { describe, expect, it } from 'vitest';
import { validateLoginInput } from '@/domain/value_objects/users/login-validation';

const valid = { displayId: 'Alice_1', password: 'password123' };

function errorsOf(input: Partial<typeof valid>) {
  const result = validateLoginInput({ ...valid, ...input });
  return result.ok ? {} : result.fieldErrors;
}

describe('validateLoginInput', () => {
  it('空欄は両方の入力欄にエラーを返す', () => {
    const result = validateLoginInput({ displayId: '', password: '' });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        displayId: expect.any(Array),
        password: expect.any(Array),
      },
    });
  });

  it('有効な入力なら ok を返す', () => {
    expect(validateLoginInput(valid)).toEqual({ ok: true });
  });

  describe('ユーザーID', () => {
    it.each([
      ['5文字', 'abcde'],
      ['15文字', 'a'.repeat(15)],
      ['英大小文字・数字・アンダーバー', 'Ab_09'],
    ])('%sなら有効', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeUndefined();
    });

    it.each([
      ['4文字', 'abcd'],
      ['16文字', 'a'.repeat(16)],
      ['先頭の@', '@abcde'],
      ['空白', 'abc de'],
      ['前後の空白', ' abcde '],
      ['全角英字', 'ａｂｃｄｅ'],
    ])('%sならdisplayId欄のエラーになる', (_label, displayId) => {
      expect(errorsOf({ displayId }).displayId).toBeDefined();
    });
  });

  describe('パスワード', () => {
    it.each([
      ['8コードポイント', 'a'.repeat(8)],
      ['50コードポイント', 'a'.repeat(50)],
      ['Unicode50コードポイント', '😀'.repeat(50)],
      ['前後の空白を含めて8コードポイント', ' passwd '],
    ])('%sなら有効', (_label, password) => {
      expect(errorsOf({ password }).password).toBeUndefined();
    });

    it.each([
      ['7コードポイント', 'a'.repeat(7)],
      ['51コードポイント', 'a'.repeat(51)],
      ['Unicode51コードポイント', '😀'.repeat(51)],
      ['trimすると49文字だが前後の空白込みで51文字', ` ${'a'.repeat(49)} `],
    ])('%sならpassword欄のエラーになる', (_label, password) => {
      expect(errorsOf({ password }).password).toBeDefined();
    });
  });

  it('入力値を加工しない', () => {
    const input = { displayId: 'Alice_1', password: ' Pass Word ' };
    validateLoginInput(input);
    expect(input).toEqual({ displayId: 'Alice_1', password: ' Pass Word ' });
  });
});
