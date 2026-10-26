import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { put } from '@vercel/blob/client';
import postgres from 'postgres';
import sharp from 'sharp';
import { reserveImageUpload } from '@/application/media/reserve-image-upload';
import { verifyImageUpload } from '@/application/media/verify-image-upload';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { beginTweetDraft } from '@/application/tweets/begin-tweet-draft';
import { createTweet } from '@/application/tweets/create-tweet';
import { createAccount } from '@/application/users/create-account';
import { SharpImageInspector } from '@/infra/media/sharp-image-inspector';
import { VercelBlobStorage } from '@/infra/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/repositories/postgres-media-repository';
import { PostgresTweetWriter } from '@/infra/repositories/postgres-tweet-writer';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { requireTestBlobEnvironment } from '../support/blob-environment';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーション（006を含む）は global setup で適用済み。画像はテスト専用ストアだけを使う。
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
    { name, displayId: uniqueDisplayId('Lk'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  tracked.push(id);
  return { id, name, displayId };
}

async function png(width: number) {
  return sharp({ create: { width, height: 10, channels: 3, background: '#bb3377' } }).png().toBuffer();
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

/** 別のブラウザ（Cookieを共有しない）で開いたページ。未ログインの閲覧者や相手側の確認に使う。 */
async function separatePage(browser: Browser) {
  const context = await browser.newContext();
  return { page: await context.newPage(), close: () => context.close() };
}

const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });
const likeButton = (c: Locator) => c.getByRole('button', { name: 'いいねする', exact: true });
const unlikeButton = (c: Locator) => c.getByRole('button', { name: 'いいねを取り消す', exact: true });
const anyLikeButton = (c: Locator) => c.getByRole('button', { name: /^いいね(する|を取り消す)$/ });
const likeCount = (c: Locator, count: number) => c.getByText(`いいね${count}件`, { exact: true });
const addFavorite = (c: Locator) => c.getByRole('button', { name: 'お気に入りに追加' });
const removeFavorite = (c: Locator) => c.getByRole('button', { name: 'お気に入りを解除' });
const asPerson = (u: TimelinePerson) => ({ id: u.id, name: u.name, displayId: u.displayId });
const tabLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'プロフィールのタブ' }).getByRole('link', { name, exact: true });

async function likeRows(userId: string) {
  return (await sql`SELECT tweet_id FROM twitter.likes WHERE executor_id = ${userId} ORDER BY created_at DESC, id DESC`).map(
    (r) => r.tweet_id as string,
  );
}

async function openLikesTab(page: Page, user: TimelinePerson) {
  await page.goto(`/profile/${user.displayId}`);
  await tabLink(page, 'いいね').click();
  await expect(page).toHaveURL(`/profile/${user.displayId}?tab=likes`);
  await expect(tabLink(page, 'いいね')).toHaveAttribute('aria-current', 'page');
}

const listedTexts = async (page: Page, t: string) =>
  (await page.getByRole('article').allTextContents()).filter((c) => c.includes(t));

/** 利用者・下書き・予約・削除予約・画像の実体を後片付けする（いいねはCASCADEで消える）。 */
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

