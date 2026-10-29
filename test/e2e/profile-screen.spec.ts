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

let year = 3600 + Math.floor(Math.random() * 300);
const at = (minute: number, micro = 0) =>
  `${year}-01-01T00:${String(minute).padStart(2, '0')}:00.${String(micro).padStart(6, '0')}Z`;
const token = () => randomUUID().slice(0, 8);

async function loginableUser(name: string): Promise<TimelinePerson> {
  const result = await createAccount(
    {
      users: new PostgresUserRepository(sql),
      passwords: new ScryptPasswordHasher(),
      newId: randomUUID,
      now: () => new Date(),
    },
    { name, displayId: uniqueDisplayId('Pr'), bio: '', password: PASSWORD },
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

const profileHeader = (page: Page) => page.getByRole('region', { name: 'プロフィール' });
const tabLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'プロフィールのタブ' }).getByRole('link', { name, exact: true });

/** 表示中のカードのうち、指定した本文を含むものを表示順に返す。 */
async function visibleContents(page: Page, contents: string[]): Promise<string[]> {
  const texts = await page.getByRole('article').allTextContents();
  return texts.flatMap((text) => contents.filter((content) => text.includes(content)));
}

async function connectionNames(page: Page): Promise<string[]> {
  return page.getByRole('list', { name: /フォロー中のユーザー|フォロワー/ }).getByRole('link').allTextContents();
}

test.afterEach(async () => {
  await fixtures.cleanup();
  year += 1;
});

test.afterAll(async () => {
  await sql.end();
});

test('未ログインで他人の基本情報・投稿・リツイート・フォロワーを閲覧できる', async ({ page }) => {
  const t = token();
  const alice = await fixtures.user('アリス', 'Pa', {
    bio: `よろしくお願いします\n二行目 ${t}`,
    createdAt: '2026-10-23T15:30:00.000000Z',
  });
  const bob = await fixtures.user('ボブ');
  const carol = await fixtures.user('キャロル');
  await fixtures.follow(alice, bob);
  await fixtures.follow(bob, alice);
  await fixtures.follow(carol, alice);
  const own = `アリスの投稿 ${t}`;
  const bobs = `ボブの投稿 ${t}`;
  await fixtures.tweet(alice, own, at(1));
  const bobTweet = await fixtures.tweet(bob, bobs, at(2));
  await fixtures.retweet(alice, bobTweet, at(3));

  await page.goto(`/profile/${alice.displayId}`);

  const header = profileHeader(page);
  await expect(header.getByRole('heading', { name: 'アリス' })).toBeVisible();
  await expect(header).toContainText(`@${alice.displayId}`);
  await expect(header).toContainText(`二行目 ${t}`);
  await expect(header).toContainText('2026年10月24日から利用しています');
  await expect(header.getByRole('link', { name: '1 フォロー' })).toBeVisible();
  await expect(header.getByRole('link', { name: '2 フォロワー' })).toBeVisible();
  await expect(header).not.toContainText('自分のプロフィール');
  await expect.poll(() => visibleContents(page, [own, bobs])).toEqual([own]);

  await tabLink(page, 'リツイート').click();
  await expect(page).toHaveURL(`/profile/${alice.displayId}?tab=retweets`);
  await expect.poll(() => visibleContents(page, [own, bobs])).toEqual([bobs]);
  await expect(page.getByRole('article').first()).toContainText('アリスさんがリツイート');

  await header.getByRole('link', { name: '2 フォロワー' }).click();
  await expect(page).toHaveURL(`/profile/${alice.displayId}?tab=followers`);
  await expect.poll(() => connectionNames(page)).toEqual(
    expect.arrayContaining([expect.stringContaining('キャロル'), expect.stringContaining('ボブ')]),
  );

  await header.getByRole('link', { name: '1 フォロー' }).click();
  await expect(page).toHaveURL(`/profile/${alice.displayId}?tab=following`);
  await expect.poll(() => connectionNames(page)).toEqual([expect.stringContaining('ボブ')]);
});

