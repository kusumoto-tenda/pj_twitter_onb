import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { createAccount } from '@/application/usecases/users/create-account';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/external_services/auth/scrypt-password-hasher';
import { deleteUsersByDisplayIds, requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';

// マイグレーションは global setup で適用済み。ここではimport.meta.urlを使うモジュールを読まない。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const created: string[] = [];
const PASSWORD = 'password123';

/** 登録UIを通さず、実Repository・実Hasherで利用者を用意する。 */
async function createUser(name = 'ログイン太郎') {
  const displayId = uniqueDisplayId('Lg');
  created.push(displayId);
  const result = await createAccount(
    {
      users: new PostgresUserRepository(sql),
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    },
    { name, displayId, bio: '', password: PASSWORD },
  );
  if (!result.ok) throw new Error(`fixtureの作成に失敗しました: ${result.code}`);
  return result.account;
}

async function submitLogin(page: Page, displayId: string, password: string) {
  await page.getByLabel('ユーザーID').fill(displayId);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

const currentUser = (page: Page) => page.getByLabel('ログイン中のユーザー');
const loginError = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

test.afterEach(async () => {
  await deleteUsersByDisplayIds(sql, created.splice(0));
});

test.afterAll(async () => {
  await sql.end();
});

test('大小文字を変えたIDと正しいパスワードでログインし、再読込後も同じ利用者として表示される', async ({
  page,
}) => {
  const user = await createUser('ログイン太郎');

  await page.goto('/login');
  await submitLogin(page, user.displayId.toUpperCase(), PASSWORD);

  await expect(page).toHaveURL('/');
  await expect(currentUser(page)).toContainText('ログイン太郎');
  await expect(currentUser(page)).toContainText(`@${user.displayId}`);
  await page.reload();
  await expect(currentUser(page)).toContainText(`@${user.displayId}`);
});

test('未登録IDと誤パスワードは同じメッセージで、画面に留まりパスワードを空にする', async ({ page }) => {
  const user = await createUser();
  const message = 'ユーザーIDまたはパスワードが違います';

  await page.goto('/login');
  await submitLogin(page, uniqueDisplayId('No'), PASSWORD);
  await expect(loginError(page, message)).toBeVisible();
  await expect(page).toHaveURL('/login');
  await expect(page.getByLabel('パスワード')).toHaveValue('');

  await submitLogin(page, user.displayId, 'wrong-password');
  await expect(loginError(page, message)).toBeVisible();
  await expect(page).toHaveURL('/login');
  await expect(page.getByLabel('ユーザーID')).toHaveValue(user.displayId);
  await expect(page.getByLabel('パスワード')).toHaveValue('');
});

test('空欄・ID形式違反は該当欄にエラーを表示し、ログインしない', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'ログイン' }).click();

  await expect(page.getByLabel('ユーザーID')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('パスワード')).toHaveAttribute('aria-invalid', 'true');

  await submitLogin(page, '@bad id', PASSWORD);
  await expect(page.getByLabel('ユーザーID')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('ユーザーIDには半角英数字とアンダーバー（_）のみ使用できます')).toBeVisible();
  await expect(page).toHaveURL('/login');
  await expect(currentUser(page)).toHaveCount(0);
});

test('ログイン済みで /login を開くと / に戻り、新しいcontextではフォームをEnterで送信できる', async ({
  browser,
  page,
}) => {
  const user = await createUser('エンター花子');

  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(user.displayId);
  await page.getByLabel('パスワード').fill(PASSWORD);
  await page.getByLabel('パスワード').press('Enter');
  await expect(page).toHaveURL('/');

  await page.goto('/login');
  await expect(page).toHaveURL('/');
  await expect(currentUser(page)).toContainText('エンター花子');

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto('/login');
  await expect(other).toHaveURL('/login');
  await expect(other.getByRole('button', { name: 'ログイン' })).toBeVisible();
  await fresh.close();
});

test('幅375pxでは横スクロールなしで操作要素が見え、PC幅では右側ロゴを表示する', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login');

  for (const target of [
    page.getByLabel('ユーザーID'),
    page.getByLabel('パスワード'),
    page.getByRole('button', { name: 'ログイン' }),
    page.getByRole('link', { name: 'サインイン' }),
  ]) {
    await expect(target).toBeInViewport();
  }
  await expect(page.getByTestId('x-logo')).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('x-logo')).toBeVisible();
});
