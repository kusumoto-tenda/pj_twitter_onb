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
    { name, displayId: uniqueDisplayId('Et'), bio: '', password: PASSWORD },
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
const editDialog = (page: Page) => page.getByRole('dialog', { name: 'ツイートを編集' });
const updateButton = (d: Locator) => d.getByRole('button', { name: '更新', exact: true });

async function openEdit(page: Page, cardLocator: Locator) {
  await cardLocator.getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: '編集する' }).click();
  await expect(editDialog(page)).toBeVisible();
  return editDialog(page);
}

async function naturalWidths(locator: Locator) {
  return locator.getByRole('img').evaluateAll((els) => els.map((el) => (el as HTMLImageElement).naturalWidth));
}

async function tweet(id: string) {
  const [row] = await sql`SELECT content, created_at, updated_at, revision::text AS revision FROM twitter.tweets WHERE id = ${id}`;
  return row;
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

test('自分の投稿の本文を編集すると、初期値から更新して3秒通知し、日時順の位置は変わらない', async ({ page }) => {
  const me = await loginableUser('編集する人');
  const t = token();
  const older = await post(me, `古い投稿 ${t}`);
  await post(me, `新しい投稿 ${t}`);

  await login(page, me);
  const d = await openEdit(page, card(page, `古い投稿 ${t}`));
  await expect(d.getByLabel('本文')).toBeFocused();
  await expect(d.getByLabel('本文')).toHaveValue(`古い投稿 ${t}`);
  await d.getByLabel('本文').fill(`編集後の投稿 ${t}\n二行目`);
  await updateButton(d).click();

  const toast = page.getByRole('status').filter({ hasText: 'ツイートを更新しました' });
  await expect(toast).toBeVisible();
  await expect(editDialog(page)).toBeHidden();
  await expect(page).toHaveURL('/');
  await expect(card(page, `編集後の投稿 ${t}`)).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 4_000 });
  const contents = await page.getByRole('article').allTextContents();
  const order = contents.flatMap((c) => (c.includes(`新しい投稿 ${t}`) ? ['new'] : c.includes(`編集後の投稿 ${t}`) ? ['edited'] : []));
  expect(order).toEqual(['new', 'edited']);
  expect(await tweet(older)).toMatchObject({ content: `編集後の投稿 ${t}\n二行目`, revision: '1' });

  await page.reload();
  await expect(card(page, `編集後の投稿 ${t}`)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toHaveCount(0);
});

test('プロフィール・リツイートのカードからも本人だけが編集でき、元投稿を参照するカードに反映される', async ({ page }) => {
  const me = await loginableUser('元投稿者');
  const other = await loginableUser('他人');
  const t = token();
  const mine = await post(me, `自分の投稿 ${t}`);
  const theirs = await post(other, `他人の投稿 ${t}`);
  await fixtures.retweet({ id: other.id, name: other.name, displayId: other.displayId }, mine, new Date(Date.now() + 60_000).toISOString());
  await fixtures.retweet({ id: me.id, name: me.name, displayId: me.displayId }, theirs, new Date(Date.now() + 120_000).toISOString());

  await login(page, me);
  // 自分がリツイートした他人の投稿には操作を出さない
  await expect(card(page, `他人の投稿 ${t}`).first().getByRole('button', { name: 'ツイートの操作' })).toHaveCount(0);
  // 他人がリツイートした自分の投稿は編集できる
  const d = await openEdit(page, card(page, '他人さんがリツイート').filter({ hasText: `自分の投稿 ${t}` }));
  await d.getByLabel('本文').fill(`リツイート元を編集 ${t}`);
  await updateButton(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  await expect(card(page, `リツイート元を編集 ${t}`)).toHaveCount(2);

  await page.goto(`/profile/${me.displayId}`);
  const d2 = await openEdit(page, card(page, `リツイート元を編集 ${t}`));
  await d2.getByLabel('本文').fill(`プロフィールから編集 ${t}`);
  await updateButton(d2).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  await expect(card(page, `プロフィールから編集 ${t}`)).toBeVisible();
  await page.goto(`/profile/${other.displayId}?tab=retweets`);
  await expect(card(page, `プロフィールから編集 ${t}`)).toBeVisible();
});

test('既存画像の保持・解除と新規追加で合計4枚を守り、保持画像のURLは同じ、解除画像は404、新規は配信される', async ({ page }) => {
  const me = await loginableUser('画像を編集');
  const t = token();
  const tweetId = await post(me, `画像の投稿 ${t}`, [10, 20, 30]);

  await login(page, me);
  await expect(card(page, `画像の投稿 ${t}`).getByRole('img')).toHaveCount(3);
  const before = await card(page, `画像の投稿 ${t}`).getByRole('img').evaluateAll((els) => els.map((el) => el.getAttribute('src')));
  const d = await openEdit(page, card(page, `画像の投稿 ${t}`));
  await expect.poll(() => naturalWidths(d)).toEqual([10, 20, 30]);
  await d.getByRole('button', { name: '添付済みの画像1を解除' }).click();
  await d.getByLabel('画像を追加').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: await png(40) },
    { name: 'b.png', mimeType: 'image/png', buffer: await png(50) },
  ]);
  await expect(d.getByText('アップロード中')).toHaveCount(0, { timeout: 60_000 });
  await expect(d.getByText('確認中')).toHaveCount(0, { timeout: 60_000 });
  await expect(d.getByLabel('画像を追加')).toBeDisabled();
  await updateButton(d).click();

  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  const after = card(page, `画像の投稿 ${t}`);
  await expect.poll(() => naturalWidths(after)).toEqual([20, 30, 40, 50]);
  const srcs = await after.getByRole('img').evaluateAll((els) => els.map((el) => el.getAttribute('src')));
  expect(srcs.slice(0, 2)).toEqual(before.slice(1, 3));
  expect((await page.request.get(before[0]!)).status()).toBe(404);
  expect((await page.request.get(srcs[3]!)).status()).toBe(200);
  expect(await tweet(tweetId)).toMatchObject({ revision: '1' });
});

