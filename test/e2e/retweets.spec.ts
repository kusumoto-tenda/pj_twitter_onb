import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import postgres from 'postgres';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。retweetsテーブルは既存のものを使う。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';
const token = () => randomUUID().slice(0, 8);

const tracked: string[] = [];

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    { users: new PostgresUserRepository(sql), passwords: new ScryptPasswordHasher(), newId: randomUUID, now: () => new Date() },
    { name, displayId: uniqueDisplayId('Rt'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  tracked.push(id);
  return { id, name, displayId };
}

/** 現在時刻の近くに投稿を作る（タイムラインの先頭ページに出す）。 */
async function post(owner: TimelinePerson, content: string, offsetMs = 0) {
  return fixtures.tweet(owner, content, new Date(Date.now() + offsetMs).toISOString());
}

async function login(page: Page, user: TimelinePerson) {
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(user.displayId);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
}

/** 別のブラウザ（Cookieを共有しない）で開いたページ。 */
async function separatePage(browser: Browser) {
  const context = await browser.newContext();
  return { page: await context.newPage(), close: () => context.close() };
}

const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });
const retweetCard = (page: Page, by: TimelinePerson, text: string) =>
  card(page, text).filter({ hasText: `${by.name}さんがリツイート` });
const plainCard = (page: Page, text: string) => card(page, text).filter({ hasNotText: 'さんがリツイート' });
const retweetButton = (c: Locator) => c.getByRole('button', { name: 'リツイートする', exact: true });
const unretweetButton = (c: Locator) => c.getByRole('button', { name: 'リツイートを解除', exact: true });
const anyRetweetButton = (c: Locator) => c.getByRole('button', { name: /^リツイート(する|を解除)$/ });
const retweetCount = (c: Locator, count: number) => c.getByText(`リツイート${count}件`, { exact: true });
const followToggle = (page: Page) => page.getByRole('checkbox', { name: 'フォローのみ' });
const tabLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'プロフィールのタブ' }).getByRole('link', { name, exact: true });

async function retweetRows(userId: string) {
  return sql<{ id: string; tweet_id: string; created_at: Date }[]>`
    SELECT id, tweet_id, created_at FROM twitter.retweets WHERE executor_id = ${userId} ORDER BY created_at DESC, id DESC
  `;
}

async function openRetweetsTab(page: Page, user: TimelinePerson) {
  await page.goto(`/profile/${user.displayId}`);
  await tabLink(page, 'リツイート').click();
  await expect(page).toHaveURL(`/profile/${user.displayId}?tab=retweets`);
}

test.afterEach(async () => {
  const ids = tracked.splice(0);
  if (ids.length > 0) await sql`DELETE FROM twitter.users WHERE id = ANY(${ids}::uuid[])`;
  await fixtures.cleanup();
});

test.afterAll(async () => {
  await sql.end();
});

