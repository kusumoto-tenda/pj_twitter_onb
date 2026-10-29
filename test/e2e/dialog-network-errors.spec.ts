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

// マイグレーションは global setup で適用済み。画像はテスト専用ストアだけを使う。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const storage = new VercelBlobStorage(requireTestBlobEnvironment(process.env).token);
const PASSWORD = 'password123';
const NETWORK_TOAST = '通信に失敗しました。もう一度お試しください';
const UNCONFIRMED = '通信に失敗し、処理結果を確認できませんでした。入力を変更せず、もう一度お試しください';
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
    { name, displayId: uniqueDisplayId('Ne'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  tracked.push(id);
  return { id, name, displayId };
}

/** 小さい有効なPNG（幅で見分ける）。 */
async function png(width: number) {
  const buffer = await sharp({ create: { width, height: 10, channels: 3, background: '#3377bb' } }).png().toBuffer();
  return { name: `image-${width}.png`, mimeType: 'image/png', buffer };
}

/** 実際のアップロード経路（予約→テスト用ストアへ直接→検証→確定）で、画像付きの投稿を作る。 */
async function post(owner: TimelinePerson, content: string, widths: number[] = []) {
  const d = deps();
  const draft = await beginTweetDraft(d, { actorId: owner.id });
  if (!draft.ok) throw new Error(draft.code);
  const uploadIds = [];
  for (const width of widths) {
    const { buffer } = await png(width);
    const reserved = await reserveImageUpload(d, { actorId: owner.id, draftId: draft.draftId, contentType: 'image/png', size: buffer.byteLength });
    if (!reserved.ok) throw new Error(reserved.code);
    await put(reserved.pathname, buffer, { access: 'private', token: reserved.token, contentType: 'image/png' });
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

const launcher = (page: Page) =>
  page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('button', { name: 'ツイートする' });
const createDialog = (page: Page) => page.getByRole('dialog', { name: 'ツイートを作成' });
const editDialog = (page: Page) => page.getByRole('dialog', { name: 'ツイートを編集' });
const deleteDialog = (page: Page) => page.getByRole('dialog', { name: '本当に削除しますか？' });
const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const alertToast = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

async function openMenu(page: Page, cardLocator: Locator, item: '編集する' | '削除する') {
  await cardLocator.getByRole('button', { name: 'ツイートの操作' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** 画像を選び、すべてのアップロードと検証が終わるまで待つ。 */
async function attach(d: Locator, files: Awaited<ReturnType<typeof png>>[]) {
  await d.getByLabel('画像を追加').setInputFiles(files);
  await expect(d.getByText('アップロード中')).toHaveCount(0, { timeout: 60_000 });
  await expect(d.getByText('確認中')).toHaveCount(0, { timeout: 60_000 });
}

async function naturalWidths(locator: Locator) {
  return locator.getByRole('img').evaluateAll((els) => els.map((el) => (el as HTMLImageElement).naturalWidth));
}

/**
 * 対象のダイアログを開いた後に呼ぶ。markerを含むServer ActionのPOSTを1回だけ、サーバーへ送る前に切断する。
 * 画像のアップロード（Route Handler）・RSCのGET・再試行のPOSTは止めない。
 */
async function abortNextActionBeforeSend(page: Page, marker: string) {
  const state = { failed: 0 };
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (state.failed === 0 && request.method() === 'POST' && request.headers()['next-action'] && request.postData()?.includes(marker)) {
      state.failed += 1;
      return route.abort('failed');
    }
    return route.continue();
  });
  return state;
}

/**
 * markerを含むServer ActionのPOSTを1回だけ、実際にサーバーへ送って応答を受け取ってから、ブラウザへは渡さずに切断する。
 * （サーバーでは確定したが応答だけを失った状態。重複リクエストを自前で送り直すことはしない。）
 */
async function dropNextActionResponseAfterCommit(page: Page, marker: string) {
  const state: { response: null | { ok: boolean; status: number; redirect: string | undefined } } = { response: null };
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (state.response === null && request.method() === 'POST' && request.headers()['next-action'] && request.postData()?.includes(marker)) {
      const response = await route.fetch({ maxRedirects: 0 });
      state.response = { ok: response.ok(), status: response.status(), redirect: response.headers()['x-action-redirect'] };
      return route.abort('failed');
    }
    return route.continue();
  });
  return state;
}

/**
 * アプリの画面がエラー境界へ置き換わっていないことを確かめるため、ページ内の未処理例外とconsoleのエラーを記録する。
 * 意図した切断と、共有タイムライン上の古い画像の404はブラウザのリソースエラーとして区別する。
 * 対象投稿の画像はnaturalWidthを別途検証する。pageerror・アプリのconsole.error・画像の500等は除外しない。
 */
function watchPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/^Failed to load resource: net::ERR_FAILED/.test(text)) return;
    if (
      text === 'Failed to load resource: the server responded with a status of 404 (Not Found)' &&
      /\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.location().url)
    ) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function tweetsOf(user: TimelinePerson) {
  return sql<{ id: string; content: string }[]>`SELECT id, content FROM twitter.tweets WHERE owner_id = ${user.id}`;
}

