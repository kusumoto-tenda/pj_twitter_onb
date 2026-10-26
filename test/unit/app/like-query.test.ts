import { describe, expect, it } from 'vitest';
import { encodeActivityCursor, encodeLikeCursor, parseLikeCursor } from '@/app/lib/profile-query';

const ALICE = '00000000-0000-4000-8000-0000000000a1';
const BOB = '00000000-0000-4000-8000-0000000000b1';
const LIKE = '00000000-0000-4000-8000-0000000000e1';
const cursor = { createdAt: '2026-10-27T03:00:00.123456Z', likeId: LIKE };
const raw = (parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString('base64url');

describe('公開いいね一覧のカーソル', () => {
  it('対象者のlikesカーソルは往復でき、未指定は先頭', () => {
    expect(parseLikeCursor(encodeLikeCursor(ALICE, cursor), ALICE)).toEqual({ ok: true, cursor });
    expect(parseLikeCursor(undefined, ALICE)).toEqual({ ok: true, cursor: null });
  });

  it('UUIDは小文字に揃え、マイクロ秒は丸めない', () => {
    expect(parseLikeCursor(raw([ALICE.toUpperCase(), 'likes', cursor.createdAt, LIKE.toUpperCase()]), ALICE)).toEqual({
      ok: true,
      cursor,
    });
  });

  it.each([
    ['他の対象者のカーソル', encodeLikeCursor(BOB, cursor)],
    ['他のタブ（投稿）のカーソル', encodeActivityCursor(ALICE, 'tweets', { eventAt: cursor.createdAt, kind: 'tweet', eventId: LIKE })],
    ['他のタブ名', raw([ALICE, 'favorites', cursor.createdAt, LIKE])],
    ['日時が実在しない', raw([ALICE, 'likes', '2026-02-30T00:00:00.000000Z', LIKE])],
    ['年0000', raw([ALICE, 'likes', '0000-01-01T00:00:00.000000Z', LIKE])],
    ['ミリ秒精度', raw([ALICE, 'likes', '2026-10-27T03:00:00.123Z', LIKE])],
    ['いいねUUIDが不正', raw([ALICE, 'likes', cursor.createdAt, 'nope'])],
    ['要素数違い', raw([ALICE, 'likes', cursor.createdAt])],
    ['壊れた文字列', '%%%'],
    ['重複パラメータ', ['a', 'b']],
  ])('%sは不正', (_label, value) => {
    expect(parseLikeCursor(value, ALICE)).toEqual({ ok: false });
  });
});
