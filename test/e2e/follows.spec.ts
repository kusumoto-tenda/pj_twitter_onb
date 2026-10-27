import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。followsテーブルは既存のものを使う。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';
const token = () => randomUUID().slice(0, 8);

const tracked: string[] = [];

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    { users: new PostgresUserRepository(sql), passwords: new ScryptPasswordHasher(), newId: randomUUID, now: () => new Date() },
    { name, displayId: uniqueDisplayId('Fo'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  tracked.push(id);
  return { id, name, displayId };
}

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

const profileHeader = (page: Page) => page.getByRole('region', { name: 'プロフィール' });
const followButton = (page: Page) => profileHeader(page).getByRole('button', { name: 'フォローする', exact: true });
const unfollowButton = (page: Page) => profileHeader(page).getByRole('button', { name: 'フォロー解除', exact: true });
const anyFollowButton = (page: Page) => profileHeader(page).getByRole('button', { name: /^フォロー(する|解除)$/ });
const countLink = (page: Page, name: string) => profileHeader(page).getByRole('link', { name, exact: true });
const followToggle = (page: Page) => page.getByRole('checkbox', { name: 'フォローのみ' });
const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });
const connectionNames = (page: Page, list: 'フォロー中のユーザー' | 'フォロワー') =>
  page.getByRole('list', { name: list }).getByRole('link');

async function followRows(where: { followerId?: string; followId?: string }) {
  return sql<{ id: string; follower_id: string; follow_id: string; created_at: Date }[]>`
    SELECT id, follower_id, follow_id, created_at FROM twitter.follows
    WHERE (${where.followerId ?? null}::uuid IS NULL OR follower_id = ${where.followerId ?? null}::uuid)
      AND (${where.followId ?? null}::uuid IS NULL OR follow_id = ${where.followId ?? null}::uuid)
    ORDER BY created_at, id
  `;
}

test.afterEach(async () => {
  const ids = tracked.splice(0);
  if (ids.length > 0) await sql`DELETE FROM twitter.users WHERE id = ANY(${ids}::uuid[])`;
  await fixtures.cleanup();
});

test.afterAll(async () => {
  await sql.end();
});

