import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import type { TimelinePerson } from '@/application/dtos/timeline/timeline';
import { createAccount } from '@/application/usecases/users/create-account';
import { PostgresUserRepository } from '@/infra/persistence/postgres/repositories/postgres-user-repository';
import { ScryptPasswordHasher } from '@/infra/external_services/auth/scrypt-password-hasher';
import { requireTestDatabaseUrl, uniqueDisplayId } from '../support/test-db';
import { TimelineFixtures } from '../support/timeline-fixtures';

// マイグレーションは global setup で適用済み。
const sql = postgres(requireTestDatabaseUrl(), { max: 2, onnotice: () => {} });
const fixtures = new TimelineFixtures(sql);
const PASSWORD = 'password123';

// 既存データより新しく、テストごとに重ならない時刻を使う。
let year = 3000 + Math.floor(Math.random() * 500);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;
// 本文を一意にし、既存データと区別する。
const token = () => randomUUID().slice(0, 8);

/** ログインできる利用者を実Repository・実Hasherで作る。 */
async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    {
      users: new PostgresUserRepository(sql),
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    },
    { name, displayId: uniqueDisplayId('Ms'), bio: '', password: PASSWORD },
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

/**
 * 表示中のカードのうち、指定した本文を含むものを表示順に返す。
 * 読み込み表示から一覧へ切り替わるため、expect.pollで表示が揃うまで待って使う。
 */
async function visibleContents(page: Page, contents: string[]): Promise<string[]> {
  const texts = await page.getByRole('article').allTextContents();
  return texts.flatMap((text) => contents.filter((content) => text.includes(content)));
}

const followToggle = (page: Page) => page.getByRole('checkbox', { name: 'フォローのみ' });

test.afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

test.afterAll(async () => {
  await sql.end();
});

test('未ログインでも投稿・リツイートが新しい順に表示され、ログイン・登録へ移動できる', async ({
  page,
}) => {
  const t = token();
  const alice = await fixtures.user('アリス');
  const bob = await fixtures.user('ボブ');
  const first = `最初の投稿 ${t}`;
  const second = `次の投稿 ${t}`;
  const firstId = await fixtures.tweet(alice, first, at(1));
  await fixtures.tweet(bob, second, at(2));
  await fixtures.retweet(bob, firstId, at(3));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: '最新ツイート' })).toBeVisible();
  await expect.poll(() => visibleContents(page, [first, second])).toEqual([first, second, first]);
  const retweetCard = page.getByRole('article').filter({ hasText: 'ボブさんがリツイート' });
  await expect(retweetCard).toContainText(first);
  await expect(retweetCard).toContainText(`@${alice.displayId}`);
  await expect(followToggle(page)).toHaveCount(0);

  await page.getByRole('link', { name: 'ログイン' }).first().click();
  await expect(page).toHaveURL('/login');
  await page.goto('/');
  await page.getByRole('link', { name: 'アカウントを作成' }).click();
  await expect(page).toHaveURL('/signin');
});

test('未ログインで /?follow=true を開くと /login に移動する', async ({ page }) => {
  await page.goto('/?follow=true');

  await expect(page).toHaveURL('/login');
});

test('ログイン後のフォロー切り替えで、リツイート実行者のフォロー関係に従って絞り込まれる', async ({
  page,
}) => {
  const t = token();
  const a = await loginableUser('自分A');
  const b = await fixtures.user('フォロー中B');
  const c = await fixtures.user('未フォローC');
  await fixtures.follow(a, b);
  const contents = {
    a: `Aの投稿 ${t}`,
    b: `Bの投稿 ${t}`,
    c: `Cの投稿 ${t}`,
  };
  await fixtures.tweet(a, contents.a, at(1));
  const bTweet = await fixtures.tweet(b, contents.b, at(2));
  const cTweet = await fixtures.tweet(c, contents.c, at(3));
  await fixtures.retweet(b, cTweet, at(4)); // 表示（実行者Bをフォロー中）
  await fixtures.retweet(c, bTweet, at(5)); // 非表示（実行者Cは未フォロー）
  const all = Object.values(contents);

  await login(page, a);
  await expect(page.getByLabel('ログイン中のユーザー')).toContainText(`@${a.displayId}`);
  // 全体: Cのリツイート(B投稿)、BのリツイートC投稿、C、B、A
  await expect.poll(() => visibleContents(page, all)).toEqual([
    contents.b,
    contents.c,
    contents.c,
    contents.b,
    contents.a,
  ]);

  // 再読み込みせずに戻ると、チェックと一覧の両方が全体に戻る。
  await followToggle(page).check();
  await expect(page).toHaveURL('/?follow=true');
  await expect.poll(() => visibleContents(page, all)).toHaveLength(2);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(followToggle(page)).not.toBeChecked();
  await expect.poll(() => visibleContents(page, all)).toHaveLength(5);

  await followToggle(page).check();
  await expect(page).toHaveURL('/?follow=true');
  await expect(followToggle(page)).toBeChecked();
  // フォロー一覧: BのリツイートC投稿、B（自分Aの投稿は含めない）
  await expect.poll(() => visibleContents(page, all)).toEqual([contents.c, contents.b]);
  await expect(
    page.getByRole('article').filter({ hasText: 'フォロー中Bさんがリツイート' }),
  ).toContainText(contents.c);

  await page.reload();
  await expect(followToggle(page)).toBeChecked();
  await expect.poll(() => visibleContents(page, all)).toEqual([contents.c, contents.b]);

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(followToggle(page)).not.toBeChecked();
  await expect.poll(() => visibleContents(page, all)).toHaveLength(5);
});