async function tweetRow(id: string) {
  const [row] = await sql`SELECT content, revision::text AS revision FROM twitter.tweets WHERE id = ${id}`;
  return row;
}

async function imagesOf(tweetId: string) {
  return sql<{ upload_id: string; width: number }[]>`
    SELECT upload_id, width FROM twitter.images WHERE tweet_id = ${tweetId} ORDER BY position
  `;
}

async function uploadsOf(draftId: string) {
  return sql<{ id: string; status: string }[]>`SELECT id, status FROM twitter.media_uploads WHERE draft_id = ${draftId} ORDER BY created_at`;
}

async function deleteJobsFor(storageKeys: string[]) {
  return sql<{ storage_key: string }[]>`SELECT storage_key FROM twitter.media_delete_jobs WHERE storage_key = ANY(${storageKeys})`;
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
});

test.afterAll(async () => {
  await sql.end();
});

test('作成：送信前に通信が切れても、本文と準備済みの画像を保ち、同じ下書きで再試行して投稿できる', async ({ page }) => {
  const me = await loginableUser('作成の通信失敗');
  const errors = watchPageErrors(page);
  const content = `通信失敗後に投稿 ${token()}`;

  await login(page, me);
  await launcher(page).click();
  const d = createDialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel('本文').fill(content);
  await attach(d, [await png(30)]);
  const failure = await abortNextActionBeforeSend(page, content);
  await d.getByRole('button', { name: 'ツイートする' }).click();

  await expect(alertToast(page, NETWORK_TOAST)).toBeVisible();
  await expect(d.getByText(UNCONFIRMED)).toBeVisible();
  expect(failure.failed).toBe(1);
  await expect(d).toBeVisible();
  await expect(d.getByLabel('本文')).toHaveValue(content);
  await expect.poll(() => naturalWidths(d)).toEqual([30]);
  await expect(d.getByRole('button', { name: '閉じる' })).toBeEnabled();
  expect(await tweetsOf(me)).toEqual([]);
  const [draft] = await sql`SELECT id, status FROM twitter.tweet_drafts WHERE owner_id = ${me.id}`;
  expect(draft.status).toBe('open');

  await d.getByRole('button', { name: 'ツイートする' }).click();

  await expect(page).toHaveURL('/');
  await expect(toast(page, 'ツイートしました')).toBeVisible();
  await expect(createDialog(page)).toBeHidden();
  const tweets = await tweetsOf(me);
  // 下書きのUUIDがそのまま投稿のUUIDになる（新しい下書きを作り直していない）。
  expect(tweets).toEqual([{ id: draft.id, content }]);
  expect((await imagesOf(draft.id)).map((i) => i.width)).toEqual([30]);
  await expect.poll(() => naturalWidths(card(page, content))).toEqual([30]);
  expect(errors).toEqual([]);
});