test('フォローすると人数・両側の一覧・フォローのみに反映し、解除しても相手から自分への逆方向は残る', async ({ page }) => {
  const me = await loginableUser('フォローする人');
  const target = await loginableUser('フォローされる人');
  const t = token();
  await post(target, `相手の投稿 ${t}`);
  // 相手は先に自分をフォローしている（相互フォローになる）
  const reverseId = await fixtures.follow(target, me);

  await login(page, me);
  await page.goto(`/profile/${target.displayId}`);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(countLink(page, '0 フォロワー')).toBeVisible();
  await expect(countLink(page, '1 フォロー')).toBeVisible();

  await followButton(page).click();
  await expect(unfollowButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(countLink(page, '1 フォロワー')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${target.displayId}`);
  const [created] = await followRows({ followerId: me.id, followId: target.id });
  expect(created).toBeDefined();
  expect((await followRows({ followerId: target.id, followId: me.id })).map((r) => r.id)).toEqual([reverseId]);

  // 対象のフォロワー一覧に自分、自分のフォロー一覧と人数に対象が出る
  await countLink(page, '1 フォロワー').click();
  await expect(page).toHaveURL(`/profile/${target.displayId}?tab=followers`);
  await expect(connectionNames(page, 'フォロワー')).toHaveText([new RegExp(me.name)]);
  await page.goto(`/profile/${me.displayId}`);
  await expect(countLink(page, '1 フォロー')).toBeVisible();
  await expect(countLink(page, '1 フォロワー')).toBeVisible();
  await expect(anyFollowButton(page)).toHaveCount(0);
  await countLink(page, '1 フォロー').click();
  await expect(connectionNames(page, 'フォロー中のユーザー')).toHaveText([new RegExp(target.name)]);

  await page.goto('/');
  await followToggle(page).check();
  await expect(page).toHaveURL('/?follow=true');
  await expect(card(page, `相手の投稿 ${t}`)).toBeVisible();

  await page.goto(`/profile/${target.displayId}?tab=followers`);
  await unfollowButton(page).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(countLink(page, '0 フォロワー')).toBeVisible();
  await expect(page.getByText('まだフォロワーはいません')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${target.displayId}?tab=followers`);
  expect(await followRows({ followerId: me.id })).toEqual([]);
  // 逆方向（相手→自分）の行は同じUUID・日時のまま残る
  expect((await followRows({ followerId: target.id, followId: me.id })).map((r) => r.id)).toEqual([reverseId]);

  await page.goto('/?follow=true');
  await expect(followToggle(page)).toBeChecked();
  await expect(card(page, `相手の投稿 ${t}`)).toHaveCount(0);
  await page.goto(`/profile/${me.displayId}`);
  await expect(countLink(page, '0 フォロー')).toBeVisible();
  await expect(countLink(page, '1 フォロワー')).toBeVisible();
});

test('解除後の再フォローは新しい関係として登録し、一覧の先頭に出る', async ({ page }) => {
  const me = await loginableUser('再フォロー');
  const older = await loginableUser('前からフォロー');
  const target = await loginableUser('再フォロー先');
  await fixtures.follow(me, older, new Date(Date.now() - 60_000).toISOString());

  await login(page, me);
  await page.goto(`/profile/${target.displayId}`);
  await followButton(page).click();
  await expect(unfollowButton(page)).toBeEnabled();
  const [first] = await followRows({ followerId: me.id, followId: target.id });
  await unfollowButton(page).click();
  await expect(followButton(page)).toBeEnabled();
  expect(await followRows({ followerId: me.id, followId: target.id })).toEqual([]);
  await followButton(page).click();
  await expect(unfollowButton(page)).toBeEnabled();
  const [again] = await followRows({ followerId: me.id, followId: target.id });
  expect(again.id).not.toBe(first.id);
  expect(again.created_at.getTime()).toBeGreaterThan(first.created_at.getTime());

  await page.goto(`/profile/${me.displayId}?tab=following`);
  await expect(connectionNames(page, 'フォロー中のユーザー')).toHaveText([new RegExp(target.name), new RegExp(older.name)]);
});

test('自分のプロフィールにはフォローの操作を出さない（URLの大小文字が違っても）', async ({ page }) => {
  const me = await loginableUser('自分');

  await login(page, me);
  for (const path of [`/profile/${me.displayId}`, `/profile/${me.displayId.toUpperCase()}`]) {
    await page.goto(path);
    await expect(profileHeader(page)).toContainText('自分のプロフィール');
    await expect(anyFollowButton(page)).toHaveCount(0);
  }
  expect(await followRows({ followerId: me.id })).toEqual([]);
});

test('未ログインでもボタンを表示し、押すと書き込まず「ログイン中のみフォローできます」を3秒表示してその場に留まる', async ({ page }) => {
  const target = await loginableUser('見られる人');

  await page.goto(`/profile/${target.displayId}?tab=followers`);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await followButton(page).click();

  const toast = page.getByRole('alert').filter({ hasText: 'ログイン中のみフォローできます' });
  await expect(toast).toBeVisible();
  await expect(page).toHaveURL(`/profile/${target.displayId}?tab=followers`);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(countLink(page, '0 フォロワー')).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect(await followRows({ followId: target.id })).toEqual([]);
});

test('画面を表示した後に別の利用者へ切り替えると、どちらの関係も変えない', async ({ page }) => {
  const a = await loginableUser('A');
  const b = await loginableUser('B');
  const c = await loginableUser('C');

  await login(page, a);
  await page.goto(`/profile/${c.displayId}`);
  await expect(followButton(page)).toBeEnabled();

  const other = await page.context().newPage();
  await page.context().clearCookies();
  await login(other, b);
  await followButton(page).click();

  await expect(page.getByRole('alert').filter({ hasText: 'ログイン中の利用者が変わりました' })).toBeVisible();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await followRows({ followId: c.id })).toEqual([]);
  expect(await followRows({ followerId: a.id })).toEqual([]);
  expect(await followRows({ followerId: b.id })).toEqual([]);
});

