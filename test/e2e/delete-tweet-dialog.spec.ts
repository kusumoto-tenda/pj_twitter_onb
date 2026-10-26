import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
    { name, displayId: uniqueDisplayId('Dt'), bio: '', password: PASSWORD },
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
const deleteDialog = (page: Page) => page.getByRole('dialog', { name: '本当に削除しますか？' });
const yes = (d: Locator) => d.getByRole('button', { name: 'はい', exact: true });
const no = (d: Locator) => d.getByRole('button', { name: 'いいえ', exact: true });
const deletedToast = (page: Page) => page.getByRole('status').filter({ hasText: 'ツイートを削除しました' });

async function openDelete(page: Page, cardLocator: Locator) {
  await cardLocator.getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: '削除する' }).click();
  await expect(deleteDialog(page)).toBeVisible();
  return deleteDialog(page);
}

async function exists(table: 'tweets' | 'retweets' | 'images', column: string, id: string) {
  const rows = await sql`SELECT 1 FROM ${sql('twitter.' + table)} WHERE ${sql(column)} = ${id}`;
  return rows.length > 0;
}

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

test('本人のメニューから確認して削除すると、画像とリツイートも消え、現在のURLのまま3秒通知する', async ({ page }) => {
  const me = await loginableUser('削除する人');
  const other = await loginableUser('リツイートした人');
  const t = token();
  const tweetId = await post(me, `消す投稿 ${t}`, [10, 20]);
  await post(me, `残す投稿 ${t}`);
  await fixtures.retweet({ id: other.id, name: other.name, displayId: other.displayId }, tweetId, new Date(Date.now() + 60_000).toISOString());
  await fixtures.follow({ id: me.id, name: me.name, displayId: me.displayId }, { id: other.id, name: other.name, displayId: other.displayId });

  await login(page, me);
  await expect(card(page, `消す投稿 ${t}`)).toHaveCount(2);
  const srcs = await card(page, `消す投稿 ${t}`).first().getByRole('img').evaluateAll((els) => els.map((el) => el.getAttribute('src')));
  expect(srcs).toHaveLength(2);

  // 「いいえ」・Escでは何も変えない。初期フォーカスは「いいえ」
  let d = await openDelete(page, card(page, `消す投稿 ${t}`).first());
  await expect(d.getByText('投稿・添付画像・この投稿へのリツイートは元に戻せません')).toBeVisible();
  await expect(no(d)).toBeFocused();
  await no(d).click();
  await expect(deleteDialog(page)).toBeHidden();
  await expect(card(page, `消す投稿 ${t}`).first().getByRole('button', { name: 'ツイートの操作' })).toBeFocused();
  d = await openDelete(page, card(page, `消す投稿 ${t}`).first());
  await page.keyboard.press('Escape');
  await expect(deleteDialog(page)).toBeHidden();
  // 背景をクリックしても閉じない
  d = await openDelete(page, card(page, `消す投稿 ${t}`).first());
  await page.mouse.click(5, 5);
  await expect(d).toBeVisible();
  expect(await exists('tweets', 'id', tweetId)).toBe(true);

  await page.goto('/?follow=true');
  d = await openDelete(page, card(page, `${other.name}さんがリツイート`).filter({ hasText: `消す投稿 ${t}` }));
  await yes(d).click();

  await expect(deletedToast(page)).toBeVisible();
  await expect(deleteDialog(page)).toBeHidden();
  await expect(page).toHaveURL('/?follow=true');
  await expect(card(page, `消す投稿 ${t}`)).toHaveCount(0);
  await expect(card(page, `残す投稿 ${t}`)).toBeVisible();
  await expect(deletedToast(page)).toBeHidden({ timeout: 4_000 });
  expect(await exists('tweets', 'id', tweetId)).toBe(false);
  expect(await exists('retweets', 'tweet_id', tweetId)).toBe(false);
  expect(await exists('images', 'tweet_id', tweetId)).toBe(false);
  for (const src of srcs) expect((await page.request.get(src!)).status()).toBe(404);

  await page.goto(`/profile/${other.displayId}?tab=retweets`);
  await expect(card(page, `消す投稿 ${t}`)).toHaveCount(0);
  await page.reload();
  await expect(deletedToast(page)).toHaveCount(0);
});