test('AがBの投稿にいいねすると、Bと未ログインの閲覧者から件数とAの公開いいねタブが見え、解除すると消える', async ({ page, browser }) => {
  const a = await loginableUser('いいねする人');
  const b = await loginableUser('投稿した人');
  const t = token();
  const tweetId = await post(b, `いいねされる投稿 ${t}`, [30]);

  await login(page, a);
  const target = card(page, `いいねされる投稿 ${t}`);
  await expect(unlikeButton(target)).toHaveCount(0);
  await expect(likeButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeCount(target, 0)).toBeVisible();
  await likeButton(target).click();
  await expect(unlikeButton(target)).toHaveAttribute('aria-pressed', 'true');
  await expect(likeCount(target, 1)).toBeVisible();
  await expect(page).toHaveURL('/');
  expect(await likeRows(a.id)).toEqual([tweetId]);

  // 投稿者B：自分の投稿の件数と、Aのプロフィールの公開いいねタブで反応を確認できる（Bの本人状態は未登録）
  const bob = await separatePage(browser);
  try {
    await login(bob.page, b);
    const own = card(bob.page, `いいねされる投稿 ${t}`);
    await expect(likeCount(own, 1)).toBeVisible();
    await expect(likeButton(own)).toHaveAttribute('aria-pressed', 'false');
    await openLikesTab(bob.page, a);
    const listed = card(bob.page, `いいねされる投稿 ${t}`);
    await expect(listed).toBeVisible();
    await expect(listed.getByRole('img')).toHaveCount(1);
    await expect(likeCount(listed, 1)).toBeVisible();
    await expect(likeButton(listed)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await bob.close();
  }

  // 未ログインの閲覧者：件数と公開いいねタブを閲覧できる（ログインを要求しない）
  const anonymous = await separatePage(browser);
  try {
    await anonymous.page.goto(`/profile/${a.displayId}?tab=likes`);
    await expect(anonymous.page).toHaveURL(`/profile/${a.displayId}?tab=likes`);
    await expect(likeCount(card(anonymous.page, `いいねされる投稿 ${t}`), 1)).toBeVisible();
    await expect(likeButton(card(anonymous.page, `いいねされる投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await anonymous.close();
  }

  // Aが自分の公開いいねタブから解除すると、一覧から消え件数も戻る
  await openLikesTab(page, a);
  await unlikeButton(card(page, `いいねされる投稿 ${t}`)).click();
  await expect(card(page, `いいねされる投稿 ${t}`)).toHaveCount(0);
  await expect(page.getByText('いいねした投稿はまだありません')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${a.displayId}?tab=likes`);
  expect(await likeRows(a.id)).toEqual([]);
  await page.goto('/');
  await expect(likeCount(card(page, `いいねされる投稿 ${t}`), 0)).toBeVisible();
  await expect(likeButton(card(page, `いいねされる投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
});

test('リツイートのカードでいいねしても元投稿へのいいねになり、同じ元投稿のカードすべてに反映する。自分の投稿にもいいねできる', async ({ page }) => {
  const me = await loginableUser('同期する人');
  const other = await loginableUser('リツイートした人');
  const t = token();
  const tweetId = await post(me, `同期する投稿 ${t}`);
  await fixtures.retweet(asPerson(other), tweetId, new Date(Date.now() + 60_000).toISOString());

  await login(page, me);
  const cards = card(page, `同期する投稿 ${t}`);
  await expect(cards).toHaveCount(2);
  await likeButton(card(page, `${other.name}さんがリツイート`).filter({ hasText: `同期する投稿 ${t}` })).click();

  await expect(cards.getByRole('button', { name: 'いいねを取り消す', exact: true })).toHaveCount(2);
  await expect(cards.getByText('いいね1件', { exact: true })).toHaveCount(2);
  expect(await likeRows(me.id)).toEqual([tweetId]);
  expect(await likeRows(other.id)).toEqual([]);

  await openLikesTab(page, me);
  // 一覧は元投稿のカード（リツイートの実行者は出さない）
  await expect(card(page, `同期する投稿 ${t}`)).toHaveCount(1);
  await expect(page.getByText(`${other.name}さんがリツイート`)).toHaveCount(0);
});

test('未ログインのクリックは書き込まず「ログイン中のみいいねできます」を3秒表示し、その場に留まる', async ({ page }) => {
  const author = await loginableUser('投稿者');
  const t = token();
  await post(author, `匿名で見る投稿 ${t}`);

  await page.goto('/');
  const target = card(page, `匿名で見る投稿 ${t}`);
  await likeButton(target).click();

  const toast = page.getByRole('alert').filter({ hasText: 'ログイン中のみいいねできます' });
  await expect(toast).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(likeButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeCount(target, 0)).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect(await sql`SELECT 1 FROM twitter.likes l JOIN twitter.tweets tw ON tw.id = l.tweet_id WHERE tw.owner_id = ${author.id}`).toHaveLength(0);

  // プロフィールの公開いいねタブからでも同じ（ログイン画面へ移動しない）
  await page.goto(`/profile/${author.displayId}`);
  await likeButton(card(page, `匿名で見る投稿 ${t}`)).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ログイン中のみいいねできます' })).toBeVisible();
  await expect(page).toHaveURL(`/profile/${author.displayId}`);
});

test('画面を表示した後に別の利用者へ切り替えると、どちらのいいねも変えない', async ({ page }) => {
  const a = await loginableUser('A');
  const b = await loginableUser('B');
  const t = token();
  const tweetId = await post(b, `Bの投稿 ${t}`);
  await fixtures.like(asPerson(b), tweetId, new Date().toISOString());

  await login(page, a);
  const target = card(page, `Bの投稿 ${t}`);
  await expect(likeButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeCount(target, 1)).toBeVisible();

  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b);
  await likeButton(target).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ログイン中の利用者が変わりました' })).toBeVisible();
  await expect(likeButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeCount(target, 1)).toBeVisible();
  expect(await likeRows(a.id)).toEqual([]);
  expect(await likeRows(b.id)).toEqual([tweetId]);
});

test('解除してからいいねし直すと、公開いいねタブの先頭に出る（投稿日時は変わらない）', async ({ page }) => {
  const me = await loginableUser('並べる人');
  const t = token();
  const a = await post(me, `投稿A ${t}`);
  const b = await post(me, `投稿B ${t}`);

  await login(page, me);
  await likeButton(card(page, `投稿A ${t}`)).click();
  await expect(unlikeButton(card(page, `投稿A ${t}`))).toBeVisible();
  await likeButton(card(page, `投稿B ${t}`)).click();
  await expect(unlikeButton(card(page, `投稿B ${t}`))).toBeVisible();
  await openLikesTab(page, me);
  expect((await listedTexts(page, t)).map((c) => (c.includes(`投稿A ${t}`) ? 'A' : 'B'))).toEqual(['B', 'A']);

  await unlikeButton(card(page, `投稿A ${t}`)).click();
  await expect(card(page, `投稿A ${t}`)).toHaveCount(0);
  await page.goto('/');
  await likeButton(card(page, `投稿A ${t}`)).click();
  await expect(unlikeButton(card(page, `投稿A ${t}`))).toBeVisible();
  await openLikesTab(page, me);
  expect((await listedTexts(page, t)).map((c) => (c.includes(`投稿A ${t}`) ? 'A' : 'B'))).toEqual(['A', 'B']);
  expect(await likeRows(me.id)).toEqual([a, b]);
  // ホームでは投稿日時の順のまま（いいねを新しい出来事として出さない）
  await page.goto('/');
  expect((await listedTexts(page, t)).map((c) => (c.includes(`投稿A ${t}`) ? 'A' : 'B'))).toEqual(['B', 'A']);
});

test('公開いいねタブは20件ずつ表示し、次の20件・戻る・進むで位置を保つ。最後の1件を解除しても先頭へ戻れる', async ({ page }) => {
  const me = await loginableUser('たくさんいいね');
  const t = token();
  const tweets = await fixtures.tweets(
    asPerson(me),
    Array.from({ length: 21 }, (_, i) => ({ content: `いいね${String(i).padStart(2, '0')}番 ${t}`, createdAt: new Date(Date.now() - 60_000 + i).toISOString() })),
  );
  // いいね00番が最も古く、いいね20番が最も新しい
  for (const [i, id] of tweets.entries()) await fixtures.like(asPerson(me), id, new Date(Date.now() + i).toISOString());

  await login(page, me);
  await openLikesTab(page, me);
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(card(page, `いいね20番 ${t}`)).toBeVisible();
  await expect(card(page, `いいね00番 ${t}`)).toHaveCount(0);
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/tab=likes&cursor=/);
  const second = page.url();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(card(page, `いいね00番 ${t}`)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`/profile/${me.displayId}?tab=likes`);
  await expect(card(page, `いいね20番 ${t}`)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(second);
  await expect(card(page, `いいね00番 ${t}`)).toBeVisible();

  await unlikeButton(card(page, `いいね00番 ${t}`)).click();
  await expect(card(page, `いいね00番 ${t}`)).toHaveCount(0);
  expect(page.url()).toBe(second);
  await page.getByRole('link', { name: '最新に戻る' }).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}?tab=likes`);
  await expect(page.getByRole('article')).toHaveCount(20);

  // 他のタブのカーソルを持ち込むと先頭へ戻す
  await page.goto(second.replace('tab=likes', 'tab=retweets'));
  await expect(page).toHaveURL(`/profile/${me.displayId}?tab=retweets`);
});

test('元投稿の編集は公開いいねタブに反映され、元投稿を削除すると一覧と件数から消える', async ({ page }) => {
  const me = await loginableUser('編集も見る人');
  const t = token();
  await post(me, `元の本文 ${t}`);

  await login(page, me);
  await likeButton(card(page, `元の本文 ${t}`)).click();
  await expect(unlikeButton(card(page, `元の本文 ${t}`))).toBeVisible();
  await openLikesTab(page, me);

  await card(page, `元の本文 ${t}`).getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: '編集する' }).click();
  const edit = page.getByRole('dialog', { name: 'ツイートを編集' });
  await edit.getByLabel('本文').fill(`編集後の本文 ${t}`);
  await edit.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  await expect(page).toHaveURL(`/profile/${me.displayId}?tab=likes`);
  const edited = card(page, `編集後の本文 ${t}`);
  await expect(edited).toBeVisible();
  // 編集してもいいねは維持する
  await expect(unlikeButton(edited)).toBeVisible();
  await expect(likeCount(edited, 1)).toBeVisible();

  await edited.getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: '削除する' }).click();
  await page.getByRole('dialog', { name: '本当に削除しますか？' }).getByRole('button', { name: 'はい' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを削除しました' })).toBeVisible();
  await expect(card(page, `編集後の本文 ${t}`)).toHaveCount(0);
  await expect(page.getByText('いいねした投稿はまだありません')).toBeVisible();
  expect(await likeRows(me.id)).toEqual([]);
});

test('お気に入りの追加・解除では公開いいねの件数・一覧が変わらず、いいねでは本人用の保存一覧が変わらない', async ({ page }) => {
  const me = await loginableUser('区別する人');
  const author = await loginableUser('作者');
  const t = token();
  const tweetId = await post(author, `区別する投稿 ${t}`);

  await login(page, me);
  const target = card(page, `区別する投稿 ${t}`);
  await addFavorite(target).click();
  await expect(removeFavorite(target)).toBeVisible();
  await expect(likeButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(likeCount(target, 0)).toBeVisible();
  expect(await likeRows(me.id)).toEqual([]);
  await openLikesTab(page, me);
  await expect(card(page, `区別する投稿 ${t}`)).toHaveCount(0);

  await page.goto('/favorites');
  await removeFavorite(card(page, `区別する投稿 ${t}`)).click();
  await expect(card(page, `区別する投稿 ${t}`)).toHaveCount(0);
  await page.goto('/');
  await likeButton(target).click();
  await expect(unlikeButton(target)).toBeVisible();
  await expect(addFavorite(target)).toHaveAttribute('aria-pressed', 'false');
  await page.goto('/favorites');
  await expect(card(page, `区別する投稿 ${t}`)).toHaveCount(0);
  expect(await sql`SELECT 1 FROM twitter.favorites WHERE user_id = ${me.id}`).toHaveLength(0);
  expect(await likeRows(me.id)).toEqual([tweetId]);

  // 公開いいねタブでは、対象者のお気に入り状態を他人へ見せない
  await fixtures.favorite(asPerson(me), tweetId, new Date().toISOString());
  await page.context().clearCookies();
  await page.goto(`/profile/${me.displayId}?tab=likes`);
  await expect(addFavorite(card(page, `区別する投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
});

test('幅375pxで3つのタブとカード操作に横スクロールが出ず、キーボードでいいね・解除でき、処理中は連打できない', async ({ page }) => {
  const me = await loginableUser('キーボード');
  const t = token();
  const tweetId = await post(me, `キーボードでいいね ${t}`);

  await login(page, me);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // いいねの応答を遅らせ、処理中は押せないことを確かめる
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    return route.continue();
  });
  const button = likeButton(card(page, `キーボードでいいね ${t}`));
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(anyLikeButton(card(page, `キーボードでいいね ${t}`))).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(unlikeButton(card(page, `キーボードでいいね ${t}`))).toBeEnabled();
  expect(await likeRows(me.id)).toEqual([tweetId]);

  await openLikesTab(page, me);
  for (const name of ['ツイート', 'リツイート', 'いいね']) await expect(tabLink(page, name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await unlikeButton(card(page, `キーボードでいいね ${t}`)).focus();
  await page.keyboard.press('Space');
  await expect(card(page, `キーボードでいいね ${t}`)).toHaveCount(0);
  expect(await likeRows(me.id)).toEqual([]);
});
