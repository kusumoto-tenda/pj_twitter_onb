import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TimelinePerson } from '@/application/timeline/timeline';
import type { ValidEditTweetInput } from '@/domain/tweets/edit-tweet-validation';
import { PostgresTweetEditor } from '@/infra/repositories/postgres-tweet-editor';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { MediaFixtures, PNG_IMAGE } from '@/test/support/media-fixtures';
import { connectTestDatabase } from '@/test/support/test-db';
import { TimelineFixtures } from '@/test/support/timeline-fixtures';

let sql: postgres.Sql;
let users: TimelineFixtures;
let media: MediaFixtures;
let editor: PostgresTweetEditor;
const NOW = new Date();
const later = (ms: number) => new Date(NOW.getTime() + ms);
const editDrafts: string[] = [];

beforeAll(async () => {
  sql = await connectTestDatabase();
  users = new TimelineFixtures(sql);
  media = new MediaFixtures(sql);
  editor = new PostgresTweetEditor(sql);
});

afterEach(async () => {
  const ids = editDrafts.splice(0);
  if (ids.length > 0) {
    await sql`DELETE FROM twitter.images WHERE upload_id IN (SELECT id FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[]))`;
    await sql`DELETE FROM twitter.media_delete_jobs WHERE storage_key IN (SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[]))`;
    await sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${ids}::uuid[])`;
    await sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${ids}::uuid[])`;
  }
  await users.cleanup();
  await media.cleanup();
});

afterAll(async () => {
  await sql.end();
});

/** 画像（幅で識別）付きの投稿を作る。 */
async function postWithImages(owner: TimelinePerson, content: string, widths: number[] = []) {
  const draftId = await media.draft(owner.id, NOW);
  const uploads = [];
  for (const width of widths) {
    uploads.push((await media.verified(owner.id, draftId, NOW, { ...PNG_IMAGE, width, height: 10 })).uploadId);
  }
  const outcome = await media.writer.publish({
    actorId: owner.id,
    draftId,
    value: { content, uploadIds: uploads },
    fingerprint: 'create',
    now: NOW,
  });
  if (outcome.status !== 'published') throw new Error(outcome.status);
  return draftId;
}

async function prepare(actor: TimelinePerson, tweetId: string) {
  const draftId = randomUUID();
  editDrafts.push(draftId);
  return editor.prepare({ actorId: actor.id, tweetId, draftId, now: NOW, expiresAt: later(24 * 3600_000) });
}

async function ready(actor: TimelinePerson, tweetId: string) {
  const outcome = await prepare(actor, tweetId);
  if (outcome.status !== 'ready') throw new Error(outcome.status);
  return outcome.value;
}

function commit(actor: TimelinePerson, draftId: string, value: ValidEditTweetInput, now = later(1000)) {
  return editor.commit({
    actorId: actor.id,
    draftId,
    value,
    fingerprint: JSON.stringify([value.content, value.keepImageIds, value.uploadIds]),
    now,
  });
}

async function tweetRow(id: string) {
  const [row] = await sql`
    SELECT id, owner_id, content, created_at, updated_at, revision::text AS revision FROM twitter.tweets WHERE id = ${id}
  `;
  return row;
}

async function imagesOf(tweetId: string) {
  return sql<{ id: string; position: number; width: number; storage_key: string; upload_id: string }[]>`
    SELECT id, position, width, storage_key, upload_id FROM twitter.images WHERE tweet_id = ${tweetId} ORDER BY position
  `;
}

