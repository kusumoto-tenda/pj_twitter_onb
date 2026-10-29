import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/dtos/timeline/timeline';
import { authenticateUser } from '@/application/usecases/users/authenticate-user';
import { createAccount } from '@/application/usecases/users/create-account';
import { deleteAccount } from '@/application/usecases/users/delete-account';
import { PostgresProfileQuery } from '@/infra/persistence/postgres/query_services/postgres-profile-query';
import { PostgresTimelineQuery } from '@/infra/persistence/postgres/query_services/postgres-timeline-query';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/external_services/auth/scrypt-password-hasher';
import { connectTestDatabase, uniqueDisplayId } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: PostgresUserRepository;
let fixtures: TimelineFixtures;
const passwords = new ScryptPasswordHasher();

let year = 2750 + Math.floor(Math.random() * 50);
const at = (minute: number) => `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.000000Z`;

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new PostgresUserRepository(sql);
  fixtures = new TimelineFixtures(sql);
});

afterEach(async () => {
  // 削除済みでも内部UUIDで後片付けできる（存在しない行のDELETEは何もしない）。
  await fixtures.cleanup();
  year += 1;
});

afterAll(async () => {
  await sql.end();
});

/** ログインできる利用者を実Hasherで作る。 */
async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    { users, passwords, newId: randomUUID, now: () => new Date() },
    { name, displayId: uniqueDisplayId('Dl'), bio: '', password: 'password123' },
  );
  if (!result.ok) throw new Error(result.code);
  const { id, displayId } = result.account;
  return fixtures.track({ id, name, displayId });
}

/** A/B/Cと、Aに関係するデータ・関係しないデータを用意する。 */
async function scenario() {
  const a = await fixtures.user('A', 'Dl');
  const b = await fixtures.user('B', 'Dl');
  const c = await fixtures.user('C', 'Dl');
  const aTweet = await fixtures.tweet(a, 'Aの投稿', at(1));
  const bTweet = await fixtures.tweet(b, 'Bの投稿', at(2));
  const cTweet = await fixtures.tweet(c, 'Cの投稿', at(3));
  const aFollowsB = await fixtures.follow(a, b);
  const bFollowsA = await fixtures.follow(b, a);
  const bFollowsC = await fixtures.follow(b, c);
  const aRetweetsB = await fixtures.retweet(a, bTweet, at(4));
  const bRetweetsA = await fixtures.retweet(b, aTweet, at(5));
  const cRetweetsB = await fixtures.retweet(c, bTweet, at(6));
  const aFavoritesB = await fixtures.favorite(a, bTweet, at(7));
  const bFavoritesA = await fixtures.favorite(b, aTweet, at(8));
  const cFavoritesB = await fixtures.favorite(c, bTweet, at(9));
  const aLikesB = await fixtures.like(a, bTweet, at(10));
  const bLikesA = await fixtures.like(b, aTweet, at(11));
  const cLikesB = await fixtures.like(c, bTweet, at(12));
  return {
    a, b, c, aTweet, bTweet, cTweet, aFollowsB, bFollowsA, bFollowsC, aRetweetsB, bRetweetsA, cRetweetsB,
    aFavoritesB, bFavoritesA, cFavoritesB, aLikesB, bLikesA, cLikesB,
  };
}

async function existing(table: 'users' | 'tweets' | 'follows' | 'retweets' | 'favorites' | 'likes', ids: string[]) {
  const rows = await sql`SELECT id FROM ${sql('twitter.' + table)} WHERE id = ANY(${ids}::uuid[])`;
  return new Set(rows.map((r) => r.id as string));
}

