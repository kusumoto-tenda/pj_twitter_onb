import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { put } from '@vercel/blob/client';
import postgres from 'postgres';
import sharp from 'sharp';
import { reserveImageUpload } from '@/application/usecases/media/reserve-image-upload';
import { verifyImageUpload } from '@/application/usecases/media/verify-image-upload';
import type { TimelinePerson } from '@/application/dtos/timeline/timeline';
import { beginTweetDraft } from '@/application/usecases/tweets/begin-tweet-draft';
import { createTweet } from '@/application/usecases/tweets/create-tweet';
import { createAccount } from '@/application/usecases/users/create-account';
import { SharpImageInspector } from '@/infra/external_services/media/sharp-image-inspector';
import { VercelBlobStorage } from '@/infra/external_services/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/persistence/postgres/repositories/postgres-media-repository';
import { PostgresTweetWriter } from '@/infra/persistence/postgres/repositories/postgres-tweet-writer';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/external_services/auth/scrypt-password-hasher';
import { requireTestBlobEnvironment } from '../support/blob-environment';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。画像はテスト専用ストアだけを使う。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const storage = new VercelBlobStorage(requireTestBlobEnvironment(process.env).token);
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';
const token = () => randomUUID().slice(0, 8);
const deps = () => ({
  tweets: new PostgresTweetWriter(sql),
  media: new PostgresMediaRepository(sql),
  storage,
  inspector: new SharpImageInspector(),
  newId: randomUUID,
  now: () => new Date(),
});

const tracked: string[] = [];

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    { users: new PostgresUserRepository(sql), passwords: new ScryptPasswordHasher(), newId: randomUUID, now: () => new Date() },
    { name, displayId: uniqueDisplayId('Fv'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  tracked.push(id);
  return { id, name, displayId };
}

async function png(width: number) {
  return sharp({ create: { width, height: 10, channels: 3, background: '#3377bb' } }).png().toBuffer();
}

/** 実際のアップロード経路（予約→テスト用ストアへ直接→検証→確定）で、画像付きの投稿を作る。 */
async function post(owner: TimelinePerson, content: string, widths: number[] = []) {
  const d = deps();
  const draft = await beginTweetDraft(d, { actorId: owner.id });
  if (!draft.ok) throw new Error(draft.code);
  const uploadIds = [];
  for (const width of widths) {
    const bytes = await png(width);
    const reserved = await reserveImageUpload(d, { actorId: owner.id, draftId: draft.draftId, contentType: 'image/png', size: bytes.byteLength });
    if (!reserved.ok) throw new Error(reserved.code);
    await put(reserved.pathname, bytes, { access: 'private', token: reserved.token, contentType: 'image/png' });
    const verified = await verifyImageUpload(d, { actorId: owner.id, uploadId: reserved.uploadId });
    if (!verified.ok) throw new Error(verified.code);
    uploadIds.push(reserved.uploadId);
  }
  const result = await createTweet(d, { actorId: owner.id, draftId: draft.draftId, input: { content, uploadIds } });
  if (!result.ok) throw new Error(result.code);
  return result.tweetId;
}

async function login(page: Page, user: TimelinePerson) {
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(user.displayId);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
}

const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });
const addButton = (c: Locator) => c.getByRole('button', { name: 'お気に入りに追加' });
const removeButton = (c: Locator) => c.getByRole('button', { name: 'お気に入りを解除' });
const asPerson = (u: TimelinePerson) => ({ id: u.id, name: u.name, displayId: u.displayId });

async function favoriteRows(userId: string) {
  return (await sql`SELECT tweet_id FROM twitter.favorites WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC`).map(
    (r) => r.tweet_id as string,
  );
}

async function openFavorites(page: Page) {
  await page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('link', { name: 'お気に入り' }).click();
  await expect(page).toHaveURL('/favorites');
  await expect(page.getByRole('heading', { name: 'お気に入り', level: 1 })).toBeVisible();
}

const listedTexts = async (page: Page, t: string) =>
  (await page.getByRole('article').allTextContents()).filter((c) => c.includes(t));

/** 利用者・下書き・予約・削除予約・画像の実体を後片付けする。 */
async function cleanup() {
  const ids = tracked.splice(0);
  if (ids.length === 0) return;
  const drafts = (await sql`SELECT id FROM twitter.tweet_drafts WHERE owner_id = ANY(${ids}::uuid[])`).map((r) => r.id);
  const keys = (await sql`SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${drafts}::uuid[])`).map((r) => r.storage_key);
  await sql`DELETE FROM twitter.users WHERE id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM twitter.media_delete_jobs WHERE storage_key = ANY(${keys})`;
  await sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${drafts}::uuid[])`;
  await sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${drafts}::uuid[])`;
  if (keys.length > 0) await storage.remove(keys);
}

