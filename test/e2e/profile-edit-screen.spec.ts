import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import type { TimelinePerson } from '@/application/timeline/timeline';
import { createAccount } from '@/application/users/create-account';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/security/scrypt-password-hasher';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。後片付けは内部UUIDで行うため、ID変更後も削除できる。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';

let year = 4200 + Math.floor(Math.random() * 300);
const at = (minute: number) => `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.000000Z`;

async function loginableUser(name: string, bio = ''): Promise<TimelinePerson> {
  const result = await createAccount(
    {
      users: new PostgresUserRepository(sql),
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    },
    { name, displayId: uniqueDisplayId('Pe'), bio, password: PASSWORD },
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

/** ログインし、メイン画面への移動まで待つ。 */
async function login(page: Page, displayId: string) {
  await submitLogin(page, displayId);
  await expect(page).toHaveURL('/');
}

async function dbRow(id: string) {
  const [row] = await sql`SELECT name, display_id, bio FROM twitter.users WHERE id = ${id}`;
  return row;
}

const header = (page: Page) => page.getByRole('region', { name: 'プロフィール' });
const saveButton = (page: Page) => page.getByRole('button', { name: '保存', exact: true });

test.afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

test.afterAll(async () => {
  await sql.end();
});

test('自分の編集リンクから3項目を保存すると、新しいIDのプロフィールへ移動して3秒通知し、各画面に反映される', async ({
  page,
}) => {
  const me = await loginableUser('編集前の名前', '編集前の自己紹介');
  const fan = await fixtures.user('ファン');
  await fixtures.follow(fan, me);
  const content = `編集する人の投稿 ${randomUUID().slice(0, 8)}`;
  await fixtures.tweet(me, content, at(1));
  const newId = uniqueDisplayId('Nw');

  await login(page, me.displayId);
  // 更新前の表示を事前に訪問しておく
  await expect(page.getByRole('article').filter({ hasText: content })).toContainText('編集前の名前');
  await page.getByRole('link', { name: 'プロフィール', exact: true }).click();
  await expect(header(page)).toContainText('編集前の名前');

  await header(page).getByRole('link', { name: 'プロフィール編集' }).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}/edit`);
  await expect(page.getByLabel('名前')).toHaveValue('編集前の名前');
  await expect(page.getByLabel('ユーザーID')).toHaveValue(me.displayId);
  await expect(page.getByLabel('自己紹介')).toHaveValue('編集前の自己紹介');

  await page.getByLabel('名前').fill('編集後の名前');
  await page.getByLabel('ユーザーID').fill(newId);
  await page.getByLabel('自己紹介').fill('編集後の\n自己紹介');
  await saveButton(page).click();

  await expect(page).toHaveURL(`/profile/${newId}`);
  const toast = page.getByRole('status').filter({ hasText: 'プロフィールを更新しました' });
  await expect(toast).toBeVisible();
  await expect(header(page)).toContainText('編集後の名前');
  await expect(header(page)).toContainText(`@${newId}`);
  await expect(header(page)).toContainText('自分のプロフィール');
  await expect(toast).toBeHidden({ timeout: 4_000 });
  expect(await dbRow(me.id)).toEqual({ name: '編集後の名前', display_id: newId, bio: '編集後の\n自己紹介' });

  // 再読み込みしても同じ利用者としてログイン済みで、通知は再表示しない
  await page.reload();
  await expect(header(page)).toContainText('自分のプロフィール');
  await page.waitForTimeout(500);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'プロフィール', exact: true })).toHaveAttribute('href', `/profile/${newId}`);

  // ホームから再訪しても古い名前・IDが残らない
  await page.getByRole('link', { name: 'ホーム' }).click();
  await expect(page).toHaveURL('/');
  const card = page.getByRole('article').filter({ hasText: content });
  await expect(card).toContainText('編集後の名前');
  await expect(card.getByRole('link', { name: '編集後の名前' })).toHaveAttribute('href', `/profile/${newId}`);
  await expect(page.getByLabel('ログイン中のユーザー')).toContainText(`@${newId}`);

  // 戻る／進むでも古い名前を表示しない
  await page.goBack();
  await expect(page.locator('body')).not.toContainText('編集前の名前');
  await page.goForward();
  await expect(page).toHaveURL('/');
  await expect(page.locator('body')).not.toContainText('編集前の名前');

  // フォロワー側のフォロー一覧も新しい名前・IDを指す
  await page.goto(`/profile/${fan.displayId}?tab=following`);
  await expect(page.getByRole('link', { name: /編集後の名前/ })).toHaveAttribute('href', `/profile/${newId}`);

  // 旧IDのプロフィールは見つからない
  await page.goto(`/profile/${me.displayId}`);
  await expect(page.getByText('このユーザーは見つかりませんでした')).toBeVisible();
});

test('新しいIDと元のパスワードでログインでき、旧IDでは同じ利用者としてログインできない', async ({
  page,
  browser,
}) => {
  const me = await loginableUser('ID変更');
  const newId = uniqueDisplayId('Lg');

  await login(page, me.displayId);
  await page.goto(`/profile/${me.displayId}/edit`);
  await page.getByLabel('ユーザーID').fill(newId);
  await saveButton(page).click();
  await expect(page).toHaveURL(`/profile/${newId}`);

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await submitLogin(other, me.displayId);
  await expect(
    other.getByRole('alert').filter({ hasText: 'ユーザーIDまたはパスワードが違います' }),
  ).toBeVisible();
  await login(other, newId);
  await expect(other.getByLabel('ログイン中のユーザー')).toContainText(`@${newId}`);
  await fresh.close();
});

test('入力違反・他人のIDとの重複では画面に留まり、欄エラーと入力値を表示してDBを変えない', async ({
  page,
}) => {
  const me = await loginableUser('重複確認', '元の自己紹介');
  const other = await loginableUser('ほかの人');
  const before = await dbRow(me.id);

  await login(page, me.displayId);
  await page.goto(`/profile/${me.displayId}/edit`);
  await page.getByLabel('名前').fill('');
  await page.getByLabel('ユーザーID').fill('ab');
  await saveButton(page).click();
  await expect(page.getByLabel('名前')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('ユーザーID')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(`/profile/${me.displayId}/edit`);
  await expect(page.getByLabel('ユーザーID')).toHaveValue('ab');

  await page.getByLabel('名前').fill('変更したい名前');
  await page.getByLabel('ユーザーID').fill(other.displayId.toUpperCase());
  await page.getByLabel('自己紹介').fill('変更したい自己紹介');
  await saveButton(page).click();
  await expect(page.getByText('このユーザーIDは既に使われています')).toBeVisible();
  await expect(page).toHaveURL(`/profile/${me.displayId}/edit`);
  await expect(page.getByLabel('名前')).toHaveValue('変更したい名前');
  await expect(page.getByLabel('自己紹介')).toHaveValue('変更したい自己紹介');
  expect(await dbRow(me.id)).toEqual(before);
});

test('IDを変えずに保存・大小文字だけの変更・bioのクリアができ、キャンセルでは保存しない', async ({
  page,
}) => {
  const me = await loginableUser('キャンセル確認', '消す自己紹介');

  await login(page, me.displayId);
  await page.goto(`/profile/${me.displayId}/edit`);
  await page.getByLabel('名前').fill('保存しない名前');
  await page.getByRole('link', { name: '編集をキャンセル' }).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  expect((await dbRow(me.id)).name).toBe('キャンセル確認');

  await page.goto(`/profile/${me.displayId}/edit`);
  await page.getByLabel('自己紹介').fill('');
  await saveButton(page).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  expect(await dbRow(me.id)).toMatchObject({ display_id: me.displayId, bio: '' });

  const upper = me.displayId.toUpperCase();
  await page.goto(`/profile/${me.displayId}/edit`);
  await page.getByLabel('ユーザーID').fill(upper);
  await saveButton(page).click();
  await expect(page).toHaveURL(`/profile/${upper}`);
  await expect(header(page)).toContainText(`@${upper}`);
  expect((await dbRow(me.id)).display_id).toBe(upper);
});

test('未ログインで編集URLはログイン画面、他人の編集URLは見つからない表示になる', async ({ page }) => {
  const me = await loginableUser('わたし');
  const other = await fixtures.user('他人');

  await page.goto(`/profile/${me.displayId}/edit`);
  await expect(page).toHaveURL('/login');

  await login(page, me.displayId);
  await page.goto(`/profile/${other.displayId}/edit`);
  await expect(page.getByText('このユーザーは見つかりませんでした')).toBeVisible();
  await page.goto(`/profile/${other.displayId}`);
  await expect(header(page).getByRole('link', { name: 'プロフィール編集' })).toHaveCount(0);
});

test('幅375pxとPC幅で操作でき、Enterで保存できる', async ({ page }) => {
  const me = await loginableUser('レイアウト', 'あ'.repeat(160));

  await login(page, me.displayId);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/profile/${me.displayId}/edit`);
    for (const target of [
      page.getByRole('link', { name: '編集をキャンセル' }),
      saveButton(page),
      page.getByLabel('名前'),
      page.getByLabel('ユーザーID'),
      page.getByLabel('自己紹介'),
    ]) {
      await expect(target).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await page.getByLabel('名前').fill('Enterで保存');
  await page.getByLabel('名前').press('Enter');
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  await expect(header(page)).toContainText('Enterで保存');
});