describe('PostgresUserRepository.deleteById', () => {
  it('対象1件を削除して deleted、2回目以降は not-found を返す', async () => {
    const a = await fixtures.user('A', 'Dl');
    const b = await fixtures.user('B', 'Dl');

    expect(await users.deleteById(a.id)).toBe('deleted');
    expect(await users.deleteById(a.id)).toBe('not-found');
    expect(await existing('users', [a.id, b.id])).toEqual(new Set([b.id]));
  });

  it('存在しないUUIDなら not-found を返し、何も削除しない', async () => {
    const a = await fixtures.user('A', 'Dl');

    expect(await users.deleteById(randomUUID())).toBe('not-found');
    expect(await existing('users', [a.id])).toEqual(new Set([a.id]));
  });

  it('接続障害はthrowする', async () => {
    const broken = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { connect_timeout: 1, max: 1 });
    try {
      await expect(new PostgresUserRepository(broken).deleteById(randomUUID())).rejects.toThrow();
    } finally {
      await broken.end({ timeout: 0 });
    }
  });

  it('本人に関係するデータだけをCASCADEで削除し、他人のデータは維持する', async () => {
    const s = await scenario();

    await users.deleteById(s.a.id);

    expect(await existing('users', [s.a.id, s.b.id, s.c.id])).toEqual(new Set([s.b.id, s.c.id]));
    expect(await existing('tweets', [s.aTweet, s.bTweet, s.cTweet])).toEqual(new Set([s.bTweet, s.cTweet]));
    expect(await existing('follows', [s.aFollowsB, s.bFollowsA, s.bFollowsC])).toEqual(new Set([s.bFollowsC]));
    // Aが実行したリツイートと、削除されたAの投稿へのリツイートが消え、無関係なリツイートは残る
    expect(await existing('retweets', [s.aRetweetsB, s.bRetweetsA, s.cRetweetsB])).toEqual(
      new Set([s.cRetweetsB]),
    );
    // Aの保存と、削除されたAの投稿への保存が消え、無関係な保存は残る（お気に入りが退会を妨げない）
    expect(await existing('favorites', [s.aFavoritesB, s.bFavoritesA, s.cFavoritesB])).toEqual(new Set([s.cFavoritesB]));
    // Aのいいねと、削除されたAの投稿へのいいねが消え、他人のいいねは残る（いいねが退会を妨げない）
    expect(await existing('likes', [s.aLikesB, s.bLikesA, s.cLikesB])).toEqual(new Set([s.cLikesB]));
  });

  it('削除後は公開プロフィールがなく、一覧・件数にも反映される', async () => {
    const s = await scenario();
    const profiles = new PostgresProfileQuery(sql);

    await users.deleteById(s.a.id);

    expect(await profiles.findSummary({ displayId: s.a.displayId, viewerId: null })).toBeNull();
    expect(await profiles.findSummary({ displayId: s.b.displayId, viewerId: null })).toMatchObject({
      followingCount: 1,
      followerCount: 0,
    });
    const timeline = await new PostgresTimelineQuery(sql).findPage({
      followingOnly: true,
      viewerId: s.b.id,
      after: null,
      limit: 20,
    });
    const events = timeline.items.map((i) => i.key.eventId);
    expect(events).not.toContain(s.aTweet);
    expect(events).not.toContain(s.bRetweetsA);
    expect(timeline.items.every((i) => i.tweet.author.id !== s.a.id && i.retweetedBy?.id !== s.a.id)).toBe(true);
  });

  it('削除済みのIDでは認証できず、同じIDで別のUUIDとして登録し直せる（旧UUIDとは対応付けない）', async () => {
    const a = await loginableUser('削除される人');
    const deps = { users, passwords, newId: randomUUID, now: () => new Date() };

    await users.deleteById(a.id);
    expect(await authenticateUser(deps, { displayId: a.displayId, password: 'password123' })).toBeNull();

    const again = await createAccount(deps, {
      name: '新しい人',
      displayId: a.displayId,
      bio: '',
      password: 'password123',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    fixtures.track({ id: again.account.id, name: '新しい人', displayId: a.displayId });
    expect(again.account.id).not.toBe(a.id);
    expect(await users.findById(a.id)).toBeNull();
  });
});

describe('deleteAccount（実DB・実Hasher）', () => {
  it('パスワードが違えば本人と関連データを一切変えない', async () => {
    const a = await loginableUser('A');
    const b = await fixtures.user('B', 'Dl');
    const tweet = await fixtures.tweet(a, 'Aの投稿', at(1));
    const follow = await fixtures.follow(b, a);
    const deps = { users, passwords };

    const result = await deleteAccount(deps, { actorId: a.id, targetId: a.id, password: 'wrong-pass' });

    expect(result).toEqual({ ok: false, code: 'INVALID_PASSWORD' });
    expect(await existing('users', [a.id])).toEqual(new Set([a.id]));
    expect(await existing('tweets', [tweet])).toEqual(new Set([tweet]));
    expect(await existing('follows', [follow])).toEqual(new Set([follow]));
  });

  it('正しいパスワードなら削除する', async () => {
    const a = await loginableUser('A');

    expect(
      await deleteAccount({ users, passwords }, { actorId: a.id, targetId: a.id, password: 'password123' }),
    ).toEqual({ ok: true });
    expect(await users.findById(a.id)).toBeNull();
  });
});