test('閉じる・Escでは本文も画像も変えず、新規画像だけを破棄する', async ({ page }) => {
  const me = await loginableUser('キャンセル');
  const t = token();
  const tweetId = await post(me, `変えない投稿 ${t}`, [10]);
  const before = await tweet(tweetId);

  await login(page, me);
  let d = await openEdit(page, card(page, `変えない投稿 ${t}`));
  await d.getByLabel('本文').fill('変えたつもり');
  await d.getByRole('button', { name: '添付済みの画像1を解除' }).click();
  await d.getByLabel('画像を追加').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: await png(40) }]);
  await expect(d.getByText('アップロード中')).toHaveCount(0, { timeout: 60_000 });
  await d.getByRole('button', { name: '閉じる' }).click();
  await expect(editDialog(page)).toBeHidden();
  await expect(card(page, `変えない投稿 ${t}`).getByRole('button', { name: 'ツイートの操作' })).toBeFocused();

  d = await openEdit(page, card(page, `変えない投稿 ${t}`));
  await expect(d.getByLabel('本文')).toHaveValue(`変えない投稿 ${t}`);
  await expect.poll(() => naturalWidths(d)).toEqual([10]);
  await page.keyboard.press('Escape');
  await expect(editDialog(page)).toBeHidden();

  expect(await tweet(tweetId)).toEqual(before);
  await expect
    .poll(async () => (await sql`
      SELECT DISTINCT u.status FROM twitter.media_uploads u JOIN twitter.tweet_drafts d ON d.id = u.draft_id
      WHERE d.owner_id = ${me.id} AND d.purpose = 'edit'
    `).map((r) => r.status))
    .toEqual(['discarded']);
});

test('入力違反は欄エラーと失敗通知で入力を保ち、直して再送できる', async ({ page }) => {
  const me = await loginableUser('入力違反');
  const t = token();
  const tweetId = await post(me, `直す投稿 ${t}`);

  await login(page, me);
  const d = await openEdit(page, card(page, `直す投稿 ${t}`));
  await d.getByLabel('本文').fill('あ'.repeat(281));
  await updateButton(d).click();
  await expect(d.getByText('本文は280文字以下で入力してください')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'ツイートの更新に失敗しました' })).toBeVisible();
  await expect(d.getByLabel('本文')).toHaveValue('あ'.repeat(281));
  expect(await tweet(tweetId)).toMatchObject({ revision: '0' });

  await d.getByLabel('本文').fill(`直した投稿 ${t}`);
  await updateButton(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  expect(await tweet(tweetId)).toMatchObject({ content: `直した投稿 ${t}`, revision: '1' });
});

test('2つのタブで開いて先に保存すると、後の保存は上書きせず競合を表示する', async ({ page }) => {
  const me = await loginableUser('競合');
  const t = token();
  const tweetId = await post(me, `競合する投稿 ${t}`);
  await login(page, me);
  const second = await page.context().newPage();
  await second.goto('/');

  const a = await openEdit(page, card(page, `競合する投稿 ${t}`));
  const b = await openEdit(second, card(second, `競合する投稿 ${t}`));
  await a.getByLabel('本文').fill(`先の保存 ${t}`);
  await updateButton(a).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();

  await b.getByLabel('本文').fill(`後の保存 ${t}`);
  await updateButton(b).click();
  await expect(b.getByText('他の画面で更新されています。閉じて開き直してください')).toBeVisible();
  await expect(b.getByLabel('本文')).toHaveValue(`後の保存 ${t}`);
  expect(await tweet(tweetId)).toMatchObject({ content: `先の保存 ${t}`, revision: '1' });
});