test.afterEach(async () => {
  await cleanup();
  await fixtures.cleanup();
});

test.afterAll(async () => {
  await sql.end();
});

test('お気に入りに追加すると状態が変わり、お気に入り一覧に出て、一覧で解除すると消える', async ({ page }) => {
  const me = await loginableUser('保存する人');
  const other = await loginableUser('投稿した人');
  const t = token();
  const tweetId = await post(other, `保存する投稿 ${t}`, [30]);

  await login(page, me);
  const target = card(page, `保存する投稿 ${t}`);
  await expect(removeButton(target)).toHaveCount(0);
  await expect(addButton(target)).toHaveAttribute('aria-pressed', 'false');
  await addButton(target).click();
  await expect(removeButton(target)).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL('/');
  expect(await favoriteRows(me.id)).toEqual([tweetId]);

  await openFavorites(page);
  const saved = card(page, `保存する投稿 ${t}`);
  await expect(saved).toBeVisible();
  await expect(saved.getByRole('img')).toHaveCount(1);
  await expect(removeButton(saved)).toBeVisible();
  await removeButton(saved).click();
  await expect(card(page, `保存する投稿 ${t}`)).toHaveCount(0);
  await expect(page.getByText('お気に入りはまだありません')).toBeVisible();
  expect(await favoriteRows(me.id)).toEqual([]);

  await page.goto('/');
  await expect(addButton(card(page, `保存する投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
});

test('解除してから追加し直すと、保存した日時の新しい順で先頭に出る', async ({ page }) => {
  const me = await loginableUser('並べる人');
  const t = token();
  const a = await post(me, `投稿A ${t}`);
  const b = await post(me, `投稿B ${t}`);

  await login(page, me);
  await addButton(card(page, `投稿A ${t}`)).click();
  await expect(removeButton(card(page, `投稿A ${t}`))).toBeVisible();
  await addButton(card(page, `投稿B ${t}`)).click();
  await expect(removeButton(card(page, `投稿B ${t}`))).toBeVisible();
  await openFavorites(page);
  expect((await listedTexts(page, t)).map((c) => (c.includes(`投稿A ${t}`) ? 'A' : 'B'))).toEqual(['B', 'A']);

  await page.goto('/');
  await removeButton(card(page, `投稿A ${t}`)).click();
  await expect(addButton(card(page, `投稿A ${t}`))).toBeVisible();
  await addButton(card(page, `投稿A ${t}`)).click();
  await expect(removeButton(card(page, `投稿A ${t}`))).toBeVisible();
  await openFavorites(page);
  expect((await listedTexts(page, t)).map((c) => (c.includes(`投稿A ${t}`) ? 'A' : 'B'))).toEqual(['A', 'B']);
  expect(await favoriteRows(me.id)).toEqual([a, b]);
});

test('リツイートのカードで保存しても元投稿を保存し、同じ元投稿のカードすべてに反映する', async ({ page }) => {
  const me = await loginableUser('同期する人');
  const other = await loginableUser('リツイートした人');
  const t = token();
  const tweetId = await post(me, `同期する投稿 ${t}`);
  await fixtures.retweet(asPerson(other), tweetId, new Date(Date.now() + 60_000).toISOString());

  await login(page, me);
  const cards = card(page, `同期する投稿 ${t}`);
  await expect(cards).toHaveCount(2);
  await addButton(card(page, `${other.name}さんがリツイート`).filter({ hasText: `同期する投稿 ${t}` })).click();

  await expect(cards.getByRole('button', { name: 'お気に入りを解除' })).toHaveCount(2);
  expect(await favoriteRows(me.id)).toEqual([tweetId]);
  await openFavorites(page);
  // 一覧は元投稿のカード（リツイートの実行者は出さない）
  await expect(card(page, `同期する投稿 ${t}`)).toHaveCount(1);
  await expect(page.getByText(`${other.name}さんがリツイート`)).toHaveCount(0);
});

test('未ログインでは保存せず「ログイン中のみお気に入りに設定できます」を3秒表示し、一覧はログイン画面へ', async ({ page }) => {
  const author = await loginableUser('投稿者');
  const t = token();
  await post(author, `匿名で見る投稿 ${t}`);

  await page.goto('/');
  const target = card(page, `匿名で見る投稿 ${t}`);
  await addButton(target).click();

  const toast = page.getByRole('alert').filter({ hasText: 'ログイン中のみお気に入りに設定できます' });
  await expect(toast).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(addButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect(await sql`SELECT 1 FROM twitter.favorites f JOIN twitter.tweets tw ON tw.id = f.tweet_id WHERE tw.owner_id = ${author.id}`).toHaveLength(0);
  await expect(page.getByRole('link', { name: 'お気に入り' })).toHaveCount(0);

  await page.goto('/favorites');
  await expect(page).toHaveURL('/login');
});

test('他人の保存は自分の一覧・ボタンに出ず、別の利用者へ切り替えた後の操作は誰の保存も変えない', async ({ page }) => {
  const a = await loginableUser('A');
  const b = await loginableUser('B');
  const t = token();
  const tweetId = await post(b, `Bの投稿 ${t}`);
  await fixtures.favorite(asPerson(b), tweetId, new Date().toISOString());

  await login(page, a);
  await expect(addButton(card(page, `Bの投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
  await openFavorites(page);
  await expect(card(page, `Bの投稿 ${t}`)).toHaveCount(0);
  await page.goto('/');

  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b);
  await addButton(card(page, `Bの投稿 ${t}`)).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ログイン中の利用者が変わりました' })).toBeVisible();
  await expect(addButton(card(page, `Bの投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
  expect(await favoriteRows(a.id)).toEqual([]);
  expect(await favoriteRows(b.id)).toEqual([tweetId]);
});

test('元投稿の編集はお気に入り一覧に反映され、元投稿を削除すると一覧から消える', async ({ page }) => {
  const me = await loginableUser('編集も見る人');
  const t = token();
  await post(me, `元の本文 ${t}`);

  await login(page, me);
  await addButton(card(page, `元の本文 ${t}`)).click();
  await expect(removeButton(card(page, `元の本文 ${t}`))).toBeVisible();
  await openFavorites(page);

  await card(page, `元の本文 ${t}`).getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: '編集する' }).click();
  const edit = page.getByRole('dialog', { name: 'ツイートを編集' });
  await edit.getByLabel('本文').fill(`編集後の本文 ${t}`);
  await edit.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  await expect(page).toHaveURL('/favorites');
  await expect(card(page, `編集後の本文 ${t}`)).toBeVisible();

  await card(page, `編集後の本文 ${t}`).getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: '削除する' }).click();
  await page.getByRole('dialog', { name: '本当に削除しますか？' }).getByRole('button', { name: 'はい' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを削除しました' })).toBeVisible();
  await expect(card(page, `編集後の本文 ${t}`)).toHaveCount(0);
  await expect(page.getByText('お気に入りはまだありません')).toBeVisible();
  expect(await favoriteRows(me.id)).toEqual([]);
});

test('お気に入りは20件ずつ表示し、次の20件・戻る・進むで位置を保つ。最後の1件を解除しても先頭へ戻れる', async ({ page }) => {
  const me = await loginableUser('たくさん保存');
  const t = token();
  const tweets = await fixtures.tweets(
    asPerson(me),
    Array.from({ length: 21 }, (_, i) => ({ content: `保存${String(i).padStart(2, '0')} ${t}`, createdAt: new Date(Date.now() - 60_000 + i).toISOString() })),
  );
  // 保存00が最も古く、保存20が最も新しい
  for (const [i, id] of tweets.entries()) await fixtures.favorite(asPerson(me), id, new Date(Date.now() + i).toISOString());

  await login(page, me);
  await openFavorites(page);
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(card(page, `保存20 ${t}`)).toBeVisible();
  await expect(card(page, `保存00 ${t}`)).toHaveCount(0);
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/\/favorites\?cursor=/);
  const second = page.url();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(card(page, `保存00 ${t}`)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/favorites');
  await expect(card(page, `保存20 ${t}`)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(second);
  await expect(card(page, `保存00 ${t}`)).toBeVisible();

  await removeButton(card(page, `保存00 ${t}`)).click();
  await expect(card(page, `保存00 ${t}`)).toHaveCount(0);
  expect(page.url()).toBe(second);
  await page.getByRole('link', { name: '最新に戻る' }).click();
  await expect(page).toHaveURL('/favorites');
  await expect(page.getByRole('article')).toHaveCount(20);
});

test('幅375pxで横スクロールせず、キーボードで保存・解除でき、処理中は連打できない', async ({ page }) => {
  const me = await loginableUser('キーボード');
  const t = token();
  const tweetId = await post(me, `キーボードで保存 ${t}`);

  await login(page, me);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  // 保存の応答を遅らせ、処理中は押せないことを確かめる
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    return route.continue();
  });
  const button = addButton(card(page, `キーボードで保存 ${t}`));
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(card(page, `キーボードで保存 ${t}`).getByRole('button', { name: /お気に入り/ })).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(removeButton(card(page, `キーボードで保存 ${t}`))).toBeEnabled();
  expect(await favoriteRows(me.id)).toEqual([tweetId]);

  await openFavorites(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await removeButton(card(page, `キーボードで保存 ${t}`)).focus();
  await page.keyboard.press('Space');
  await expect(card(page, `キーボードで保存 ${t}`)).toHaveCount(0);
  expect(await favoriteRows(me.id)).toEqual([]);
});