test('編集：送信前に通信が切れても、元の投稿は変えず、編集内容と保持・新規画像を保って更新できる', async ({ page }) => {
  const me = await loginableUser('編集の通信失敗');
  const errors = watchPageErrors(page);
  const t = token();
  const tweetId = await post(me, `編集前 ${t}`, [10, 20]);
  const before = await imagesOf(tweetId);

  await login(page, me);
  await openMenu(page, card(page, `編集前 ${t}`), '編集する');
  const d = editDialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel('本文').fill(`編集後 ${t}`);
  await d.getByRole('button', { name: '添付済みの画像1を解除' }).click();
  await attach(d, [await png(40)]);
  await abortNextActionBeforeSend(page, `編集後 ${t}`);
  await d.getByRole('button', { name: '更新', exact: true }).click();

  await expect(alertToast(page, NETWORK_TOAST)).toBeVisible();
  await expect(d.getByText(UNCONFIRMED)).toBeVisible();
  await expect(d).toBeVisible();
  await expect(d.getByLabel('本文')).toHaveValue(`編集後 ${t}`);
  await expect.poll(() => naturalWidths(d)).toEqual([20, 40]);
  await expect(toast(page, 'ツイートを更新しました')).toHaveCount(0);
  expect(await tweetRow(tweetId)).toMatchObject({ content: `編集前 ${t}`, revision: '0' });
  expect(await imagesOf(tweetId)).toEqual(before);

  await d.getByRole('button', { name: '更新', exact: true }).click();

  await expect(toast(page, 'ツイートを更新しました')).toBeVisible();
  await expect(editDialog(page)).toBeHidden();
  await expect(page).toHaveURL('/');
  expect(await tweetRow(tweetId)).toMatchObject({ content: `編集後 ${t}`, revision: '1' });
  expect((await imagesOf(tweetId)).map((i) => i.width)).toEqual([20, 40]);
  await expect.poll(() => naturalWidths(card(page, `編集後 ${t}`))).toEqual([20, 40]);
  expect(errors).toEqual([]);
});

