import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import postgres from 'postgres';
import sharp from 'sharp';
import { cleanupMedia } from '@/application/usecases/media/cleanup-media';
import type { TimelinePerson } from '@/application/dtos/timeline/timeline';
import { createAccount } from '@/application/usecases/users/create-account';
import { VercelBlobStorage } from '@/infra/external_services/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/persistence/postgres/repositories/postgres-media-repository';
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
const MB5 = 5 * 1024 * 1024;

const token = () => randomUUID().slice(0, 8);

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    {
      users: new PostgresUserRepository(sql),
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    },
    { name, displayId: uniqueDisplayId('Tw'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  return fixtures.track({ id, name, displayId });
}

async function login(page: Page, user: TimelinePerson) {
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(user.displayId);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
}

/** 寸法の違うPNG/JPEGを作る（表示順の確認に使う）。 */
async function image(width: number, format: 'png' | 'jpeg' = 'png') {
  const buffer = await sharp({ create: { width, height: 10, channels: 3, background: '#4488cc' } })[format]().toBuffer();
  return { name: `image-${width}.${format === 'png' ? 'png' : 'jpg'}`, mimeType: `image/${format}`, buffer };
}

const launcher = (page: Page) =>
  page.getByRole('navigation', { name: 'メインメニュー' }).getByRole('button', { name: 'ツイートする' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'ツイートを作成' });
const submit = (d: Locator) => d.getByRole('button', { name: 'ツイートする' });

async function openDialog(page: Page) {
  await launcher(page).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

/** 画像を選び、すべてのアップロードと検証が終わるまで待つ。 */
async function attach(d: Locator, files: Awaited<ReturnType<typeof image>>[]) {
  await d.getByLabel('画像を追加').setInputFiles(files);
  await expect(d.getByText('アップロード中')).toHaveCount(0, { timeout: 60_000 });
  await expect(d.getByText('確認中')).toHaveCount(0, { timeout: 60_000 });
}

async function tweetsOf(user: TimelinePerson) {
  return sql<{ id: string; content: string }[]>`SELECT id, content FROM twitter.tweets WHERE owner_id = ${user.id}`;
}

/** 画像要素の実際の幅（読み込めていれば0より大きい）。 */
async function naturalWidths(card: Locator) {
  return card.getByRole('img').evaluateAll((els) => els.map((el) => (el as HTMLImageElement).naturalWidth));
}

/** 利用者の下書き・予約・削除予約・画像の実体を後片付けする（UUIDとキーで追跡）。 */
async function cleanupUsers(ids: string[]) {
  if (ids.length === 0) return;
  const drafts = await sql<{ id: string }[]>`SELECT id FROM twitter.tweet_drafts WHERE owner_id = ANY(${ids}::uuid[])`;
  const draftIds = drafts.map((d) => d.id);
  const keys = (
    await sql<{ storage_key: string }[]>`SELECT storage_key FROM twitter.media_uploads WHERE draft_id = ANY(${draftIds}::uuid[])`
  ).map((r) => r.storage_key);
  await sql`DELETE FROM twitter.users WHERE id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM twitter.media_delete_jobs WHERE storage_key = ANY(${keys})`;
  await sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${draftIds}::uuid[])`;
  await sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${draftIds}::uuid[])`;
  if (keys.length > 0) await storage.remove(keys);
}

const tracked: string[] = [];
const track = <T extends TimelinePerson>(user: T) => {
  tracked.push(user.id);
  return user;
};

test.afterEach(async () => {
  await cleanupUsers(tracked.splice(0));
  await fixtures.cleanup();
});

test.afterAll(async () => {
  await sql.end();
});

test('本文だけを投稿すると、メイン画面の先頭に表示し、3秒通知する（再読み込みでは出ない）', async ({ page }) => {
  const me = track(await loginableUser('投稿する人'));
  const content = `本文だけの投稿 ${token()}\n二行目`;

  await login(page, me);
  const d = await openDialog(page);
  await expect(d.getByLabel('本文')).toBeFocused();
  await d.getByLabel('本文').fill(content);
  await expect(d.getByText(`${Array.from(content).length} / 280`)).toBeVisible();
  await submit(d).click();

  await expect(page).toHaveURL('/');
  const toast = page.getByRole('status').filter({ hasText: 'ツイートしました' });
  await expect(toast).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('article').first()).toContainText(content.split('\n')[0]);
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect((await tweetsOf(me)).map((t) => t.content)).toEqual([content]);

  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toHaveCount(0);
});