test('メインからリツイートすると全カードの状態・件数が揃い、自分のリツイートタブから解除しても他人のリツイートは残る', async ({ page, browser }) => {
  const me = await loginableUser('リツイートする人');
  const author = await loginableUser('投稿した人');
  const other = await loginableUser('先にリツイートした人');
  const t = token();
  const tweetId = await post(author, `リツイートされる投稿 ${t}`);
  await fixtures.retweet(other, tweetId, new Date(Date.now() + 1_000).toISOString());
  const tweetBefore = await sql`SELECT content, created_at, updated_at, revision FROM twitter.tweets WHERE id = ${tweetId}`;

  await login(page, me);
  const cards = card(page, `リツイートされる投稿 ${t}`);
  await expect(cards).toHaveCount(2);
  await expect(retweetButton(plainCard(page, `リツイートされる投稿 ${t}`))).toHaveAttribute('aria-pressed', 'false');
  await expect(cards.getByText('リツイート1件', { exact: true })).toHaveCount(2);

  // 他人のリツイートカードで押しても、対象は元投稿（他人のリツイート行ではない）
  await retweetButton(retweetCard(page, other, `リツイートされる投稿 ${t}`)).click();
  await expect(retweetCard(page, me, `リツイートされる投稿 ${t}`)).toBeVisible();
  await expect(cards).toHaveCount(3);
  await expect(cards.getByRole('button', { name: 'リツイートを解除', exact: true })).toHaveCount(3);
  await expect(cards.getByText('リツイート2件', { exact: true })).toHaveCount(3);
  await expect(page).toHaveURL('/');
  expect((await retweetRows(me.id)).map((r) => r.tweet_id)).toEqual([tweetId]);
  expect(await retweetRows(other.id)).toHaveLength(1);
  // 元投稿の本文・日時・版は変えない（再編集扱いにしない）
  expect(await sql`SELECT content, created_at, updated_at, revision FROM twitter.tweets WHERE id = ${tweetId}`).toEqual(tweetBefore);

  // 未ログインでも件数を閲覧できる（本人状態はfalse）
  const anonymous = await separatePage(browser);
  try {
    await anonymous.page.goto('/');
    await expect(card(anonymous.page, `リツイートされる投稿 ${t}`).getByText('リツイート2件', { exact: true })).toHaveCount(3);
    await expect(card(anonymous.page, `リツイートされる投稿 ${t}`).getByRole('button', { name: 'リツイートする', exact: true })).toHaveCount(3);
  } finally {
    await anonymous.close();
  }

  await openRetweetsTab(page, me);
  const mine = retweetCard(page, me, `リツイートされる投稿 ${t}`);
  await expect(mine).toBeVisible();
  await unretweetButton(mine).click();
  await expect(mine).toHaveCount(0);
  await expect(page.getByText('まだリツイートがありません')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${me.displayId}?tab=retweets`);
  expect(await retweetRows(me.id)).toEqual([]);
  expect(await retweetRows(other.id)).toHaveLength(1);

  await page.goto('/');
  await expect(cards).toHaveCount(2);
  await expect(retweetCard(page, other, `リツイートされる投稿 ${t}`)).toBeVisible();
  await expect(cards.getByRole('button', { name: 'リツイートする', exact: true })).toHaveCount(2);
  await expect(cards.getByText('リツイート1件', { exact: true })).toHaveCount(2);
});

test('自分の投稿もリツイートでき、解除後の再実行はタイムラインの先頭側に出る', async ({ page }) => {
  const me = await loginableUser('自分をリツイート');
  const t = token();
  const own = await post(me, `自分の投稿 ${t}`, -2_000);
  await post(me, `後の投稿 ${t}`, -1_000);

  await login(page, me);
  await retweetButton(plainCard(page, `自分の投稿 ${t}`)).click();
  await expect(retweetCard(page, me, `自分の投稿 ${t}`)).toBeVisible();
  const [first] = await retweetRows(me.id);
  expect(first.tweet_id).toBe(own);
  const order = async () =>
    (await page.getByRole('article').allTextContents())
      .filter((c) => c.includes(t))
      .map((c) => `${c.includes('さんがリツイート') ? 'RT:' : ''}${c.includes(`自分の投稿 ${t}`) ? '自分' : '後'}`);
  expect(await order()).toEqual(['RT:自分', '後', '自分']);

  await unretweetButton(retweetCard(page, me, `自分の投稿 ${t}`)).click();
  await expect(retweetCard(page, me, `自分の投稿 ${t}`)).toHaveCount(0);
  await expect(retweetButton(plainCard(page, `自分の投稿 ${t}`))).toBeEnabled();
  await retweetButton(plainCard(page, `自分の投稿 ${t}`)).click();
  await expect(retweetCard(page, me, `自分の投稿 ${t}`)).toBeVisible();
  const [again] = await retweetRows(me.id);
  expect(again.id).not.toBe(first.id);
  expect(again.created_at.getTime()).toBeGreaterThan(first.created_at.getTime());
  expect(await order()).toEqual(['RT:自分', '後', '自分']);
});

test('未ログインのクリックは書き込まず「ログイン中のみリツイートできます」を3秒表示し、その場に留まる', async ({ page }) => {
  const author = await loginableUser('投稿者');
  const t = token();
  await post(author, `匿名で見る投稿 ${t}`);

  await page.goto('/');
  const target = card(page, `匿名で見る投稿 ${t}`);
  await retweetButton(target).click();

  const toast = page.getByRole('alert').filter({ hasText: 'ログイン中のみリツイートできます' });
  await expect(toast).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(retweetButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(retweetCount(target, 0)).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect(await sql`SELECT 1 FROM twitter.retweets r JOIN twitter.tweets tw ON tw.id = r.tweet_id WHERE tw.owner_id = ${author.id}`).toHaveLength(0);

  await page.goto(`/profile/${author.displayId}`);
  await retweetButton(card(page, `匿名で見る投稿 ${t}`)).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ログイン中のみリツイートできます' })).toBeVisible();
  await expect(page).toHaveURL(`/profile/${author.displayId}`);
});

test('画面を表示した後に別の利用者へ切り替えると、どちらのリツイートも変えない', async ({ page }) => {
  const a = await loginableUser('A');
  const b = await loginableUser('B');
  const t = token();
  const tweetId = await post(b, `Bの投稿 ${t}`);

  await login(page, a);
  const target = plainCard(page, `Bの投稿 ${t}`);
  await expect(retweetButton(target)).toHaveAttribute('aria-pressed', 'false');

  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b);
  await retweetButton(target).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ログイン中の利用者が変わりました' })).toBeVisible();
  await expect(retweetButton(target)).toHaveAttribute('aria-pressed', 'false');
  await expect(retweetCount(target, 0)).toBeVisible();
  expect(await retweetRows(a.id)).toEqual([]);
  expect(await retweetRows(b.id)).toEqual([]);
  expect(await sql`SELECT 1 FROM twitter.retweets WHERE tweet_id = ${tweetId}`).toHaveLength(0);
});

test('フォローのみでは実行者で判定し、自分のリツイートは表示しない', async ({ page }) => {
  const me = await loginableUser('フォローする人');
  const followed = await loginableUser('フォロー先');
  const stranger = await loginableUser('フォローしていない作者');
  const t = token();
  const tweetId = await post(stranger, `知らない人の投稿 ${t}`);
  await fixtures.follow(me, followed);
  await fixtures.retweet(followed, tweetId, new Date(Date.now() + 1_000).toISOString());

  await login(page, me);
  await followToggle(page).check();
  await expect(page).toHaveURL('/?follow=true');
  // 作者はフォローしていないので元投稿のカードは出ず、フォロー先のリツイートだけが出る
  const cards = card(page, `知らない人の投稿 ${t}`);
  await expect(cards).toHaveCount(1);
  await expect(retweetCard(page, followed, `知らない人の投稿 ${t}`)).toBeVisible();

  await retweetButton(retweetCard(page, followed, `知らない人の投稿 ${t}`)).click();
  await expect(cards.getByRole('button', { name: 'リツイートを解除', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/?follow=true');
  // 自分のリツイートは出来事として増えず、件数と状態だけが変わる
  await expect(cards).toHaveCount(1);
  await expect(retweetCard(page, me, `知らない人の投稿 ${t}`)).toHaveCount(0);
  await expect(cards.getByText('リツイート2件', { exact: true })).toHaveCount(1);
});

test('2ページ目で操作してもURL・カーソルを保ち、戻る・進むで状態がDBの値になる', async ({ page }) => {
  const me = await loginableUser('ページを見る人');
  const author = await loginableUser('ページの作者');
  await fixtures.follow(me, author);
  const t = token();
  const base = Date.now() - 120_000;
  const tweets = await fixtures.tweets(
    author,
    Array.from({ length: 21 }, (_, i) => ({ content: `ページ${String(i).padStart(2, '0')}番 ${t}`, createdAt: new Date(base + i).toISOString() })),
  );

  await login(page, me);
  // 他の利用者の投稿が先頭ページに混ざっても、フォロー中の作者の21件は絞り込みで確実に2ページになる
  await followToggle(page).check();
  await expect(page).toHaveURL('/?follow=true');
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/follow=true.*cursor=|cursor=.*follow=true/);
  const second = page.url();
  const oldest = plainCard(page, `ページ00番 ${t}`);
  await expect(oldest).toBeVisible();

  await retweetButton(oldest).click();
  await expect(unretweetButton(oldest)).toBeVisible();
  await expect(retweetCount(oldest, 1)).toBeVisible();
  expect(page.url()).toBe(second);
  expect((await retweetRows(me.id)).map((r) => r.tweet_id)).toEqual([tweets[0]]);

  await page.goBack();
  await expect(page).toHaveURL('/?follow=true');
  // 自分のリツイートはフォローのみの先頭ページに出来事として出ない
  await expect(plainCard(page, `ページ20番 ${t}`)).toBeVisible();
  await expect(retweetCard(page, me, `ページ00番 ${t}`)).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(second);
  await expect(unretweetButton(plainCard(page, `ページ00番 ${t}`))).toBeVisible();
  await expect(retweetCount(plainCard(page, `ページ00番 ${t}`), 1)).toBeVisible();
});

test('幅375pxで横スクロールが出ず、キーボードでリツイート・解除でき、処理中は連打できない', async ({ page }) => {
  const me = await loginableUser('キーボード');
  const t = token();
  const tweetId = await post(me, `キーボードでリツイート ${t}`);

  await login(page, me);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // 応答を遅らせ、処理中は押せないことを確かめる
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    return route.continue();
  });
  const target = plainCard(page, `キーボードでリツイート ${t}`);
  await retweetButton(target).focus();
  await page.keyboard.press('Enter');
  await expect(anyRetweetButton(target)).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(unretweetButton(target)).toBeEnabled();
  expect((await retweetRows(me.id)).map((r) => r.tweet_id)).toEqual([tweetId]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await unretweetButton(target).focus();
  await page.keyboard.press('Space');
  await expect(retweetButton(target)).toBeEnabled();
  await expect(retweetCard(page, me, `キーボードでリツイート ${t}`)).toHaveCount(0);
  expect(await retweetRows(me.id)).toEqual([]);
});