test('ページ送りで重複なく次の20件へ進み、フォロー条件を保持し、切り替えで先頭に戻る', async ({
  page,
}) => {
  const t = token();
  const viewer = await loginableUser('ページ送り');
  // フォローのみには自分の投稿が出ないので、フォロー中の作者の投稿で確かめる
  const author = await fixtures.user('ページ送りの作者');
  await fixtures.follow(viewer, author);
  const contents = Array.from({ length: 25 }, (_, i) => `投稿${String(i).padStart(2, '0')} ${t}`);
  await fixtures.tweets(
    author,
    contents.map((content, i) => ({ content, createdAt: at(10, i) })),
  );
  const newestFirst = [...contents].reverse();

  await login(page, viewer);
  await page.goto('/?follow=true');
  await expect.poll(() => visibleContents(page, contents)).toEqual(newestFirst.slice(0, 20));
  await expect(page.getByRole('link', { name: '最新に戻る' })).toHaveCount(0);

  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/[?&]follow=true/);
  await expect(page).toHaveURL(/[?&]cursor=/);
  await expect.poll(() => visibleContents(page, contents)).toEqual(newestFirst.slice(20));
  await expect(page.getByRole('link', { name: '次の20件' })).toHaveCount(0);
  await expect(followToggle(page)).toBeChecked();

  await page.goBack();
  await expect.poll(() => visibleContents(page, contents)).toEqual(newestFirst.slice(0, 20));
  await page.goForward();
  await expect.poll(() => visibleContents(page, contents)).toEqual(newestFirst.slice(20));

  await page.getByRole('link', { name: '最新に戻る' }).click();
  await expect(page).toHaveURL('/?follow=true');

  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/cursor=/);
  await followToggle(page).uncheck();
  await expect(page).toHaveURL('/');
});

test('フォロー一覧が空なら空の表示、不正なカーソルなら最新に戻る導線を表示する', async ({
  page,
}) => {
  const isolated = await loginableUser('ひとり');
  // 自分の投稿があっても、フォロー中のユーザーがいなければ空の表示になる
  await fixtures.tweet(isolated, `ひとりの投稿 ${token()}`, at(1));

  await login(page, isolated);
  await page.goto('/?follow=true');
  await expect(page.getByText('フォロー中のユーザーの投稿はまだありません')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);

  await page.goto('/?follow=true&cursor=broken!!');
  const back = page.getByRole('link', { name: '最新に戻る' });
  await expect(back).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await back.click();
  await expect(page).toHaveURL('/?follow=true');
});

test('幅375pxとPC幅で、ナビ・切り替え・本文・ページ送りを操作でき、長い本文でも横スクロールしない', async ({
  page,
}) => {
  const t = token();
  const viewer = await loginableUser('レイアウト');
  // フォローのみで表示させるため、投稿はフォロー中の作者が行う
  const author = await fixtures.user('レイアウトの作者');
  await fixtures.follow(viewer, author);
  const longWord = `${'a'.repeat(200)}${t}`;
  const longUrl = `https://example.com/${'x'.repeat(150)}`;
  await fixtures.tweet(author, `${longUrl}\n改行のあと ${t}`, at(1));
  await fixtures.tweet(author, longWord, at(2));
  await fixtures.tweets(
    author,
    Array.from({ length: 20 }, (_, i) => ({ content: `埋め${i} ${t}`, createdAt: at(0, i) })),
  );

  await login(page, viewer);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?follow=true');
    await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(followToggle(page)).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: longWord.slice(0, 50) })).toBeVisible();
    await expect(page.getByRole('link', { name: '次の20件' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  // 改行は保持して表示する
  const multiLine = page.getByRole('article').filter({ hasText: '改行のあと' });
  expect(await multiLine.locator('p').first().evaluate((el) => (el as HTMLElement).innerText)).toContain(
    '\n改行のあと',
  );

  // キーボードで切り替えられる
  await page.goto('/');
  await followToggle(page).focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL('/?follow=true');
});