describe('PostgresTweetEditor.prepare', () => {
  it('本人の投稿の現在の本文・画像を返し、版を記録した編集用の下書きを作る（元の投稿は変えない）', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元の本文', [30, 10]);
    const before = await tweetRow(tweetId);

    const value = await ready(alice, tweetId);

    expect(value).toMatchObject({ tweetId, content: '元の本文' });
    expect(value.images.map((i) => [i.position, i.width])).toEqual([
      [0, 30],
      [1, 10],
    ]);
    const [draft] = await sql`
      SELECT purpose, target_tweet_id, base_revision::text AS base_revision, status FROM twitter.tweet_drafts WHERE id = ${value.draftId}
    `;
    expect(draft).toEqual({ purpose: 'edit', target_tweet_id: tweetId, base_revision: '0', status: 'open' });
    expect(await tweetRow(tweetId)).toEqual(before);
  });

  it('他人の投稿はforbidden、存在しない投稿はnot-foundで、下書きを作らない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const bob = await users.user('ボブ', 'Ed');
    const tweetId = await postWithImages(alice, '元');

    expect(await prepare(bob, tweetId)).toEqual({ status: 'forbidden' });
    expect(await prepare(alice, randomUUID())).toEqual({ status: 'not-found' });
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM twitter.tweet_drafts WHERE id = ANY(${editDrafts}::uuid[])`;
    expect(count).toBe(0);
  });
});

describe('PostgresTweetEditor.commit', () => {
  it('本文を更新し、版と編集日時を進める。UUID・所有者・投稿日・リツイートは変えない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const bob = await users.user('ボブ', 'Ed');
    const tweetId = await postWithImages(alice, '元の本文');
    const retweet = await users.retweet(bob, tweetId, later(10).toISOString());
    const before = await tweetRow(tweetId);
    const value = await ready(alice, tweetId);

    expect(await commit(alice, value.draftId, { content: '新しい本文', keepImageIds: [], uploadIds: [] })).toEqual({
      status: 'updated',
      tweetId,
      replayed: false,
    });

    const after = await tweetRow(tweetId);
    expect(after).toMatchObject({ id: tweetId, owner_id: alice.id, content: '新しい本文', revision: '1' });
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    const [rt] = await sql`SELECT tweet_id, executor_id FROM twitter.retweets WHERE id = ${retweet}`;
    expect(rt).toEqual({ tweet_id: tweetId, executor_id: bob.id });
  });

  it('先頭・中間の画像を解除し、保持した画像のID・実体はそのまま位置だけ詰め、新規画像を末尾に追加する', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '', [10, 20, 30, 40]);
    const value = await ready(alice, tweetId);
    const [first, second, third, fourth] = await imagesOf(tweetId);
    const added = await media.verified(alice.id, value.draftId, NOW, { ...PNG_IMAGE, width: 50, height: 10 });

    const outcome = await commit(alice, value.draftId, {
      content: '',
      keepImageIds: [second.id, fourth.id],
      uploadIds: [added.uploadId],
    });

    expect(outcome).toMatchObject({ status: 'updated' });
    const after = await imagesOf(tweetId);
    expect(after.map((i) => [i.width, i.position])).toEqual([
      [20, 0],
      [40, 1],
      [50, 2],
    ]);
    expect(after.slice(0, 2).map((i) => [i.id, i.storage_key])).toEqual([
      [second.id, second.storage_key],
      [fourth.id, fourth.storage_key],
    ]);
    // 解除した画像だけ削除予約を作り、保持画像には作らない
    const jobs = await sql`SELECT storage_key FROM twitter.media_delete_jobs WHERE storage_key = ANY(${[first, second, third, fourth].map((i) => i.storage_key)})`;
    expect(jobs.map((j) => j.storage_key).sort()).toEqual([first.storage_key, third.storage_key].sort());
    const [upload] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${added.uploadId}`;
    expect(upload.status).toBe('attached');
  });

  it('解除した画像の削除予約は、その画像のトークンの期限以降にする', async () => {
    const alice = await users.user('アリス', 'Ed');
    // トークンがまだ有効な画像で投稿する
    const createDraft = await media.draft(alice.id, NOW);
    const upload = await media.verified(alice.id, createDraft, NOW);
    await media.writer.publish({ actorId: alice.id, draftId: createDraft, value: { content: 'a', uploadIds: [upload.uploadId] }, fingerprint: 'c', now: NOW });
    const value = await ready(alice, createDraft);

    await commit(alice, value.draftId, { content: 'a', keepImageIds: [], uploadIds: [] });

    const [row] = await sql`
      SELECT j.not_before, u.token_valid_until FROM twitter.media_delete_jobs j
      JOIN twitter.media_uploads u ON u.storage_key = j.storage_key WHERE j.storage_key = ${upload.storageKey}
    `;
    expect(row.not_before.getTime()).toBeGreaterThanOrEqual(row.token_valid_until.getTime());
  });

  it('画像をすべて解除して本文だけにできる。画像も本文もなくすことはDBが拒否する', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '', [10]);
    const value = await ready(alice, tweetId);

    await expect(commit(alice, value.draftId, { content: '', keepImageIds: [], uploadIds: [] })).rejects.toThrow();
    expect(await imagesOf(tweetId)).toHaveLength(1);

    expect(await commit(alice, value.draftId, { content: '本文だけ', keepImageIds: [], uploadIds: [] })).toMatchObject({ status: 'updated' });
    expect(await imagesOf(tweetId)).toHaveLength(0);
  });

  it('何も変えない保存は成功するが、版と編集日時は進めない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, 'そのまま', [10]);
    const before = await tweetRow(tweetId);
    const value = await ready(alice, tweetId);

    expect(
      await commit(alice, value.draftId, { content: 'そのまま', keepImageIds: value.images.map((i) => i.id), uploadIds: [] }),
    ).toMatchObject({ status: 'updated' });
    expect(await tweetRow(tweetId)).toEqual(before);
  });

  it('同じ下書き・同じ入力の再送は成功済みとして扱い、別の入力は競合にする', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元');
    const value = await ready(alice, tweetId);
    const input = { content: '更新', keepImageIds: [], uploadIds: [] };

    await commit(alice, value.draftId, input);
    expect(await commit(alice, value.draftId, input)).toEqual({ status: 'updated', tweetId, replayed: true });
    expect(await commit(alice, value.draftId, { ...input, content: '別' })).toEqual({ status: 'conflict' });
    expect(await tweetRow(tweetId)).toMatchObject({ content: '更新', revision: '1' });
  });

  it('同じ版から開いた2つの編集を同時に確定すると、1件だけ成功し、もう1件は競合で何も変えない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元', [10, 20]);
    const a = await ready(alice, tweetId);
    const b = await ready(alice, tweetId);

    const outcomes = await Promise.all([
      commit(alice, a.draftId, { content: 'A', keepImageIds: [a.images[0].id], uploadIds: [] }),
      commit(alice, b.draftId, { content: 'B', keepImageIds: [b.images[1].id], uploadIds: [] }),
    ]);

    expect(outcomes.map((o) => o.status).sort()).toEqual(['conflict', 'updated']);
    const winner = outcomes[0].status === 'updated' ? { content: 'A', keep: a.images[0].id } : { content: 'B', keep: b.images[1].id };
    expect(await tweetRow(tweetId)).toMatchObject({ content: winner.content, revision: '1' });
    expect((await imagesOf(tweetId)).map((i) => i.id)).toEqual([winner.keep]);
  });

  it('他人（アカウントの切り替え）・作成用の下書き・期限切れ・対象削除では更新しない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const bob = await users.user('ボブ', 'Ed');
    const tweetId = await postWithImages(alice, '元');
    const value = await ready(alice, tweetId);
    const input = { content: '書き換え', keepImageIds: [], uploadIds: [] };

    expect(await commit(bob, value.draftId, input)).toEqual({ status: 'forbidden' });
    const createDraft = await media.draft(alice.id, NOW);
    expect(await commit(alice, createDraft, input)).toEqual({ status: 'not-found' });
    expect(await commit(alice, value.draftId, input, later(25 * 3600_000))).toEqual({ status: 'draft-closed' });
    expect(await tweetRow(tweetId)).toMatchObject({ content: '元', revision: '0' });

    await sql.begin((tx) => tx`DELETE FROM twitter.tweets WHERE id = ${tweetId}`);
    expect(await commit(alice, value.draftId, input)).toEqual({ status: 'not-found' });
  });

  it('作成用の確定（publish）は編集用の下書きを受け付けない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元');
    const value = await ready(alice, tweetId);

    expect(
      await media.writer.publish({ actorId: alice.id, draftId: value.draftId, value: { content: 'x', uploadIds: [] }, fingerprint: 'x', now: NOW }),
    ).toEqual({ status: 'draft-not-found' });
  });

  it('別の投稿の画像・並べ替えた保持画像はinvalid-images、別の下書きや未検証の新規画像はupload-not-readyで、何も変えない', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元', [10, 20]);
    const otherTweet = await postWithImages(alice, '別', [30]);
    const value = await ready(alice, tweetId);
    const [first, second] = value.images;
    const [foreign] = await imagesOf(otherTweet);
    const otherDraftUpload = await media.verified(alice.id, await media.draft(alice.id, NOW));
    const unverified = await media.reserved(alice.id, value.draftId, NOW);

    expect(await commit(alice, value.draftId, { content: '元', keepImageIds: [first.id, foreign.id], uploadIds: [] })).toEqual({ status: 'invalid-images' });
    expect(await commit(alice, value.draftId, { content: '元', keepImageIds: [second.id, first.id], uploadIds: [] })).toEqual({ status: 'invalid-images' });
    expect(await commit(alice, value.draftId, { content: '元', keepImageIds: [], uploadIds: [otherDraftUpload.uploadId] })).toEqual({ status: 'upload-not-ready' });
    expect(await commit(alice, value.draftId, { content: '元', keepImageIds: [], uploadIds: [unverified.uploadId] })).toEqual({ status: 'upload-not-ready' });
    expect((await imagesOf(tweetId)).map((i) => i.id)).toEqual([first.id, second.id]);
    expect(await tweetRow(tweetId)).toMatchObject({ revision: '0' });
  });

  it('未使用の新規画像は確定時に破棄し、キャンセル（下書きの破棄）では元の画像を残して新規画像だけを破棄する', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元', [10]);
    const value = await ready(alice, tweetId);
    const unused = await media.verified(alice.id, value.draftId, NOW);
    await commit(alice, value.draftId, { content: '元', keepImageIds: value.images.map((i) => i.id), uploadIds: [] });
    const [unusedRow] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${unused.uploadId}`;
    expect(unusedRow.status).toBe('discarded');

    const cancelled = await ready(alice, tweetId);
    const added = await media.verified(alice.id, cancelled.draftId, NOW);
    expect(await media.writer.discardDraft({ actorId: alice.id, draftId: cancelled.draftId, now: NOW })).toBe('discarded');
    expect((await imagesOf(tweetId)).map((i) => i.id)).toEqual(value.images.map((i) => i.id));
    const [addedRow] = await sql`SELECT status FROM twitter.media_uploads WHERE id = ${added.uploadId}`;
    expect(addedRow.status).toBe('discarded');
  });

  it('編集用の下書きがあっても、アカウント削除は成功する', async () => {
    const alice = await users.user('アリス', 'Ed');
    const tweetId = await postWithImages(alice, '元', [10]);
    await ready(alice, tweetId);

    expect(await new PostgresUserRepository(sql).deleteById(alice.id)).toBe('deleted');
  });
});