test('メイン画面の投稿者・リツイート実行者のリンクから正しいプロフィールを開き、ホームに戻れる', async ({
  page,
}) => {
  const t = token();
  const author = await fixtures.user('元投稿者');
  const retweeter = await fixtures.user('拡散した人');
  const content = `拡散された投稿 ${t}`;
  const tweetId = await fixtures.tweet(author, content, at(1));
  await fixtures.retweet(retweeter, tweetId, at(2));

  await page.goto('/');
  const retweetCard = page.getByRole('article').filter({ hasText: content }).filter({
    hasText: 'さんがリツイート',
  });
  await retweetCard.getByRole('link', { name: '拡散した人' }).click();
  await expect(page).toHaveURL(`/profile/${retweeter.displayId}`);
  await expect(profileHeader(page).getByRole('heading', { name: '拡散した人' })).toBeVisible();

  await page.getByRole('link', { name: 'ホーム' }).click();
  await expect(page).toHaveURL('/');
  await retweetCard.getByRole('link', { name: '元投稿者' }).click();
  await expect(page).toHaveURL(`/profile/${author.displayId}`);
  await expect(profileHeader(page).getByRole('heading', { name: '元投稿者' })).toBeVisible();
});

test('ログイン中は自分のナビで自分、他人のカードで他人のプロフィールを開き、大小文字で取り違えない', async ({
  page,
}) => {
  const t = token();
  const me = await loginableUser('わたし');
  const friend = await fixtures.user('ともだち');
  await fixtures.follow(me, friend);
  await fixtures.tweet(friend, `ともだちの投稿 ${t}`, at(1));

  await login(page, me);
  await page.getByRole('link', { name: 'プロフィール', exact: true }).click();
  await expect(page).toHaveURL(`/profile/${me.displayId}`);
  await expect(profileHeader(page)).toContainText('自分のプロフィール');
  await expect(page.getByRole('link', { name: 'プロフィール', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.goto(`/profile/${me.displayId.toUpperCase()}`);
  await expect(profileHeader(page)).toContainText('自分のプロフィール');
  await expect(profileHeader(page)).toContainText(`@${me.displayId}`);

  await page.goto('/?follow=true');
  await page
    .getByRole('article')
    .filter({ hasText: `ともだちの投稿 ${t}` })
    .getByRole('link', { name: 'ともだち' })
    .click();
  await expect(page).toHaveURL(`/profile/${friend.displayId}`);
  await expect(profileHeader(page)).not.toContainText('自分のプロフィール');
  // フォロー済みの他人には、操作できる「フォロー解除」だけを出す
  await expect(profileHeader(page).getByRole('button')).toHaveCount(1);
  await expect(profileHeader(page).getByRole('button', { name: 'フォロー解除', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // 他人のページを見ていても、自分のナビは自分を指す
  await expect(page.getByRole('link', { name: 'プロフィール', exact: true })).toHaveAttribute(
    'href',
    `/profile/${me.displayId}`,
  );
});

test('タブ・ページ送りで対象と表示が一致し、再読み込みなしの戻る／進むでも一致する', async ({
  page,
}) => {
  const t = token();
  const subject = await fixtures.user('たくさん投稿');
  const other = await fixtures.user('別の人');
  const contents = Array.from({ length: 25 }, (_, i) => `投稿${String(i).padStart(2, '0')} ${t}`);
  await fixtures.tweets(subject, contents.map((content, i) => ({ content, createdAt: at(10, i) })));
  await fixtures.tweet(other, `別の人の投稿 ${t}`, at(11));
  const fans = await Promise.all(Array.from({ length: 21 }, (_, i) => fixtures.user(`ファン${String(i).padStart(2, '0')}`)));
  for (const [i, fan] of fans.entries()) await fixtures.follow(fan, subject, at(20, i));
  const newestFirst = [...contents].reverse();
  const watch = [...contents, `別の人の投稿 ${t}`];

  await page.goto(`/profile/${subject.displayId}`);
  await expect.poll(() => visibleContents(page, watch)).toEqual(newestFirst.slice(0, 20));
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(new RegExp(`/profile/${subject.displayId}\\?cursor=`));
  await expect.poll(() => visibleContents(page, watch)).toEqual(newestFirst.slice(20));
  await expect(profileHeader(page).getByRole('heading', { name: 'たくさん投稿' })).toBeVisible();

  await page.goBack();
  await expect.poll(() => visibleContents(page, watch)).toEqual(newestFirst.slice(0, 20));
  await page.goForward();
  await expect.poll(() => visibleContents(page, watch)).toEqual(newestFirst.slice(20));

  await profileHeader(page).getByRole('link', { name: '21 フォロワー' }).click();
  await expect(page).toHaveURL(`/profile/${subject.displayId}?tab=followers`);
  await expect.poll(async () => (await connectionNames(page)).length).toBe(20);
  const firstPage = await connectionNames(page);
  await page.getByRole('link', { name: '次の20件' }).click();
  await expect(page).toHaveURL(/tab=followers/);
  await expect.poll(async () => (await connectionNames(page)).length).toBe(1);
  const secondPage = await connectionNames(page);
  expect(new Set([...firstPage, ...secondPage]).size).toBe(21);

  await page.goBack();
  await expect.poll(async () => (await connectionNames(page)).length).toBe(20);
  await tabLink(page, 'ツイート').click();
  await expect(page).toHaveURL(`/profile/${subject.displayId}`);
  await expect(tabLink(page, 'ツイート')).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page).toHaveURL(/tab=followers/);
  await expect(tabLink(page, 'ツイート')).not.toHaveAttribute('aria-current', 'page');
});

test('未登録・形式違反のIDは見つからない表示、投稿のない利用者は空一覧、不正カーソルは先頭へ戻れる', async ({
  page,
}) => {
  const quiet = await fixtures.user('しずか');

  for (const id of ['Nobody_zz9', '@bad']) {
    await page.goto(`/profile/${encodeURIComponent(id)}`);
    await expect(page.getByText('このユーザーは見つかりませんでした')).toBeVisible();
    await expect(page.getByRole('link', { name: 'ホームに戻る' })).toHaveAttribute('href', '/');
  }

  await page.goto(`/profile/${quiet.displayId}`);
  await expect(profileHeader(page).getByRole('heading', { name: 'しずか' })).toBeVisible();
  await expect(page.getByText('まだ投稿がありません')).toBeVisible();

  await page.goto(`/profile/${quiet.displayId}?tab=retweets&cursor=broken!!`);
  await expect(profileHeader(page).getByRole('heading', { name: 'しずか' })).toBeVisible();
  await page.getByRole('link', { name: '最新に戻る' }).click();
  await expect(page).toHaveURL(`/profile/${quiet.displayId}?tab=retweets`);
  await expect(page.getByText('まだリツイートがありません')).toBeVisible();
});

test('幅375pxとPC幅で操作でき、長いbioでも横スクロールせず、キーボードでリンクを辿れる', async ({
  page,
}) => {
  const t = token();
  const subject = await fixtures.user('レイアウト確認', 'Pa', {
    bio: `${'a'.repeat(160)}`,
  });
  await fixtures.tweet(subject, `https://example.com/${'x'.repeat(200)} ${t}`, at(1));

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/profile/${subject.displayId}`);
    await expect(profileHeader(page).getByRole('heading', { name: 'レイアウト確認' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(tabLink(page, 'リツイート')).toBeVisible();
    await expect(profileHeader(page).getByRole('link', { name: '0 フォロワー' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }

  await tabLink(page, 'リツイート').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/profile/${subject.displayId}?tab=retweets`);
});
