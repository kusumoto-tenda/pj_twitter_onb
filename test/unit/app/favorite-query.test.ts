import { describe, expect, it } from 'vitest';
import { encodeFavoriteCursor, favoritesHref, parseFavoriteCursor } from '@/app/lib/favorite-query';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const FAV = '00000000-0000-4000-8000-0000000000f1';
const cursor = { createdAt: '2026-10-26T03:00:00.123456Z', favoriteId: FAV };
const raw = (parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString('base64url');

describe('お気に入りのカーソル', () => {
  it('本人のカーソルは往復でき、未指定は先頭', () => {
    expect(parseFavoriteCursor(encodeFavoriteCursor(ALICE, cursor), ALICE)).toEqual({ ok: true, cursor });
    expect(parseFavoriteCursor(undefined, ALICE)).toEqual({ ok: true, cursor: null });
  });

  it('UUIDは小文字に揃え、マイクロ秒は丸めない', () => {
    const parsed = parseFavoriteCursor(raw([ALICE.toUpperCase(), 'favorites', cursor.createdAt, FAV.toUpperCase()]), ALICE);
    expect(parsed).toEqual({ ok: true, cursor });
  });

  it.each([
    ['他人のカーソル', encodeFavoriteCursor(BOB, cursor)],
    ['別の種類', raw([ALICE, 'tweets', cursor.createdAt, FAV])],
    ['日時が不正', raw([ALICE, 'favorites', '2026-02-30T00:00:00.000000Z', FAV])],
    ['ミリ秒精度', raw([ALICE, 'favorites', '2026-10-26T03:00:00.123Z', FAV])],
    ['UUIDが不正', raw([ALICE, 'favorites', cursor.createdAt, 'nope'])],
    ['要素数違い', raw([ALICE, 'favorites', cursor.createdAt])],
    ['壊れた文字列', '%%%'],
    ['重複パラメータ', ['a', 'b']],
  ])('%sは不正', (_label, value) => {
    expect(parseFavoriteCursor(value, ALICE)).toEqual({ ok: false });
  });

  it('URLはカーソルの指定時だけ付ける', () => {
    expect(favoritesHref(null)).toBe('/favorites');
    expect(favoritesHref('abc')).toBe('/favorites?cursor=abc');
  });
});
