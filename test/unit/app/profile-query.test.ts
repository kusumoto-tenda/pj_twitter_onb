import { describe, expect, it } from 'vitest';
import type { ConnectionCursor } from '@/application/dtos/profile/profile';
import type { TimelineCursor } from '@/application/dtos/timeline/timeline';
import {
  encodeActivityCursor,
  encodeConnectionCursor,
  parseActivityCursor,
  parseConnectionCursor,
  parseProfileTab,
  profileHref,
} from '@/app/lib/profile-query';
import { MAX_CURSOR_LENGTH } from '@/app/lib/cursor-validation';

const subjectId = '0b9e6a52-1f3c-4d7e-9a1b-2c3d4e5f6a7b';
const otherId = '1c9e6a52-1f3c-4d7e-9a1b-2c3d4e5f6a7c';
const tweetCursor: TimelineCursor = {
  eventAt: '2026-10-23T03:04:05.123456Z',
  kind: 'tweet',
  eventId: '2d9e6a52-1f3c-4d7e-9a1b-2c3d4e5f6a7d',
};
const retweetCursor: TimelineCursor = { ...tweetCursor, kind: 'retweet' };
const connectionCursor: ConnectionCursor = {
  createdAt: '2026-10-23T03:04:05.000001Z',
  relationId: '3e9e6a52-1f3c-4d7e-9a1b-2c3d4e5f6a7e',
};
const encodeRaw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('parseProfileTab', () => {
  it.each([
    ['retweets', 'retweets'],
    ['likes', 'likes'],
    ['following', 'following'],
    ['followers', 'followers'],
  ] as const)('%s を受け付ける', (value, expected) => {
    expect(parseProfileTab(value)).toBe(expected);
  });

  it.each([
    ['欠落', undefined],
    ['tweets', 'tweets'],
    ['未知の値', 'favorites'],
    ['大文字のタブ名', 'LIKES'],
    ['重複パラメータ', ['retweets', 'retweets']],
  ])('%sは投稿タブにする', (_label, value) => {
    expect(parseProfileTab(value)).toBe('tweets');
  });
});

describe('投稿・リツイートのカーソル', () => {
  it('対象者・タブと一緒に往復し、小数秒6桁を保つ', () => {
    const encoded = encodeActivityCursor(subjectId, 'retweets', retweetCursor);

    expect(parseActivityCursor(encoded, subjectId, 'retweets')).toEqual({
      ok: true,
      cursor: retweetCursor,
    });
    expect(
      parseActivityCursor(encodeActivityCursor(subjectId, 'tweets', tweetCursor), subjectId, 'tweets'),
    ).toEqual({ ok: true, cursor: tweetCursor });
  });

  it('未指定は先頭（null）にする', () => {
    expect(parseActivityCursor(undefined, subjectId, 'tweets')).toEqual({ ok: true, cursor: null });
  });

  it('他の対象者・他のタブのカーソルは無効にする', () => {
    const encoded = encodeActivityCursor(subjectId, 'tweets', tweetCursor);

    expect(parseActivityCursor(encoded, otherId, 'tweets')).toEqual({ ok: false });
    expect(parseActivityCursor(encoded, subjectId, 'retweets')).toEqual({ ok: false });
    expect(parseConnectionCursor(encoded, subjectId, 'following')).toEqual({ ok: false });
  });

  it.each([
    ['タブとkindの不一致', encodeRaw([subjectId, 'tweets', tweetCursor.eventAt, 'retweet', tweetCursor.eventId])],
    ['メイン画面のカーソル', encodeRaw([tweetCursor.eventAt, 'tweet', tweetCursor.eventId])],
    ['長すぎる入力', 'a'.repeat(MAX_CURSOR_LENGTH + 1)],
    ['壊れたBase64', '!!!'],
    ['壊れたJSON', Buffer.from('[1,').toString('base64url')],
    ['年0000', encodeRaw([subjectId, 'tweets', '0000-01-01T00:00:00.000000Z', 'tweet', tweetCursor.eventId])],
    ['存在しない日付', encodeRaw([subjectId, 'tweets', '2026-02-30T00:00:00.000000Z', 'tweet', tweetCursor.eventId])],
    ['UUIDでないID', encodeRaw([subjectId, 'tweets', tweetCursor.eventAt, 'tweet', 'nope'])],
    ['重複パラメータ', ['a', 'b']],
  ])('%sは無効にする', (_label, value) => {
    expect(parseActivityCursor(value, subjectId, 'tweets')).toEqual({ ok: false });
  });
});

describe('フォロー関係のカーソル', () => {
  it('対象者・向きと一緒に往復し、小数秒6桁を保つ', () => {
    const encoded = encodeConnectionCursor(subjectId, 'followers', connectionCursor);

    expect(parseConnectionCursor(encoded, subjectId, 'followers')).toEqual({
      ok: true,
      cursor: connectionCursor,
    });
  });

  it('向き・対象者が違えば無効にする', () => {
    const encoded = encodeConnectionCursor(subjectId, 'followers', connectionCursor);

    expect(parseConnectionCursor(encoded, subjectId, 'following')).toEqual({ ok: false });
    expect(parseConnectionCursor(encoded, otherId, 'followers')).toEqual({ ok: false });
    expect(parseActivityCursor(encoded, subjectId, 'tweets')).toEqual({ ok: false });
  });

  it.each([
    ['日時の形式違い', encodeRaw([subjectId, 'following', '2026-10-23', connectionCursor.relationId])],
    ['UUIDでない関係ID', encodeRaw([subjectId, 'following', connectionCursor.createdAt, 'x'])],
    ['要素数違い', encodeRaw([subjectId, 'following', connectionCursor.createdAt])],
  ])('%sは無効にする', (_label, value) => {
    expect(parseConnectionCursor(value, subjectId, 'following')).toEqual({ ok: false });
  });
});

describe('profileHref', () => {
  it('投稿タブはtabを付けない', () => {
    expect(profileHref({ displayId: 'Alice_1', tab: 'tweets' })).toBe('/profile/Alice_1');
  });

  it('他のタブはtabを付け、切り替えではカーソルを含めない', () => {
    expect(profileHref({ displayId: 'Alice_1', tab: 'followers' })).toBe(
      '/profile/Alice_1?tab=followers',
    );
  });

  it('次ページURLは対象IDとタブを保持する', () => {
    const cursor = encodeActivityCursor(subjectId, 'retweets', retweetCursor);
    const url = new URL(profileHref({ displayId: 'Alice_1', tab: 'retweets', cursor }), 'http://x');

    expect(url.pathname).toBe('/profile/Alice_1');
    expect(url.searchParams.get('tab')).toBe('retweets');
    expect(url.searchParams.get('cursor')).toBe(cursor);
  });
});
