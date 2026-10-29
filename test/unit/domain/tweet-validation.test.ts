import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  normalizeTweetContent,
  validateImageDimensions,
  validateImageFile,
  validateTweetInput,
} from '@/domain/value_objects/tweets/tweet-validation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('validateTweetInput', () => {
  it('本文がなくても画像1枚があれば入力として有効', () => {
    expect(validateTweetInput({
      content: '', uploadIds: ['00000000-0000-4000-8000-000000000001'],
    })).toEqual({ ok: true, value: {
      content: '', uploadIds: ['00000000-0000-4000-8000-000000000001'],
    } });
  });

  it('本文だけ・本文と画像の両方でも有効', () => {
    expect(validateTweetInput({ content: 'こんにちは', uploadIds: [] }).ok).toBe(true);
    expect(validateTweetInput({ content: 'こんにちは', uploadIds: [id(1), id(2)] }).ok).toBe(true);
  });

  it.each([
    ['空', ''],
    ['空白・改行だけ', ' \n　\t'],
  ])('本文が%sで画像もなければcontent欄のエラーになる', (_label, content) => {
    const result = validateTweetInput({ content, uploadIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.content).toEqual(['本文か画像のどちらかを入力してください']);
  });

  it('空白だけの本文でも画像があれば有効で、本文はそのまま保持する', () => {
    expect(validateTweetInput({ content: '  ', uploadIds: [id(1)] })).toEqual({
      ok: true,
      value: { content: '  ', uploadIds: [id(1)] },
    });
  });

  it('280文字は有効で、281文字はcontent欄のエラーになる（画像があっても上限は変わらない）', () => {
    expect(validateTweetInput({ content: 'あ'.repeat(280), uploadIds: [] }).ok).toBe(true);
    const result = validateTweetInput({ content: 'あ'.repeat(281), uploadIds: [id(1)] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.content).toBeDefined();
  });

  it('絵文字をコードポイント単位で数える', () => {
    expect(validateTweetInput({ content: '😀'.repeat(280), uploadIds: [] }).ok).toBe(true);
    expect(validateTweetInput({ content: '😀'.repeat(281), uploadIds: [] }).ok).toBe(false);
  });

  it('CRLF・CRの改行をLFに揃え、前後の空白は保持する', () => {
    expect(validateTweetInput({ content: ' 一行目\r\n二行目\r三行目 ', uploadIds: [] })).toEqual({
      ok: true,
      value: { content: ' 一行目\n二行目\n三行目 ', uploadIds: [] },
    });
  });

  it('CRLFは1文字として数える（280個の改行込みで上限内）', () => {
    expect(validateTweetInput({ content: 'あ\r\n'.repeat(140), uploadIds: [] }).ok).toBe(true);
  });

  it('画像は4枚まで有効で、5枚はimages欄のエラーになる', () => {
    expect(validateTweetInput({ content: '', uploadIds: [1, 2, 3, 4].map(id) }).ok).toBe(true);
    const result = validateTweetInput({ content: '', uploadIds: [1, 2, 3, 4, 5].map(id) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.images).toEqual(['画像は4枚まで添付できます']);
  });

  it('重複したuploadId・UUIDでない値はimages欄のエラーになる', () => {
    for (const uploadIds of [[id(1), id(1)], ['not-a-uuid']]) {
      const result = validateTweetInput({ content: 'a', uploadIds });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors.images).toBeDefined();
    }
  });

  it('複数欄の違反をまとめて返す', () => {
    const result = validateTweetInput({ content: 'あ'.repeat(281), uploadIds: [1, 2, 3, 4, 5].map(id) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors).sort()).toEqual(['content', 'images']);
  });
});

describe('normalizeTweetContent', () => {
  it('改行だけを揃える', () => {
    expect(normalizeTweetContent('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});

describe('validateImageFile', () => {
  it.each([
    ['JPEG', 'image/jpeg'],
    ['PNG', 'image/png'],
  ])('%sは上限ちょうどまで有効', (_label, contentType) => {
    expect(validateImageFile({ size: MAX_IMAGE_BYTES, contentType })).toEqual([]);
  });

  it('5MBは5,242,880バイトとし、1バイト超過はエラーになる', () => {
    expect(MAX_IMAGE_BYTES).toBe(5_242_880);
    expect(validateImageFile({ size: MAX_IMAGE_BYTES + 1, contentType: 'image/png' })).toEqual([
      '画像は1枚5MB以下にしてください',
    ]);
  });

  it('0バイトはエラーになる', () => {
    expect(validateImageFile({ size: 0, contentType: 'image/png' })).not.toEqual([]);
  });

  it.each(['image/gif', 'image/svg+xml', 'image/webp', 'video/mp4', ''])(
    '%s はエラーになる',
    (contentType) => {
      expect(validateImageFile({ size: 100, contentType })).toEqual(['JPEG・PNG画像のみ添付できます']);
    },
  );
});

describe('validateImageDimensions', () => {
  it('画素数40,000,000までは有効で、超えるとエラーになる', () => {
    expect(MAX_IMAGE_PIXELS).toBe(40_000_000);
    expect(validateImageDimensions({ width: 8000, height: 5000 })).toEqual([]);
    expect(validateImageDimensions({ width: 8001, height: 5000 })).toEqual(['画像の画素数が大きすぎます']);
    expect(validateImageDimensions({ width: 0, height: 10 })).not.toEqual([]);
  });
});