test('画像だけの投稿と、本文＋4枚（JPEG/PNG）の投稿を選択順で表示し、画像を読み込める', async ({ page }) => {
  const me = track(await loginableUser('画像の人'));

  await login(page, me);
  let d = await openDialog(page);
  await attach(d, [await image(30)]);
  await submit(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toBeVisible();
  const imageOnly = page.getByRole('article').first();
  await expect(imageOnly.getByRole('img')).toHaveCount(1);
  await expect.poll(() => naturalWidths(imageOnly)).toEqual([30]);

  const content = `4枚の投稿 ${token()}`;
  d = await openDialog(page);
  await d.getByLabel('本文').fill(content);
  await attach(d, [await image(40, 'jpeg'), await image(10)]);
  await attach(d, [await image(20, 'jpeg'), await image(50)]);
  await expect(d.getByLabel('画像を追加')).toBeDisabled();
  await submit(d).click();

  const card = page.getByRole('article').filter({ hasText: content });
  await expect(card.getByRole('img')).toHaveCount(4);
  await expect.poll(() => naturalWidths(card)).toEqual([40, 10, 20, 50]);
  const src = await card.getByRole('img').first().getAttribute('src');
  expect(src).toMatch(/^\/media\/[0-9a-f-]{36}$/);
  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/jpeg');
  expect(response.headers()['cache-control']).toBe('private, no-store');

  // 本人のプロフィールでも同じ順で表示する
  await page.goto(`/profile/${me.displayId}`);
  await expect.poll(() => naturalWidths(page.getByRole('article').filter({ hasText: content }))).toEqual([40, 10, 20, 50]);
});

test('画像の解除・閉じるでは投稿せず、開き直すと空になる', async ({ page }) => {
  const me = track(await loginableUser('キャンセルする人'));

  await login(page, me);
  let d = await openDialog(page);
  await d.getByLabel('本文').fill('投稿しない本文');
  await attach(d, [await image(30), await image(40)]);
  await d.getByRole('button', { name: '画像1を削除' }).click();
  await expect(d.getByRole('img')).toHaveCount(1);
  await d.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(launcher(page)).toBeFocused();

  d = await openDialog(page);
  await expect(d.getByLabel('本文')).toHaveValue('');
  await expect(d.getByRole('img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  expect(await tweetsOf(me)).toEqual([]);
  // 破棄は閉じた後に非同期で送るため、反映されるまで待つ。
  await expect
    .poll(async () => {
      const rows = await sql`
        SELECT DISTINCT u.status FROM twitter.media_uploads u JOIN twitter.tweet_drafts d ON d.id = u.draft_id
        WHERE d.owner_id = ${me.id}
      `;
      return rows.map((r) => r.status);
    })
    .toEqual(['discarded']);
});

test('未ログインで投稿ボタンを押すと、ログイン画面で3秒案内する', async ({ page }) => {
  await page.goto('/');
  await launcher(page).click();

  await expect(page).toHaveURL('/login');
  const toast = page.getByRole('status').filter({ hasText: 'ツイートするにはログインしてください' });
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 4_000 });
});

test('281文字・空・GIF・5枚目・5MB超過は欄エラーと失敗通知で、投稿を増やさない。5MBちょうどは添付できる', async ({ page }) => {
  // 5MBの画像を実際のテスト用ストアへアップロードするため、他のテストより時間がかかる。
  test.setTimeout(120_000);
  const me = track(await loginableUser('失敗する人'));

  await login(page, me);
  const d = await openDialog(page);
  await submit(d).click();
  await expect(d.getByText('本文か画像のどちらかを入力してください')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'ツイートに失敗しました' })).toBeVisible();

  await d.getByLabel('本文').fill('あ'.repeat(281));
  await submit(d).click();
  await expect(d.getByText('本文は280文字以下で入力してください')).toBeVisible();
  await expect(d.getByLabel('本文')).toHaveValue('あ'.repeat(281));

  const gif = { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary') };
  await d.getByLabel('画像を追加').setInputFiles([gif]);
  await expect(d.getByText('JPEG・PNG画像のみ添付できます')).toBeVisible();

  const base = await image(12);
  const exact = Buffer.concat([base.buffer, Buffer.alloc(MB5 - base.buffer.byteLength)]);
  const over = Buffer.concat([exact, Buffer.alloc(1)]);
  await d.getByLabel('画像を追加').setInputFiles([{ name: 'over.png', mimeType: 'image/png', buffer: over }]);
  await expect(d.getByText('画像は1枚5MB以下にしてください')).toBeVisible();
  await attach(d, [{ name: 'exact.png', mimeType: 'image/png', buffer: exact }]);
  await expect(d.getByRole('img')).toHaveCount(1);

  await attach(d, [await image(20), await image(30), await image(40)]);
  await d.getByLabel('画像を追加').setInputFiles([await image(50)]).catch(() => {});
  await expect(d.getByLabel('画像を追加')).toBeDisabled();
  await expect(d.getByRole('img')).toHaveCount(4);
  expect(await tweetsOf(me)).toEqual([]);

  // 失敗後も本文と成功済みの添付を保ったまま、直して再送できる
  await d.getByLabel('本文').fill('直して投稿');
  await submit(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toBeVisible();
  expect((await tweetsOf(me)).map((t) => t.content)).toEqual(['直して投稿']);
});

test('リツイートのカードでも元投稿の画像を同じ順で表示する', async ({ page }) => {
  const author = track(await loginableUser('元投稿者'));
  const retweeter = await fixtures.user('拡散する人', 'Tw');
  const content = `拡散される画像 ${token()}`;

  await login(page, author);
  const d = await openDialog(page);
  await d.getByLabel('本文').fill(content);
  await attach(d, [await image(25), await image(35)]);
  await submit(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toBeVisible();
  const [tweet] = await tweetsOf(author);
  await fixtures.retweet(retweeter, tweet.id, new Date(Date.now() + 60_000).toISOString());

  await page.goto('/');
  const retweetCard = page.getByRole('article').filter({ hasText: '拡散する人さんがリツイート' });
  await expect.poll(() => naturalWidths(retweetCard)).toEqual([25, 35]);
});

test('ダイアログを開いた後に別アカウントへ切り替わると、元の下書きから投稿しない', async ({ page }) => {
  const a = track(await loginableUser('A'));
  const b = track(await loginableUser('B'));

  await login(page, a);
  const d = await openDialog(page);
  await d.getByLabel('本文').fill('Aの下書き');
  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b); // 同じブラウザのセッションがBに変わる（Aのダイアログは開いたまま）
  await submit(d).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ツイートに失敗しました' })).toBeVisible();
  expect(await tweetsOf(a)).toEqual([]);
  expect(await tweetsOf(b)).toEqual([]);
});

test('投稿の送信が再送されても1投稿だけになる', async ({ page }) => {
  const me = track(await loginableUser('再送'));
  const content = `再送される投稿 ${token()}`;

  await login(page, me);
  const d = await openDialog(page);
  await d.getByLabel('本文').fill(content);
  // 投稿のServer Actionの要求を2回送り、2回目の応答を返す（通信の再送を再現する）
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.headers()['next-action'] && request.postData()?.includes(content)) {
      await route.fetch();
      return route.fulfill({ response: await route.fetch() });
    }
    return route.continue();
  });
  await submit(d).click();

  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toBeVisible();
  expect((await tweetsOf(me)).map((t) => t.content)).toEqual([content]);
});