test('他人の投稿や、自分がリツイートしただけの投稿には削除の導線を出さない', async ({ page }) => {
  const me = await loginableUser('見る人');
  const other = await loginableUser('他人');
  const t = token();
  const theirs = await post(other, `他人の投稿 ${t}`);
  await fixtures.retweet({ id: me.id, name: me.name, displayId: me.displayId }, theirs, new Date(Date.now() + 60_000).toISOString());

  await login(page, me);
  await expect(card(page, `他人の投稿 ${t}`).first()).toBeVisible();
  await expect(card(page, `他人の投稿 ${t}`).getByRole('button', { name: 'ツイートの操作' })).toHaveCount(0);
  await page.goto(`/profile/${other.displayId}`);
  await expect(card(page, `他人の投稿 ${t}`)).toBeVisible();
  await expect(card(page, `他人の投稿 ${t}`).getByRole('button', { name: 'ツイートの操作' })).toHaveCount(0);
});

test('Aで開いてBにログインし直して「はい」を押しても、A・Bどちらの投稿も削除しない', async ({ page }) => {
  const a = await loginableUser('A');
  const b = await loginableUser('B');
  const t = token();
  const aTweet = await post(a, `Aの投稿 ${t}`);
  const bTweet = await post(b, `Bの投稿 ${t}`);
  await login(page, a);
  const d = await openDelete(page, card(page, `Aの投稿 ${t}`));

  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b);
  await yes(d).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ツイートの削除に失敗しました' })).toBeVisible();
  await expect(d.getByText('ログイン中の利用者が変わりました。画面を開き直してください')).toBeVisible();
  expect(await exists('tweets', 'id', aTweet)).toBe(true);
  expect(await exists('tweets', 'id', bTweet)).toBe(true);
});

test('2つのタブで開いて先に削除すると、後のタブは既に削除されている旨を通知して閉じ、一覧を更新する', async ({ page }) => {
  const me = await loginableUser('同時削除');
  const t = token();
  const tweetId = await post(me, `同時に消す投稿 ${t}`);
  await login(page, me);
  const second = await page.context().newPage();
  await second.goto('/');

  const a = await openDelete(page, card(page, `同時に消す投稿 ${t}`));
  const b = await openDelete(second, card(second, `同時に消す投稿 ${t}`));
  await yes(a).click();
  await expect(deletedToast(page)).toBeVisible();

  await yes(b).click();
  await expect(second.getByRole('status').filter({ hasText: 'このツイートは既に削除されています' })).toBeVisible();
  await expect(deleteDialog(second)).toBeHidden();
  await expect(card(second, `同時に消す投稿 ${t}`)).toHaveCount(0);
  await expect(deletedToast(second)).toHaveCount(0);
  expect(await exists('tweets', 'id', tweetId)).toBe(false);
});

test('幅375pxでキーボードだけで操作でき、削除中は全操作をロックし、最後の投稿を消すと空の一覧になる', async ({ page }) => {
  const me = await loginableUser('キーボード');
  const t = token();
  await post(me, `最後の投稿 ${t}`);

  await login(page, me);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`/profile/${me.displayId}`);
  const menuButton = card(page, `最後の投稿 ${t}`).getByRole('button', { name: 'ツイートの操作' });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: '編集する' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '削除する' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '編集する' })).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const d = deleteDialog(page);
  await expect(d).toBeVisible();
  await expect(no(d)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await d.boundingBox())!.width).toBeLessThanOrEqual(375);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }

  // 削除の応答を遅らせ、処理中は閉じられないことを確かめる
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    return route.continue();
  });
  await yes(d).focus();
  await page.keyboard.press('Enter');
  await expect(d.getByRole('button', { name: '削除中…' })).toBeDisabled();
  await expect(no(d)).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(d).toBeVisible();

  await expect(deletedToast(page)).toBeVisible();
  await expect(deleteDialog(page)).toBeHidden();
  await expect(page.getByText('まだ投稿がありません')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
});

test('未ログインのまま開いていた確認で「はい」を押すと、削除せずログイン画面で案内する', async ({ page }) => {
  const me = await loginableUser('セッション切れ');
  const t = token();
  const tweetId = await post(me, `切れる投稿 ${t}`);
  await login(page, me);
  const d = await openDelete(page, card(page, `切れる投稿 ${t}`));
  await page.context().clearCookies();

  await yes(d).click();

  await expect(page).toHaveURL('/login');
  await expect(deleteDialog(page)).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを削除するにはログインしてください' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを削除しました' })).toHaveCount(0);
  expect(await exists('tweets', 'id', tweetId)).toBe(true);
});
