import { describe, expect, it } from 'vitest';
import { validateEditTweetInput } from '@/domain/tweets/edit-tweet-validation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = (overrides: Partial<{ content: string; keepImageIds: string[]; uploadIds: string[] }> = {}) => ({
  content: '本文',
  keepImageIds: [],
  uploadIds: [],
  ...overrides,
});

describe('validateEditTweetInput', () => {
  it('保持する既存画像だけ・新規画像だけ・両方で、本文が空でも有効', () => {
    expect(validateEditTweetInput(input({ content: '', keepImageIds: [id(1)] })).ok).toBe(true);
    expect(validateEditTweetInput(input({ content: '', uploadIds: [id(2)] })).ok).toBe(true);
    expect(validateEditTweetInput(input({ content: '', keepImageIds: [id(1)], uploadIds: [id(2)] })).ok).toBe(true);
  });

  it('空白・改行だけの本文で画像もなければcontent欄のエラーにする', () => {
    const result = validateEditTweetInput(input({ content: ' \r\n', keepImageIds: [], uploadIds: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.content).toEqual(['本文か画像のどちらかを入力してください']);
  });

  it('本文は0〜280コードポイント（絵文字も1文字）で、281はエラー', () => {
    expect(validateEditTweetInput(input({ content: '', keepImageIds: [id(1)] })).ok).toBe(true);
    expect(validateEditTweetInput(input({ content: '😀'.repeat(280) })).ok).toBe(true);
    const result = validateEditTweetInput(input({ content: 'あ'.repeat(281), keepImageIds: [id(1)] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.content).toEqual(['本文は280文字以下で入力してください']);
  });

  it('CRLF・CRをLFに揃え、前後の空白は保持する。UUIDは小文字に揃え、順序を保つ', () => {
    const upper = id(3).toUpperCase().replace('0000-4000-8000', '0000-4000-8000');
    expect(
      validateEditTweetInput({ content: ' 一\r\n二\r三 ', keepImageIds: [id(2), id(1)], uploadIds: [upper] }),
    ).toEqual({
      ok: true,
      value: { content: ' 一\n二\n三 ', keepImageIds: [id(2), id(1)], uploadIds: [id(3)] },
    });
  });

  it('保持と新規の合計4枚までは有効で、5枚はimages欄のエラーにする', () => {
    expect(validateEditTweetInput(input({ keepImageIds: [id(1), id(2)], uploadIds: [id(3), id(4)] })).ok).toBe(true);
    const result = validateEditTweetInput(input({ keepImageIds: [id(1), id(2), id(3)], uploadIds: [id(4), id(5)] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.images).toEqual(['画像は4枚まで添付できます']);
  });

  it.each([
    ['UUIDでない保持画像', { keepImageIds: ['not-a-uuid'] }],
    ['UUIDでない新規画像', { uploadIds: ['x'] }],
    ['大小文字違いの重複（保持）', { keepImageIds: [id(1), id(1).toUpperCase()] }],
    ['保持と新規にまたがる重複', { keepImageIds: [id(1)], uploadIds: [id(1)] }],
  ])('%sはimages欄のエラーにする', (_label, overrides) => {
    const result = validateEditTweetInput(input(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.images).toEqual(['添付画像を確認してください']);
  });
});