test('アカウント削除後は画像URLが404になり、回収で実体が消える。他人の画像は残る', async ({ page }) => {
  const me = await loginableUser('削除する人');
  const other = track(await loginableUser('残る人'));

  await login(page, other);
  let d = await openDialog(page);
  await attach(d, [await image(15)]);
  await submit(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toBeVisible();
  const otherSrc = await page.getByRole('article').first().getByRole('img').getAttribute('src');

  await page.context().clearCookies();
  await login(page, me);
  d = await openDialog(page);
  await attach(d, [await image(16)]);
  await submit(d).click();
  await expect(page.getByRole('status').filter({ hasText: 'ツイートしました' })).toBeVisible();
  const mySrc = await page.getByRole('article').first().getByRole('img').getAttribute('src');
  const [{ storage_key: myKey }] = await sql`
    SELECT storage_key FROM twitter.images WHERE id = ${mySrc!.split('/').pop()!}
  `;
  const myDrafts = (await sql`SELECT id FROM twitter.tweet_drafts WHERE owner_id = ${me.id}`).map((r) => r.id);

  await page.goto(`/profile/${me.displayId}/delete`);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'アカウント削除' }).click();
  await expect(page).toHaveURL('/login');

  expect((await page.request.get(mySrc!)).status()).toBe(404);
  expect((await page.request.get(otherSrc!)).status()).toBe(200);
  await cleanupMedia(
    // 削除予約は画像のトークンの期限（15分）以降になる。
    { media: new PostgresMediaRepository(sql), storage, now: () => new Date(Date.now() + 20 * 60_000) },
    { limit: 1000 },
  );
  expect(await storage.inspect(myKey)).toBeNull();
  expect((await page.request.get(otherSrc!)).status()).toBe(200);
  await sql`DELETE FROM twitter.media_uploads WHERE draft_id = ANY(${myDrafts}::uuid[])`;
  await sql`DELETE FROM twitter.tweet_drafts WHERE id = ANY(${myDrafts}::uuid[])`;
});

test('幅375pxとPC幅で操作でき、Tabはダイアログ内を移動する', async ({ page }) => {
  const me = track(await loginableUser('レイアウト'));

  await login(page, me);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/');
    const d = await openDialog(page);
    await attach(d, [await image(30)]);
    for (const target of [d.getByLabel('本文'), d.getByRole('img'), d.getByRole('button', { name: '閉じる' }), submit(d)]) {
      await expect(target).toBeVisible();
    }
    const box = await d.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
  }
});
