import { describe, expect, it } from 'vitest';
import type { TimelineCursor } from '@/application/timeline/timeline';
import {
  MAX_CURSOR_LENGTH,
  encodeCursor,
  parseCursorParam,
  parseFollowParam,
  timelineHref,
} from '@/app/lib/timeline-query';

const cursor: TimelineCursor = {
  eventAt: '2026-10-23T03:04:05.123456Z',
  kind: 'retweet',
  eventId: '0b9e6a52-1f3c-4d7e-9a1b-2c3d4e5f6a7b',
};

const encodeRaw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('parseFollowParam', () => {
  it('単一の文字列 true のときだけ絞り込みにする', () => {
    expect(parseFollowParam('true')).toBe(true);
  });

  it.each([
    ['欠落', undefined],
    ['false', 'false'],
    ['未知の値', 'yes'],
    ['大文字', 'TRUE'],
    ['重複パラメータ', ['true', 'true']],
  ])('%sは全体一覧にする', (_label, value) => {
    expect(parseFollowParam(value)).toBe(false);
  });
});

describe('カーソル', () => {
  it('エンコードとデコードで往復し、小数秒6桁を保つ', () => {
    const encoded = encodeCursor(cursor);

    expect(parseCursorParam(encoded)).toEqual({ ok: true, cursor });
  });

  it('kindがtweetのカーソルも往復する', () => {
    const tweetCursor = { ...cursor, kind: 'tweet' as const };

    expect(parseCursorParam(encodeCursor(tweetCursor))).toEqual({ ok: true, cursor: tweetCursor });
  });

  it('未指定なら先頭（null）にする', () => {
    expect(parseCursorParam(undefined)).toEqual({ ok: true, cursor: null });
  });

  it.each([
    ['空文字', ''],
    ['重複パラメータ', [encodeCursor(cursor), encodeCursor(cursor)]],
    ['上限を超える長さ', 'a'.repeat(MAX_CURSOR_LENGTH + 1)],
    ['壊れたBase64', '!!!not-base64!!!'],
    ['壊れたJSON', Buffer.from('{"eventAt":').toString('base64url')],
    ['配列でない', encodeRaw({ eventAt: cursor.eventAt })],
    ['要素数違い', encodeRaw([cursor.eventAt, cursor.kind])],
    ['日時の形式違い', encodeRaw(['2026-10-23 03:04:05', cursor.kind, cursor.eventId])],
    ['小数秒が3桁', encodeRaw(['2026-10-23T03:04:05.123Z', cursor.kind, cursor.eventId])],
    ['存在しない日付', encodeRaw(['2026-02-30T03:04:05.123456Z', cursor.kind, cursor.eventId])],
    ['存在しない時刻', encodeRaw(['2026-10-23T25:04:05.123456Z', cursor.kind, cursor.eventId])],
    ['未知のkind', encodeRaw([cursor.eventAt, 'like', cursor.eventId])],
    ['UUIDでないID', encodeRaw([cursor.eventAt, cursor.kind, 'not-a-uuid'])],
    ['SQL風の文字列', encodeRaw([cursor.eventAt, cursor.kind, "' OR 1=1 --"])],
    ['数値のID', encodeRaw([cursor.eventAt, cursor.kind, 123])],
  ])('%sは無効にする', (_label, value) => {
    expect(parseCursorParam(value)).toEqual({ ok: false });
  });

  it('上限ちょうどの長さまでは長さだけで拒否しない', () => {
    expect(encodeCursor(cursor).length).toBeLessThanOrEqual(MAX_CURSOR_LENGTH);
  });
});

describe('timelineHref', () => {
  it('全体一覧の先頭は / にする', () => {
    expect(timelineHref({ followingOnly: false, cursor: null })).toBe('/');
  });

  it('フォロー一覧の先頭はカーソルを含めない', () => {
    expect(timelineHref({ followingOnly: true, cursor: null })).toBe('/?follow=true');
  });

  it('次ページURLはフォロー条件を保持する', () => {
    const href = timelineHref({ followingOnly: true, cursor });
    const params = new URL(href, 'http://localhost').searchParams;

    expect(params.get('follow')).toBe('true');
    expect(parseCursorParam(params.get('cursor') ?? undefined)).toEqual({ ok: true, cursor });
  });

  it('全体一覧の次ページURLはfollowを含めない', () => {
    const params = new URL(timelineHref({ followingOnly: false, cursor }), 'http://localhost')
      .searchParams;

    expect(params.has('follow')).toBe(false);
    expect(params.has('cursor')).toBe(true);
  });
});