test('削除：送信前に通信が切れても、元の投稿と画像を残し、確認を開いたまま再試行できる', async ({ page }) => {
  const me = await loginableUser('削除の通信失敗');
  const errors = watchPageErrors(page);
  const t = token();
  const tweetId = await post(me, `削除する投稿 ${t}`, [10]);

  await login(page, me);
  await openMenu(page, card(page, `削除する投稿 ${t}`), '削除する');
  await expect.poll(() => naturalWidths(card(page, `削除する投稿 ${t}`))).toEqual([10]);
  const d = deleteDialog(page);
  await expect(d).toBeVisible();
  await abortNextActionBeforeSend(page, tweetId);
  await d.getByRole('button', { name: 'はい', exact: true }).click();

  await expect(alertToast(page, NETWORK_TOAST)).toBeVisible();
  await expect(d.getByText(UNCONFIRMED)).toBeVisible();
  await expect(d).toBeVisible();
  await expect(d.getByText(`削除する投稿 ${t}`)).toBeVisible();
  await expect(d.getByRole('button', { name: 'いいえ', exact: true })).toBeEnabled();
  await expect(toast(page, 'ツイートを削除しました')).toHaveCount(0);
  expect(await tweetRow(tweetId)).toBeDefined();
  expect(await imagesOf(tweetId)).toHaveLength(1);

  await d.getByRole('button', { name: 'はい', exact: true }).click();

  await expect(toast(page, 'ツイートを削除しました')).toBeVisible();
  await expect(deleteDialog(page)).toBeHidden();
  await expect(card(page, `削除する投稿 ${t}`)).toHaveCount(0);
  expect(await tweetRow(tweetId)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('作成：確定後に応答だけ失っても、同じ下書きの再送で投稿は1件・画像も重複せず、/へ移動して投稿を通知する', async ({ page }) => {
  const me = await loginableUser('作成の応答喪失');
  const errors = watchPageErrors(page);
  const content = `応答を失った投稿 ${token()}`;

  await login(page, me);
  await launcher(page).click();
  const d = createDialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel('本文').fill(content);
  await attach(d, [await png(30)]);
  const lost = await dropNextActionResponseAfterCommit(page, content);
  await d.getByRole('button', { name: 'ツイートする' }).click();

  await expect(d.getByText(UNCONFIRMED)).toBeVisible();
  await expect(alertToast(page, NETWORK_TOAST)).toBeVisible();
  // サーバーでは確定済み（/への移動を返した）で、ブラウザだけが応答を受け取れなかった。
  expect(lost.response).toMatchObject({ redirect: expect.stringMatching(/^\/(;|$)/) });
  expect(lost.response!.status).toBeLessThan(400);
  const [draft] = await sql`SELECT id, status FROM twitter.tweet_drafts WHERE owner_id = ${me.id}`;
  expect(draft.status).toBe('published');
  expect(await tweetsOf(me)).toEqual([{ id: draft.id, content }]);
  await expect(d).toBeVisible();
  await expect(d.getByLabel('本文')).toHaveValue(content);
  await expect(toast(page, 'ツイートしました')).toHaveCount(0);

  await d.getByRole('button', { name: 'ツイートする' }).click();

  await expect(page).toHaveURL('/');
  await expect(toast(page, 'ツイートしました')).toBeVisible();
  await expect(createDialog(page)).toBeHidden();
  await expect(card(page, content)).toHaveCount(1);
  expect(await tweetsOf(me)).toEqual([{ id: draft.id, content }]);
  expect((await imagesOf(draft.id)).map((i) => i.width)).toEqual([30]);
  await expect.poll(() => naturalWidths(card(page, content))).toEqual([30]);
  expect((await uploadsOf(draft.id)).map((u) => u.status)).toEqual(['attached']);
  expect(await sql`SELECT id FROM twitter.tweet_drafts WHERE owner_id = ${me.id}`).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('編集：確定後に応答だけ失っても、再送で版は進まず画像・削除予約も重複しない。URLとページ位置を保つ', async ({ page }) => {
  const me = await loginableUser('編集の応答喪失');
  const errors = watchPageErrors(page);
  const t = token();
  // 保持する正方形の画像で行の高さを保ち、画像の縦横比変更による最下部のscrollY補正を避ける。
  const tweetId = await post(me, `編集前 ${t}`, [20, 10]);
  // 対象を一覧の下の方に置き、スクロールした位置を保つことを確かめる。
  for (let i = 0; i < 8; i++) await post(me, `後の投稿 ${i} ${t}`);
  const [removed] = await imagesOf(tweetId);
  const [{ storage_key: removedKey }] = await sql`SELECT storage_key FROM twitter.images WHERE upload_id = ${removed.upload_id}`;

  await page.setViewportSize({ width: 1280, height: 600 });
  await login(page, me);
  await page.goto(`/profile/${me.displayId}`);
  const target = card(page, `編集前 ${t}`);
  await target.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);
  await openMenu(page, target, '編集する');
  const d = editDialog(page);
  await expect(d).toBeVisible();
  await d.getByLabel('本文').fill(`編集後 ${t}`);
  await d.getByRole('button', { name: '添付済みの画像1を解除' }).click();
  await attach(d, [await png(40)]);
  const lost = await dropNextActionResponseAfterCommit(page, `編集後 ${t}`);
  await d.getByRole('button', { name: '更新', exact: true }).click();

  await expect(d.getByText(UNCONFIRMED)).toBeVisible();
  expect(lost.response?.ok).toBe(true);
  expect(await tweetRow(tweetId)).toMatchObject({ content: `編集後 ${t}`, revision: '1' });
  const committed = await imagesOf(tweetId);
  expect(committed.map((i) => i.width)).toEqual([10, 40]);
  expect(await deleteJobsFor([removedKey])).toHaveLength(1);
  await expect(toast(page, 'ツイートを更新しました')).toHaveCount(0);

  await d.getByRole('button', { name: '更新', exact: true }).click();

  await expect(toast(page, 'ツイートを更新しました')).toBeVisible();
  await expect(editDialog(page)).toBeHidden();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  await expect(card(page, `編集後 ${t}`)).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(await tweetRow(tweetId)).toMatchObject({ content: `編集後 ${t}`, revision: '1' });
  expect(await imagesOf(tweetId)).toEqual(committed);
  await expect.poll(() => naturalWidths(card(page, `編集後 ${t}`))).toEqual([10, 40]);
  expect(await deleteJobsFor([removedKey])).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('削除：確定後に応答だけ失っても、再送は既に削除済みの案内になり、削除成功とは通知せず一覧を更新する', async ({ page }) => {
  const me = await loginableUser('削除の応答喪失');
  const errors = watchPageErrors(page);
  const t = token();
  const tweetId = await post(me, `消える投稿 ${t}`, [10]);
  await post(me, `残る投稿 ${t}`);

  await login(page, me);
  await openMenu(page, card(page, `消える投稿 ${t}`), '削除する');
  await expect.poll(() => naturalWidths(card(page, `消える投稿 ${t}`))).toEqual([10]);
  const d = deleteDialog(page);
  await expect(d).toBeVisible();
  const lost = await dropNextActionResponseAfterCommit(page, tweetId);
  await d.getByRole('button', { name: 'はい', exact: true }).click();

  await expect(d.getByText(UNCONFIRMED)).toBeVisible();
  expect(lost.response?.ok).toBe(true);
  expect(await tweetRow(tweetId)).toBeUndefined();
  await expect(toast(page, 'ツイートを削除しました')).toHaveCount(0);

  await d.getByRole('button', { name: 'はい', exact: true }).click();

  await expect(toast(page, 'このツイートは既に削除されています')).toBeVisible();
  await expect(deleteDialog(page)).toBeHidden();
  await expect(toast(page, 'ツイートを削除しました')).toHaveCount(0);
  await expect(card(page, `消える投稿 ${t}`)).toHaveCount(0);
  await expect(card(page, `残る投稿 ${t}`)).toBeVisible();
  await expect(page).toHaveURL('/');
  expect(errors).toEqual([]);
});

test.describe('未ログインでの開始・保存はログイン画面へ移動し、通信失敗や成功と誤って通知しない', () => {
  const misleading = (page: Page) =>
    page.getByText(new RegExp(`${NETWORK_TOAST}|処理結果を確認できませんでした|ツイートしました$|ツイートを更新しました|ツイートを削除しました`));

  async function expectLogin(page: Page, guide: string) {
    await expect(page).toHaveURL('/login');
    await expect(toast(page, guide)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('ユーザーID')).toBeVisible();
    await expect(misleading(page)).toHaveCount(0);
  }

  test('作成の開始・投稿', async ({ page }) => {
    const me = await loginableUser('作成の未ログイン');
    const errors = watchPageErrors(page);
    await page.goto('/');
    await launcher(page).click();
    await expectLogin(page, 'ツイートするにはログインしてください');

    await login(page, me);
    await launcher(page).click();
    const d = createDialog(page);
    await d.getByLabel('本文').fill(`未ログインの投稿 ${token()}`);
    await page.context().clearCookies();
    await d.getByRole('button', { name: 'ツイートする' }).click();
    await expectLogin(page, 'ツイートするにはログインしてください');
    expect(await tweetsOf(me)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('編集の開始・保存', async ({ page }) => {
    const me = await loginableUser('編集の未ログイン');
    const errors = watchPageErrors(page);
    const t = token();
    const tweetId = await post(me, `編集されない ${t}`);
    await login(page, me);
    await page.context().clearCookies();
    await openMenu(page, card(page, `編集されない ${t}`), '編集する');
    await expectLogin(page, 'ツイートを編集するにはログインしてください');

    await login(page, me);
    await openMenu(page, card(page, `編集されない ${t}`), '編集する');
    const d = editDialog(page);
    await d.getByLabel('本文').fill(`編集後 ${t}`);
    await page.context().clearCookies();
    await d.getByRole('button', { name: '更新', exact: true }).click();
    await expectLogin(page, 'ツイートを編集するにはログインしてください');
    expect(await tweetRow(tweetId)).toMatchObject({ content: `編集されない ${t}`, revision: '0' });
    expect(errors).toEqual([]);
  });

  test('削除の開始・確定', async ({ page }) => {
    const me = await loginableUser('削除の未ログイン');
    const errors = watchPageErrors(page);
    const t = token();
    const tweetId = await post(me, `削除されない ${t}`);
    await login(page, me);
    await page.context().clearCookies();
    await openMenu(page, card(page, `削除されない ${t}`), '削除する');
    await expectLogin(page, 'ツイートを削除するにはログインしてください');

    await login(page, me);
    await openMenu(page, card(page, `削除されない ${t}`), '削除する');
    const d = deleteDialog(page);
    await expect(d).toBeVisible();
    await page.context().clearCookies();
    await d.getByRole('button', { name: 'はい', exact: true }).click();
    await expectLogin(page, 'ツイートを削除するにはログインしてください');
    expect(await tweetRow(tweetId)).toBeDefined();
    expect(errors).toEqual([]);
  });
});

test('通常のエラー（欄エラー・競合・期限切れ・別の利用者への切替）は既存の説明で表示し、通信の失敗と混同しない', async ({ page }) => {
  const me = await loginableUser('通常エラー');
  const other = await loginableUser('別の利用者');
  const t = token();
  const conflicted = await post(me, `競合する投稿 ${t}`);
  const expiring = await post(me, `期限切れの投稿 ${t}`);
  const kept = await post(me, `切替後も残る投稿 ${t}`);
  const confused = (d: Locator) => d.getByText(UNCONFIRMED);

  await login(page, me);
  // 欄エラー
  await launcher(page).click();
  let d = createDialog(page);
  await d.getByLabel('本文').fill('あ'.repeat(281));
  await d.getByRole('button', { name: 'ツイートする' }).click();
  await expect(d.getByText('本文は280文字以下で入力してください')).toBeVisible();
  await expect(alertToast(page, 'ツイートに失敗しました')).toBeVisible();
  await expect(confused(d)).toHaveCount(0);
  await expect(alertToast(page, NETWORK_TOAST)).toHaveCount(0);
  await d.getByRole('button', { name: '閉じる' }).click();

  // 競合（開いた後に他の画面で版が進んだ）
  await openMenu(page, card(page, `競合する投稿 ${t}`), '編集する');
  d = editDialog(page);
  await expect(d).toBeVisible();
  await sql`UPDATE twitter.tweets SET revision = revision + 1 WHERE id = ${conflicted}`;
  await d.getByLabel('本文').fill(`競合後 ${t}`);
  await d.getByRole('button', { name: '更新', exact: true }).click();
  await expect(d.getByText('他の画面で更新されています。閉じて開き直してください')).toBeVisible();
  await expect(alertToast(page, 'ツイートの更新に失敗しました')).toBeVisible();
  await expect(confused(d)).toHaveCount(0);
  await d.getByRole('button', { name: '閉じる' }).click();

  // 編集の準備の期限切れ
  await openMenu(page, card(page, `期限切れの投稿 ${t}`), '編集する');
  d = editDialog(page);
  await expect(d).toBeVisible();
  await sql`
    UPDATE twitter.tweet_drafts SET expires_at = now() - interval '1 minute'
    WHERE owner_id = ${me.id} AND purpose = 'edit' AND target_tweet_id = ${expiring} AND status = 'open'
  `;
  await d.getByRole('button', { name: '更新', exact: true }).click();
  await expect(d.getByText('編集の準備が切れました。閉じて開き直してください')).toBeVisible();
  await expect(confused(d)).toHaveCount(0);
  await d.getByRole('button', { name: '閉じる' }).click();

  // 削除の確認中に別の利用者へ切り替わった
  await openMenu(page, card(page, `切替後も残る投稿 ${t}`), '削除する');
  d = deleteDialog(page);
  await expect(d).toBeVisible();
  const second = await page.context().newPage();
  await page.context().clearCookies();
  await login(second, other);
  await d.getByRole('button', { name: 'はい', exact: true }).click();
  await expect(d.getByText('ログイン中の利用者が変わりました。画面を開き直してください')).toBeVisible();
  await expect(alertToast(page, 'ツイートの削除に失敗しました')).toBeVisible();
  await expect(confused(d)).toHaveCount(0);
  expect(await tweetRow(kept)).toBeDefined();
});