test('表示後に相手がユーザーIDを変え、旧IDを別人が使っても、表示した相手のUUIDをフォローする', async ({ page }) => {
  const me = await loginableUser('ID変更を見る人');
  const target = await loginableUser('IDを変える人');
  const oldDisplayId = target.displayId;

  await login(page, me);
  await page.goto(`/profile/${oldDisplayId}`);
  await expect(followButton(page)).toBeEnabled();

  const newDisplayId = uniqueDisplayId('Fn');
  await sql`UPDATE twitter.users SET display_id = ${newDisplayId} WHERE id = ${target.id}`;
  const reuserId = randomUUID();
  tracked.push(reuserId);
  await sql`
    INSERT INTO twitter.users (id, name, display_id, bio, password_hash, created_at)
    VALUES (${reuserId}, '旧IDを使う人', ${oldDisplayId.toUpperCase()}, '', 'fixture-hash', CURRENT_TIMESTAMP)
  `;

  await followButton(page).click();
  await expect.poll(async () => (await followRows({ followerId: me.id })).map((r) => r.follow_id)).toEqual([target.id]);
  expect(await followRows({ followId: reuserId })).toEqual([]);

  await page.goto(`/profile/${newDisplayId}`);
  await expect(unfollowButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(countLink(page, '1 フォロワー')).toBeVisible();
  await page.goto(`/profile/${oldDisplayId}`);
  await expect(profileHeader(page).getByRole('heading', { name: '旧IDを使う人' })).toBeVisible();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('フォローのみは自分の出来事を含めず、フォローした人が他人の投稿をリツイートした出来事を含み、解除した人の出来事を除く', async ({ page }) => {
  const me = await loginableUser('絞り込む人');
  const target = await loginableUser('フォローして解除する人');
  const stranger = await loginableUser('フォローしていない作者');
  const t = token();
  const strangerTweet = await post(stranger, `知らない人の投稿 ${t}`, -3_000);
  await post(me, `自分の投稿 ${t}`, -2_000);
  await fixtures.retweet(me, strangerTweet, new Date(Date.now() - 1_500).toISOString());
  await post(target, `相手の投稿 ${t}`, -1_000);
  await fixtures.retweet(target, strangerTweet, new Date().toISOString());

  await login(page, me);
  await page.goto(`/profile/${target.displayId}`);
  await followButton(page).click();
  await expect(unfollowButton(page)).toBeEnabled();

  await page.goto('/?follow=true');
  await expect(card(page, `相手の投稿 ${t}`)).toBeVisible();
  await expect(card(page, `知らない人の投稿 ${t}`).filter({ hasText: `${target.name}さんがリツイート` })).toBeVisible();
  await expect(card(page, `自分の投稿 ${t}`)).toHaveCount(0);
  await expect(card(page, `知らない人の投稿 ${t}`).filter({ hasText: `${me.name}さんがリツイート` })).toHaveCount(0);
  await expect(card(page, `知らない人の投稿 ${t}`).filter({ hasNotText: 'さんがリツイート' })).toHaveCount(0);

  await page.goto(`/profile/${target.displayId}`);
  await unfollowButton(page).click();
  await expect(followButton(page)).toBeEnabled();

  await page.goto('/?follow=true');
  await expect(card(page, `相手の投稿 ${t}`)).toHaveCount(0);
  await expect(card(page, `知らない人の投稿 ${t}`).filter({ hasText: `${target.name}さんがリツイート` })).toHaveCount(0);
  await expect(card(page, `自分の投稿 ${t}`)).toHaveCount(0);
  // 自分の出来事は全体の一覧には出る
  await page.goto('/');
  await expect(card(page, `自分の投稿 ${t}`)).toBeVisible();
});

test('幅375pxで横スクロールが出ず、キーボードでフォロー・解除でき、処理中は連打できない', async ({ page }) => {
  const me = await loginableUser('キーボード');
  const target = await loginableUser('キーボードの相手');

  await login(page, me);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`/profile/${target.displayId}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // 応答を遅らせ、処理中は押せないことを確かめる
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    return route.continue();
  });
  await followButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(anyFollowButton(page)).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(unfollowButton(page)).toBeEnabled();
  expect((await followRows({ followerId: me.id })).map((r) => r.follow_id)).toEqual([target.id]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await unfollowButton(page).focus();
  await page.keyboard.press('Space');
  await expect(followButton(page)).toBeEnabled();
  expect(await followRows({ followerId: me.id })).toEqual([]);
});
