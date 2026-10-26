import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import postgres from 'postgres';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。ログアウトはDBを変更しないため、行の有無を直接確かめる。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';
const token = () => randomUUID().slice(0, 8);
const now = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    { users: new PostgresUserRepository(sql), passwords: new ScryptPasswordHasher(), newId: randomUUID, now: () => new Date() },
    { name, displayId: uniqueDisplayId('Lo'), bio: '', password: PASSWORD },
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

// Auth.jsのセッションCookie（http・https、分割された名前を含む）。通知用など他のCookieは対象にしない。
const hasSessionCookie = async (page: Page) =>
  (await page.context().cookies()).some((c) => /(^|\.)authjs\.session-token(\.\d+)?$/.test(c.name));

const nav = (page: Page) => page.getByRole('navigation', { name: 'メインメニュー' });
const navLogout = (page: Page) => nav(page).getByRole('button', { name: 'ログアウト', exact: true });
const profileHeader = (page: Page) => page.getByRole('region', { name: 'プロフィール' });
const profileLogout = (page: Page) => profileHeader(page).getByRole('button', { name: 'ログアウト', exact: true });
const anyLogout = (page: Page) => page.getByRole('button', { name: /^ログアウト/ });
const loggedOutToast = (page: Page) => page.getByRole('status').filter({ hasText: 'ログアウトしました' });
const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });
const launcher = (page: Page) => nav(page).getByRole('button', { name: 'ツイートする' });
const createDialog = (page: Page) => page.getByRole('dialog', { name: 'ツイートを作成' });

const isLogoutRequest = (route: Route) => {
  const request = route.request();
  return request.method() === 'POST' && !!request.headers()['next-action'] && !!request.postData()?.includes('expectedActorId');
};

/** /loginへ移動し、3秒の通知が一度だけ出て消え、再読込で再表示しないことを確かめる。 */
async function expectLoggedOutOnLoginPage(page: Page) {
  await expect(page).toHaveURL('/login');
  await expect(loggedOutToast(page)).toBeVisible();
  await expect(loggedOutToast(page)).toBeHidden({ timeout: 4_000 });
  expect(await hasSessionCookie(page)).toBe(false);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(loggedOutToast(page)).toHaveCount(0);
}

async function counts(user: TimelinePerson) {
  const [row] = await sql<{ users: number; tweets: number; favorites: number; follows: number; retweets: number; likes: number }[]>`
    SELECT
      (SELECT count(*)::int FROM twitter.users WHERE id = ${user.id}) AS users,
      (SELECT count(*)::int FROM twitter.tweets WHERE owner_id = ${user.id}) AS tweets,
      (SELECT count(*)::int FROM twitter.favorites WHERE user_id = ${user.id}) AS favorites,
      (SELECT count(*)::int FROM twitter.follows WHERE follower_id = ${user.id}) AS follows,
      (SELECT count(*)::int FROM twitter.retweets WHERE executor_id = ${user.id}) AS retweets,
      (SELECT count(*)::int FROM twitter.likes WHERE executor_id = ${user.id}) AS likes
  `;
  return row;
}

test.afterEach(async () => {
  await fixtures.cleanup();
});

test.afterAll(async () => {
  await sql.end();
});

test('ナビからログアウトすると/loginで3秒通知し、Cookieが消え、戻る・進むでも本人用の表示が復活しない', async ({ page }) => {
  const t = token();
  const me = await loginableUser('ログアウトする人');
  const friend = await fixtures.user('友だち', 'Lo');
  const mine = `自分の投稿 ${t}`;
  const saved = `保存した投稿 ${t}`;
  await fixtures.tweet(me, mine, now(-2_000));
  const savedId = await fixtures.tweet(friend, saved, now(-1_000));
  await fixtures.favorite(me, savedId, now());
  await fixtures.like(me, savedId, now());
  await fixtures.retweet(me, savedId, now());
  await fixtures.follow(me, friend);
  const before = await counts(me);

  await login(page, me);
  expect(await hasSessionCookie(page)).toBe(true);
  await expect(page.getByRole('region', { name: 'ログイン中のユーザー' })).toBeVisible();
  await page.goto('/favorites');
  await expect(card(page, saved)).toBeVisible();

  await navLogout(page).click();
  await expectLoggedOutOnLoginPage(page);

  // 戻ると公開一覧または/loginになり、お気に入りの内容・本人用の導線は出ない
  await page.goBack();
  await expect(page.locator('body')).not.toContainText(saved);
  await expect(anyLogout(page)).toHaveCount(0);
  await page.goForward();
  await expect(page.locator('body')).not.toContainText(saved);

  // homeは公開一覧として見られ、本人用の操作・ログアウト導線は消える
  await page.goto('/');
  await expect(card(page, mine)).toBeVisible();
  await expect(page.getByRole('region', { name: 'ログイン中のユーザー' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'アカウントを作成' })).toBeVisible();
  await expect(anyLogout(page)).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'お気に入り' })).toHaveCount(0);

  // 本人限定の画面は既存の認証ガードで/loginへ戻る
  for (const path of ['/favorites', '/?follow=true', `/profile/${me.displayId}/edit`, `/profile/${me.displayId}/delete`]) {
    await page.goto(path);
    await expect(page).toHaveURL('/login');
  }
  await page.goto(`/profile/${me.displayId}`);
  await expect(profileHeader(page).getByRole('link', { name: 'プロフィール編集' })).toHaveCount(0);
  await expect(profileHeader(page).getByRole('link', { name: 'アカウント削除' })).toHaveCount(0);

  // ログアウトでは利用者・投稿・関係を消さない
  expect(await counts(me)).toEqual(before);

  // 再ログインすると同じ利用者として以前のデータが見える
  await login(page, me);
  await page.goto('/favorites');
  await expect(card(page, saved)).toBeVisible();
  await expect(navLogout(page)).toBeVisible();
});

