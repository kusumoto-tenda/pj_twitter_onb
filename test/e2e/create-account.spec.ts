import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { deleteUsersByDisplayIds, requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';

const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const created: string[] = [];

function newDisplayId(prefix = 'E') {
  const id = uniqueDisplayId(prefix);
  created.push(id);
  return id;
}

async function countUsers(displayId: string): Promise<number> {
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM twitter.users WHERE lower(display_id) = ${displayId.toLowerCase()}
  `;
  return count;
}

async function fillSignIn(
  page: Page,
  { displayId, name = 'E2E太郎', bio = '', password = 'password123' }: {
    displayId: string;
    name?: string;
    bio?: string;
    password?: string;
  },
) {
  await page.goto('/signin');
  await page.getByLabel('ユーザーID').fill(displayId);
  await page.getByLabel('名前').fill(name);
  await page.getByLabel('自己紹介（任意）').fill(bio);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'アカウントを作成' }).click();
}

test.afterEach(async () => {
  await deleteUsersByDisplayIds(sql, created.splice(0));
});

test.afterAll(async () => {
  await sql.end();
});

test('有効な入力で登録するとログイン済みでメイン画面に移動し、成功通知を3秒表示する', async ({ page }) => {
  const displayId = newDisplayId();

  await fillSignIn(page, { displayId, name: 'E2E太郎', bio: 'よろしく' });

  await expect(page).toHaveURL('/');
  const toast = page.getByRole('status').filter({ hasText: 'アカウントを作成しました' });
  await expect(toast).toBeVisible();
  await expect(page.getByLabel('ログイン中のユーザー')).toContainText('E2E太郎');
  await expect(page.getByLabel('ログイン中のユーザー')).toContainText(`@${displayId}`);
  await expect(toast).toBeHidden({ timeout: 4_000 });

  // パスワードは平文で保存されていない。
  const [row] = await sql`SELECT password_hash, bio FROM twitter.users WHERE display_id = ${displayId}`;
  expect(row.password_hash).not.toContain('password123');
  expect(row.bio).toBe('よろしく');

  // 再読込後もサーバー側で同じ利用者として認証され、通知は再表示しない。
  await page.reload();
  await expect(page.getByLabel('ログイン中のユーザー')).toContainText(`@${displayId}`);
  await page.waitForTimeout(500);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('入力違反では画面に留まり、項目エラーと失敗通知を表示して保存しない', async ({ page }) => {
  const displayId = 'ab';

  await fillSignIn(page, { displayId, name: '', password: 'short' });

  const toast = page.getByRole('alert').filter({ hasText: 'アカウントの作成に失敗しました' });
  await expect(toast).toBeVisible();
  await expect(page).toHaveURL('/signin');
  await expect(page.getByLabel('ユーザーID')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('ユーザーIDは5文字以上15文字以下で入力してください')).toBeVisible();
  await expect(page.getByText('名前を入力してください')).toBeVisible();
  await expect(page.getByText('パスワードは8文字以上50文字以下で入力してください')).toBeVisible();
  await expect(page.getByLabel('パスワード')).toHaveValue('');
  expect(await countUsers(displayId)).toBe(0);
  await expect(toast).toBeHidden({ timeout: 4_000 });
});

test('大文字小文字だけが違うIDは重複としてID欄にエラーを表示する', async ({ browser }) => {
  const displayId = newDisplayId('Dup');

  const first = await browser.newContext();
  await fillSignIn(await first.newPage(), { displayId });
  await expect((await first.pages())[0]).toHaveURL('/');
  await first.close();

  const second = await browser.newContext();
  const page = await second.newPage();
  await fillSignIn(page, { displayId: displayId.toLowerCase() });

  await expect(page.getByRole('alert').filter({ hasText: 'アカウントの作成に失敗しました' })).toBeVisible();
  await expect(page.getByText('このユーザーIDは既に使われています')).toBeVisible();
  await expect(page).toHaveURL('/signin');
  expect(await countUsers(displayId)).toBe(1);
  await second.close();
});

test('作成済みのアカウントでログイン画面からログインできる', async ({ browser, page }) => {
  const displayId = newDisplayId('L');
  const signup = await browser.newContext();
  await fillSignIn(await signup.newPage(), { displayId, name: 'ログイン花子' });
  await expect((await signup.pages())[0]).toHaveURL('/');
  await signup.close();

  await page.goto('/signin');
  await page.getByRole('link', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('ユーザーID').fill(displayId.toUpperCase());
  await page.getByLabel('パスワード').fill('wrong-password');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'ユーザーIDまたはパスワードが違います' }),
  ).toBeVisible();

  await page.getByLabel('パスワード').fill('password123');
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByLabel('ログイン中のユーザー')).toContainText('ログイン花子');
});