test('Aで開いてBにログインし直して保存しても、誰の投稿も変わらない', async ({ page }) => {
  const a = await loginableUser('A');
  const b = await loginableUser('B');
  const t = token();
  const tweetId = await post(a, `Aの投稿 ${t}`);
  const bTweet = await post(b, `Bの投稿 ${t}`);
  await login(page, a);
  const d = await openEdit(page, card(page, `Aの投稿 ${t}`));
  await d.getByLabel('本文').fill('乗っ取り');

  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b);
  await updateButton(d).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ツイートの更新に失敗しました' })).toBeVisible();
  expect(await tweet(tweetId)).toMatchObject({ content: `Aの投稿 ${t}`, revision: '0' });
  expect(await tweet(bTweet)).toMatchObject({ content: `Bの投稿 ${t}`, revision: '0' });
});

test('フォロー条件・ページ位置・プロフィールのタブを保ったまま更新し、戻る・進むでも更新前に戻らない', async ({ page }) => {
  const me = await loginableUser('位置を保つ');
  const other = await loginableUser('リツイートする人');
  const t = token();
  // 2ページ目に編集対象が来るよう、新しい投稿を20件以上作る
  const target = await post(me, `2ページ目の投稿 ${t}`);
  const fillers = (prefix: string) =>
    Array.from({ length: 21 }, (_, i) => ({ content: `${prefix}${i} ${t}`, createdAt: new Date(Date.now() + 60_000 + i).toISOString() }));
  // プロフィールのページ送り用の自分の投稿
  await fixtures.tweets(me, fillers('埋め'));
  // フォローのみには自分の投稿が出ないので、フォロー中の人のリツイートとして編集対象を出す
  await fixtures.follow(me, other);
  await fixtures.retweet(other, target, new Date(Date.now() + 1_000).toISOString());
  await fixtures.tweets(other, fillers('他人の埋め'));

  await login(page, me);
  // スクロールできる高さにして、スクロール位置が保たれることを確かめる
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto('/?follow=true');
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/follow=true.*cursor=|cursor=.*follow=true/);
  const url = page.url();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);
  const d = await openEdit(page, card(page, `2ページ目の投稿 ${t}`));
  await d.getByLabel('本文').fill(`2ページ目で編集 ${t}`);
  await updateButton(d).click();

  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(card(page, `2ページ目で編集 ${t}`)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore / 2);

  await page.goBack();
  await page.goForward();
  await expect(card(page, `2ページ目で編集 ${t}`)).toBeVisible();
  await expect(card(page, `2ページ目の投稿 ${t}`)).toHaveCount(0);

  await page.goto(`/profile/${me.displayId}`);
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/\/profile\/.+\?cursor=/);
  const profileUrl = page.url();
  const d2 = await openEdit(page, card(page, `2ページ目で編集 ${t}`));
  await d2.getByLabel('本文').fill(`プロフィール2ページ目 ${t}`);
  await updateButton(d2).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  expect(page.url()).toBe(profileUrl);
  expect(await tweet(target)).toMatchObject({ content: `プロフィール2ページ目 ${t}` });
});

test('幅375pxで横スクロールせず、Enterは改行、保存中は閉じられず、フォーカスはダイアログ内を循環する', async ({ page }) => {
  const me = await loginableUser('操作');
  const t = token();
  await post(me, `操作する投稿 ${t}`);

  await login(page, me);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  const menuButton = card(page, `操作する投稿 ${t}`).getByRole('button', { name: 'ツイートの操作' });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const d = editDialog(page);
  await expect(d).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await d.boundingBox())!.width).toBeLessThanOrEqual(375);

  await d.getByLabel('本文').press('End');
  await d.getByLabel('本文').press('Enter');
  await d.getByLabel('本文').pressSequentially('改行後');
  await expect(d.getByLabel('本文')).toHaveValue(`操作する投稿 ${t}\n改行後`);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }

  // 保存の応答を遅らせ、保存中は閉じられないことを確かめる
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action'] && route.request().postData()?.includes('改行後')) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    return route.continue();
  });
  await updateButton(d).click();
  await expect(d.getByRole('button', { name: '更新中…' })).toBeDisabled();
  await expect(d.getByRole('button', { name: '閉じる' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを更新しました' })).toBeVisible();
  await expect(menuButton).toBeFocused();
});

test('未ログインのまま開いていた編集を保存すると、ログイン画面で案内する', async ({ page }) => {
  const me = await loginableUser('セッション切れ');
  const t = token();
  await post(me, `切れる投稿 ${t}`);
  await login(page, me);
  const d = await openEdit(page, card(page, `切れる投稿 ${t}`));
  await page.context().clearCookies();

  await d.getByLabel('本文').fill('保存できない');
  await updateButton(d).click();

  await expect(page).toHaveURL('/login');
  await expect(editDialog(page)).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートを編集するにはログインしてください' })).toBeVisible();
  await expect(page.getByLabel('ユーザーID')).toBeEditable();
});