test('自分のプロフィールのログアウトも同じ動作で、他のブラウザのログインは残る', async ({ page, browser }) => {
  const me = await loginableUser('二つのブラウザ');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  try {
    await login(otherPage, me);
    await login(page, me);

    await page.goto(`/profile/${me.displayId}`);
    await expect(profileHeader(page).getByRole('link', { name: 'アカウント削除' })).toBeVisible();
    await profileLogout(page).click();
    await expectLoggedOutOnLoginPage(page);

    // 他人のプロフィールには本人用のログアウトを出さない
    const stranger = await fixtures.user('他人', 'Lo');
    await login(page, me);
    await page.goto(`/profile/${stranger.displayId}`);
    await expect(profileLogout(page)).toHaveCount(0);
    await expect(navLogout(page)).toBeVisible();

    // 別ブラウザのJWTは一括失効しない
    expect(await hasSessionCookie(otherPage)).toBe(true);
    await otherPage.goto('/favorites');
    await expect(otherPage).toHaveURL('/favorites');
    await expect(navLogout(otherPage)).toBeVisible();
  } finally {
    await other.close();
  }
});

test('処理中は二重送信できず、通信に失敗したら成功通知・移動をせず、その場で再試行できる', async ({ page }) => {
  const me = await loginableUser('失敗する人');
  await login(page, me);

  const state = { requests: 0, failNext: true, release: null as null | (() => void) };
  await page.route('**/*', async (route) => {
    if (!isLogoutRequest(route)) return route.continue();
    state.requests += 1;
    // 1回目は応答を遅らせてから通信を切断する
    if (state.failNext) {
      state.failNext = false;
      await new Promise<void>((resolve) => (state.release = resolve));
      return route.abort('failed');
    }
    return route.continue();
  });

  await navLogout(page).click();
  const pending = nav(page).getByRole('button', { name: 'ログアウト中…' });
  await expect(pending).toBeDisabled();
  await pending.click({ force: true });
  await expect.poll(() => state.requests).toBe(1);
  state.release?.();

  await expect(page.getByText('ログアウトできませんでした。もう一度お試しください')).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(loggedOutToast(page)).toHaveCount(0);
  expect(await hasSessionCookie(page)).toBe(true);
  expect(state.requests).toBe(1);

  // 再試行すると通常どおりログアウトする
  await expect(navLogout(page)).toBeEnabled();
  await navLogout(page).click();
  await expectLoggedOutOnLoginPage(page);
  expect(state.requests).toBe(2);
});

test('作成ダイアログの準備中・表示中はログアウトできず、ログアウト後は古いダイアログが/loginを覆わない', async ({ page }) => {
  const me = await loginableUser('ダイアログ中');
  await login(page, me);

  // 下書きの準備（ログアウト以外のAction）を保留し、準備中もログアウトを止める
  const hold = { active: true, release: null as null | (() => void) };
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (hold.active && request.method() === 'POST' && request.headers()['next-action'] && !isLogoutRequest(route)) {
      hold.active = false;
      await new Promise<void>((resolve) => (hold.release = resolve));
    }
    return route.continue();
  });
  await launcher(page).click();
  await expect(navLogout(page)).toBeDisabled();
  await expect.poll(() => hold.release !== null).toBe(true);
  hold.release?.();

  await expect(createDialog(page)).toBeVisible();
  await expect(navLogout(page)).toBeDisabled();
  await createDialog(page).getByRole('button', { name: '閉じる' }).click();
  await expect(createDialog(page)).toBeHidden();

  await expect(navLogout(page)).toBeEnabled();
  await navLogout(page).click();
  await expect(page).toHaveURL('/login');
  // ログアウト中・後は投稿ダイアログを開けず、戻る・進むでも残らない
  await expect(createDialog(page)).toHaveCount(0);
  await page.goBack();
  await expect(createDialog(page)).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL('/login');
  await expect(createDialog(page)).toHaveCount(0);
});

test('幅375pxとPC幅でナビのログアウトが見え、横スクロールせず、キーボードで操作できる', async ({ page }) => {
  const me = await loginableUser('レイアウト確認');
  await login(page, me);

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    for (const path of ['/', `/profile/${me.displayId}`, '/favorites']) {
      await page.goto(path);
      await expect(navLogout(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.goto(`/profile/${me.displayId}`);
    await expect(profileLogout(page)).toBeVisible();
  }

  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  await navLogout(page).focus();
  await page.keyboard.press('Enter');
  await expectLoggedOutOnLoginPage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
