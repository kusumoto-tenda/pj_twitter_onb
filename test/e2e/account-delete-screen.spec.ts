import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。後片付けは内部UUIDで行い、削除済みでも失敗しない。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';

let year = 4600 + Math.floor(Math.random() * 300);
const at = (minute: number) => `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.000000Z`;
const token = () => randomUUID().slice(0, 8);

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    {
      users: new PostgresUserRepository(sql),
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    },
    { name, displayId: uniqueDisplayId('Dx'), bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  const { id, displayId } = result.account;
  return fixtures.track({ id, name, displayId });
}

async function submitLogin(page: Page, displayId: string) {
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(displayId);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

async function login(page: Page, displayId: string) {
  await submitLogin(page, displayId);
  await expect(page).toHaveURL('/');
}

async function userExists(id: string) {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM twitter.users WHERE id = ${id}`;
  return count === 1;
}

const header = (page: Page) => page.getByRole('region', { name: 'プロフィール' });
const deleteButton = (page: Page) => page.getByRole('button', { name: 'アカウント削除' });
const navProfile = (page: Page) => page.getByRole('link', { name: 'プロフィール', exact: true });

test.afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

test.afterAll(async () => {
  await sql.end();
});

test('本人のリンクからパスワードを入力して削除すると、ログイン画面へ戻り3秒通知し、データが消える', async ({
  page,
}) => {
  const t = token();
  const me = await loginableUser('削除する人');
  const friend = await fixtures.user('残る友だち', 'Dx');
  const myContent = `削除される投稿 ${t}`;
  const friendContent = `残る投稿 ${t}`;
  await fixtures.tweet(me, myContent, at(1));
  await fixtures.tweet(friend, friendContent, at(2));
  await fixtures.follow(friend, me);
  await fixtures.follow(me, friend);

  await login(page, me.displayId);
  expect((await page.context().cookies()).some((c) => c.name.includes('session-token'))).toBe(true);
  // 削除前にホーム・プロフィール・フォロー一覧を訪問しておく
  await expect(page.getByRole('article').filter({ hasText: myContent })).toBeVisible();
  await page.goto(`/profile/${friend.displayId}?tab=following`);
  await expect(page.getByRole('link', { name: /削除する人/ })).toBeVisible();
  await navProfile(page).click();
  await header(page).getByRole('link', { name: 'アカウント削除' }).click();

  await expect(page).toHaveURL(`/profile/${me.displayId}/delete`);
  await expect(page.getByRole('heading', { name: 'パスワードを確認' })).toBeVisible();
  await expect(page.getByText('削除するとアカウント・投稿・フォロー関係・リツイートは元に戻せません')).toBeVisible();
  await expect(page.locator('main')).toContainText(`@${me.displayId}`);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await deleteButton(page).click();

  await expect(page).toHaveURL('/login');
  // Auth.jsのsignOutで、このブラウザの認証Cookieが無効化されている
  expect((await page.context().cookies()).some((c) => c.name.includes('session-token'))).toBe(false);
  const toast = page.getByRole('status').filter({ hasText: 'アカウントを削除しました' });
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect(await userExists(me.id)).toBe(false);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.getByRole('status').filter({ hasText: 'アカウントを削除しました' })).toHaveCount(0);

  // 戻る／進むでも削除した本人として表示しない
  await page.goBack();
  await expect(page.locator('body')).not.toContainText(myContent);
  await page.goForward();

  // 再ログインできず、本人としてプロフィール・編集・削除画面に入れない
  await submitLogin(page, me.displayId);
  await expect(
    page.getByRole('alert').filter({ hasText: 'ユーザーIDまたはパスワードが違います' }),
  ).toBeVisible();
  await page.goto(`/profile/${me.displayId}`);
  await expect(page.getByText('このユーザーは見つかりませんでした')).toBeVisible();
  for (const path of ['edit', 'delete']) {
    await page.goto(`/profile/${me.displayId}/${path}`);
    await expect(page).toHaveURL('/login');
  }

  // 他人のアカウント・投稿は残り、本人の投稿とフォロー関係は消える
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: friendContent })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: myContent })).toHaveCount(0);
  await page.goto(`/profile/${friend.displayId}`);
  await expect(header(page).getByRole('link', { name: '0 フォロー' })).toBeVisible();
  await expect(header(page).getByRole('link', { name: '0 フォロワー' })).toBeVisible();
});

test('戻る・空欄・誤パスワードではDBもログイン状態も変わらず、失敗後はパスワードだけ空になる', async ({
  page,
}) => {
  const me = await loginableUser('残す人');

  await login(page, me.displayId);
  await page.goto(`/profile/${me.displayId}/delete`);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByRole('link', { name: '戻る' }).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  expect(await userExists(me.id)).toBe(true);

  await page.goto(`/profile/${me.displayId}/delete`);
  await deleteButton(page).click();
  await expect(page.getByLabel('パスワード')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('パスワード').fill('wrong-password');
  await deleteButton(page).click();
  await expect(page.getByText('パスワードが違います')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${me.displayId}/delete`);
  await expect(page.getByLabel('パスワード')).toHaveValue('');
  expect(await userExists(me.id)).toBe(true);
  await expect(navProfile(page)).toHaveAttribute('href', `/profile/${me.displayId}`);
});

test('別のブラウザに残ったセッションは、削除後に実在確認で拒否される', async ({ page, browser }) => {
  const me = await loginableUser('二つのブラウザ');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await login(otherPage, me.displayId);
  await login(page, me.displayId);

  await page.goto(`/profile/${me.displayId}/delete`);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await deleteButton(page).click();
  await expect(page).toHaveURL('/login');

  await otherPage.goto(`/profile/${me.displayId}/edit`);
  await expect(otherPage).toHaveURL('/login');
  await otherPage.goto('/');
  await expect(otherPage.getByRole('link', { name: 'アカウントを作成' })).toBeVisible();
  await expect(otherPage.getByLabel('ログイン中のユーザー')).toHaveCount(0);
  await other.close();
});

test('未ログインで削除URLはログイン画面、他人の削除URLは見つからない表示で、他人には削除リンクを出さない', async ({
  page,
}) => {
  const me = await loginableUser('わたし');
  const stranger = await fixtures.user('他人', 'Dx');

  await page.goto(`/profile/${me.displayId}/delete`);
  await expect(page).toHaveURL('/login');

  await login(page, me.displayId);
  await page.goto(`/profile/${stranger.displayId}/delete`);
  await expect(page.getByText('このユーザーは見つかりませんでした')).toBeVisible();
  await page.goto(`/profile/${stranger.displayId}`);
  await expect(header(page).getByRole('link', { name: 'アカウント削除' })).toHaveCount(0);
  expect(await userExists(stranger.id)).toBe(true);
});

test('幅375pxとPC幅で操作でき、Enterで削除できる', async ({ page }) => {
  const me = await loginableUser('レイアウト確認');

  await login(page, me.displayId);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/profile/${me.displayId}/delete`);
    for (const target of [
      page.getByRole('heading', { name: 'パスワードを確認' }),
      page.getByLabel('パスワード'),
      page.getByRole('link', { name: '戻る' }),
      deleteButton(page),
    ]) {
      await expect(target).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByLabel('パスワード').press('Enter');
  await expect(page).toHaveURL('/login');
  expect(await userExists(me.id)).toBe(false);
});
