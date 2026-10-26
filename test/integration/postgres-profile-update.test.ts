import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { authenticateUser } from '@/application/users/authenticate-user';
import { createAccount } from '@/application/users/create-account';
import { PostgresProfileQuery } from '@/infra/queries/postgres-profile-query';
import { PostgresTimelineQuery } from '@/infra/queries/postgres-timeline-query';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { connectTestDatabase, uniqueDisplayId } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: PostgresUserRepository;
let fixtures: TimelineFixtures;

let year = 2700 + Math.floor(Math.random() * 50);
const at = (minute: number) => `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.000000Z`;

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new PostgresUserRepository(sql);
  fixtures = new TimelineFixtures(sql);
});

afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

afterAll(async () => {
  await sql.end();
});

async function row(id: string) {
  const [r] = await sql`
    SELECT id, name, display_id, bio, password_hash, created_at FROM twitter.users WHERE id = ${id}
  `;
  return r;
}

describe('PostgresUserRepository.updateProfile', () => {
  it('名前・ID・bioを1回で更新し、公開プロフィールを返す（他の列は変えない）', async () => {
    const alice = await fixtures.user('アリス', 'Ed', { bio: '前の自己紹介' });
    const before = await row(alice.id);
    const newId = uniqueDisplayId('Nw');

    const outcome = await users.updateProfile(alice.id, { name: 'アリス改', displayId: newId, bio: '' });

    expect(outcome).toEqual({
      status: 'updated',
      profile: { id: alice.id, name: 'アリス改', displayId: newId, bio: '', createdAt: before.created_at },
    });
    expect(JSON.stringify(outcome)).not.toMatch(/password|fixture-hash/);
    const after = await row(alice.id);
    expect(after).toMatchObject({ name: 'アリス改', display_id: newId, bio: '' });
    expect({ hash: after.password_hash, created: after.created_at }).toEqual({
      hash: before.password_hash,
      created: before.created_at,
    });
  });

  it('対象がなければ not-found を返す', async () => {
    expect(
      await users.updateProfile(randomUUID(), { name: 'だれ', displayId: uniqueDisplayId(), bio: '' }),
    ).toEqual({ status: 'not-found' });
  });

  it('同じIDのまま保存でき、本人の大小文字だけの変更も保存できる', async () => {
    const alice = await fixtures.user('アリス', 'ed');

    expect(
      await users.updateProfile(alice.id, { name: '名前変更', displayId: alice.displayId, bio: '' }),
    ).toMatchObject({ status: 'updated' });
    const upper = alice.displayId.toUpperCase();
    expect(await users.updateProfile(alice.id, { name: '名前変更', displayId: upper, bio: '' })).toMatchObject({
      status: 'updated',
      profile: { displayId: upper },
    });
    expect((await row(alice.id)).display_id).toBe(upper);
  });

  it('他人のIDと大小文字違いで重複したら display-id-taken を返し、3項目とも変えない', async () => {
    const alice = await fixtures.user('アリス', 'Ed', { bio: '元のbio' });
    const bob = await fixtures.user('ボブ', 'Ed');
    const before = await row(alice.id);

    const outcome = await users.updateProfile(alice.id, {
      name: '変更',
      displayId: bob.displayId.toUpperCase(),
      bio: '変更',
    });

    expect(outcome).toEqual({ status: 'display-id-taken' });
    expect(await row(alice.id)).toEqual(before);
  });

  it('2人が同じ新IDへ同時に変更すると、片方だけ成功する', async () => {
    const a = await fixtures.user('A', 'Ed');
    const b = await fixtures.user('B', 'Ed');
    const target = uniqueDisplayId('Cc');

    const outcomes = await Promise.all([
      users.updateProfile(a.id, { name: 'A', displayId: target, bio: '' }),
      users.updateProfile(b.id, { name: 'B', displayId: target.toLowerCase(), bio: '' }),
    ]);

    expect(outcomes.map((o) => o.status).sort()).toEqual(['display-id-taken', 'updated']);
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM twitter.users WHERE lower(display_id) = ${target.toLowerCase()}
    `;
    expect(count).toBe(1);
  });

  it('登録と変更が同じIDで競合しても、同じ一意制約で片方だけ成功する', async () => {
    const a = await fixtures.user('A', 'Ed');
    const target = uniqueDisplayId('Rc');
    const newcomerId = randomUUID();
    fixtures.track({ id: newcomerId, name: '新規', displayId: target });

    const [updated, created] = await Promise.all([
      users.updateProfile(a.id, { name: 'A', displayId: target, bio: '' }),
      users.create({
        id: newcomerId,
        name: '新規',
        displayId: target.toUpperCase(),
        bio: '',
        passwordHash: 'x',
        createdAt: new Date(),
      }),
    ]);

    expect([updated.status === 'updated', created === 'created'].filter(Boolean)).toHaveLength(1);
  });

  it('投稿・フォロー・リツイートの関連UUIDを変えず、読み取りは更新後の名前・IDを返す', async () => {
    const alice = await fixtures.user('アリス', 'Ed');
    const bob = await fixtures.user('ボブ', 'Ed');
    const tweetId = await fixtures.tweet(alice, 'アリスの投稿', at(1));
    await fixtures.retweet(alice, await fixtures.tweet(bob, 'ボブの投稿', at(2)), at(3));
    await fixtures.follow(bob, alice);
    const newId = uniqueDisplayId('Rn');

    await users.updateProfile(alice.id, { name: '新しい名前', displayId: newId, bio: '' });

    const [relations] = await sql`
      SELECT
        (SELECT owner_id FROM twitter.tweets WHERE id = ${tweetId}) AS owner,
        (SELECT count(*)::int FROM twitter.retweets WHERE executor_id = ${alice.id}) AS retweets,
        (SELECT count(*)::int FROM twitter.follows WHERE follow_id = ${alice.id}) AS followers
    `;
    expect(relations).toEqual({ owner: alice.id, retweets: 1, followers: 1 });

    const renamed: TimelinePerson = { id: alice.id, name: '新しい名前', displayId: newId };
    const profiles = new PostgresProfileQuery(sql);
    expect(await profiles.findSummary({ displayId: newId, viewerId: null })).toMatchObject(renamed);
    expect(await profiles.findSummary({ displayId: alice.displayId, viewerId: null })).toBeNull();
    expect(
      (await profiles.findConnectionsPage({ subjectId: bob.id, direction: 'following', after: null, limit: 20 }))
        .items,
    ).toEqual([renamed]);
    const timeline = await new PostgresTimelineQuery(sql).findPage({
      followingOnly: true,
      viewerId: alice.id,
      after: null,
      limit: 20,
    });
    expect(timeline.items.find((i) => i.key.eventId === tweetId)?.tweet.author).toEqual(renamed);
    expect(timeline.items.find((i) => i.key.kind === 'retweet')?.retweetedBy).toEqual(renamed);
  });

  it('新IDで認証でき、旧IDでは同じ利用者として認証できない（パスワードは変わらない）', async () => {
    const deps = {
      users,
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    };
    const oldId = uniqueDisplayId('Au');
    const created = await createAccount(deps, {
      name: '認証', displayId: oldId, bio: '', password: 'password123',
    });
    if (!created.ok) throw new Error(created.code);
    fixtures.track({ id: created.account.id, name: '認証', displayId: oldId });
    const newId = uniqueDisplayId('Au');

    await users.updateProfile(created.account.id, { name: '認証', displayId: newId, bio: '' });

    expect(
      (await authenticateUser(deps, { displayId: newId, password: 'password123' }))?.id,
    ).toBe(created.account.id);
    expect(await authenticateUser(deps, { displayId: oldId, password: 'password123' })).toBeNull();
  });

  it('一意性以外のCHECK違反や接続障害は display-id-taken にせずthrowする', async () => {
    const alice = await fixtures.user('アリス', 'Ed');

    await expect(
      users.updateProfile(alice.id, { name: '', displayId: alice.displayId, bio: '' }),
    ).rejects.toThrow();
    await expect(
      users.updateProfile(alice.id, { name: 'a', displayId: 'bad-id!', bio: '' }),
    ).rejects.toThrow();

    const broken = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { connect_timeout: 1, max: 1 });
    try {
      await expect(
        new PostgresUserRepository(broken).updateProfile(alice.id, {
          name: 'a',
          displayId: alice.displayId,
          bio: '',
        }),
      ).rejects.toThrow();
    } finally {
      await broken.end({ timeout: 0 });
    }
  });
});
