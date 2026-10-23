# メイン画面 Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、下記タスクを1挙動ずつRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` でDB上の投稿・リツイートを新しい順に表示し、ログイン中は `/?follow=true` で自分とフォロー中ユーザーの投稿・リツイートへ絞り込める。

**Architecture:** applicationに読み取り専用のTimelineQueryポートと一覧取得ユースケースを置き、infraでPostgreSQLのJOIN・UNION・ページングを実装する。appは認証済み利用者とURL条件を取得し、ユースケースの結果を表示する。投稿・フォロー・リツイートを変更するユースケースは別計画とする。

**Tech Stack:** 既存のNext.js 16.4.2、React 19.3.1、TypeScript、postgres、Auth.js、Vitest、Testing Library、Playwright。新しいパッケージや外部サービスは追加しない。

**Status:** 実装前の計画。ユーザーが範囲「1：タイムラインの実データ表示・フォロー絞り込みまで」を選択済み。アプリコード・DBにはまだ変更を加えない。

---

## 1. 根拠と対象範囲

参照資料：

- `docs/front/メイン画面.png`：左ナビゲーション、最新ツイート、フォローのみ、投稿カード。
- `docs/front_design.md`：メイン画面は `/` と `/?follow=true`。
- `docs/functions.md`：自分とフォロー中ユーザーの投稿・リツイートを新しい順に表示。
- `docs/ER_diagram.drawio`：User・Tweet・Follow・Retweetの属性と関連。

現在は `app/page.tsx` に認証済み利用者の表示と未ログイン時のログイン・登録導線だけがある。DBには `twitter.users` だけがあり、タイムラインの永続化モデルと取得処理は未実装。

今回含めるもの：

- DBの実データによる投稿・リツイートの読み取り。
- 全体一覧と、自分＋フォロー中の絞り込み。
- 投稿者、ユーザーID、本文、日時、リツイートした人の表示。
- 空一覧、取得失敗、初回読み込み、20件単位のページ送り。
- 未ログイン時の公開一覧とログイン・登録への導線。
- 画面案を基にしたPC・375pxのレイアウト。
- 登録成功通知、ログイン後の利用者表示、既存認証フローの維持。

今回含めないもの：

- 投稿作成・編集・削除、画像の投稿・配信、画像カードの表示。
- お気に入り・いいね・リツイート・フォローの追加／解除。
- プロフィール画面、お気に入り一覧、アカウント削除、ログアウト。
- 無限スクロール、自動更新、検索、ハッシュタグ・メンションのリンク化。

初回はテキスト投稿の一覧を完成させる。画像の永続化・配信先はまだ決まっていないため、画像対応は画像投稿の計画で扱う。書き込み用の未使用Repositoryや、将来用の操作APIは先に作らない。

## 2. 資料を補完する判断

### 表示範囲と認証

1. 画面案のチェックボックスに合わせ、通常の `/` は全利用者の公開投稿・リツイートを表示する。
2. `/?follow=true` は、自分とフォロー中ユーザーが行った投稿・リツイートを表示する。自分の投稿は常に含める。
3. リツイートの対象判定は、元投稿者ではなくリツイート実行者で行う。例えば、フォロー中Bが未フォローCの投稿をリツイートした場合、そのリツイートは表示する。
4. 未ログインでも通常一覧は閲覧可能。フォロー絞り込みはログインが必要。未ログインの画面には切り替えの代わりにログイン導線を表示し、直接 `/?follow=true` を開いた場合は `/login` へ移動する。
5. `follow` は単一の文字列 `'true'` のときだけ有効。欠落・`false`・別文字列・重複パラメータは全体一覧とする。
6. 利用者のUUIDはサーバー側のセッションから取り、UserRepositoryで実在を確認する。URLやClient Componentから渡されたUUIDは採用しない。
7. セッションが残っていても利用者が存在しなければ未ログインとして扱う。DB障害は「利用者が存在しない」「投稿0件」と区別し、取得失敗の表示にする。

### 投稿とリツイートの並び

- 通常投稿は投稿日時、リツイートはリツイート日時を一覧上の時刻として、新しい順に並べる。
- 更新日時で投稿を上に戻さない。
- リツイートには「○○さんがリツイート」と元投稿者・本文を表示する。
- 元投稿とリツイート、異なる利用者による同じ投稿のリツイートは別の出来事として表示する。今回、自動的な統合・重複排除は行わない。
- 同時刻では種類と出来事のUUIDで順番を固定する。ページ境界でもこの順序を使う。
- 本文はプレーンテキストで改行を保持し、HTMLとして解釈しない。長いURLや改行のない文字列でも横スクロールを出さない。
- 日時はサーバー描画とクライアント描画でずれないよう、初回は固定形式 `YYYY/MM/DD HH:mm`（Asia/Tokyo）と `<time dateTime>` で表示する。画面案の「〜分」は、資料に厳密指定がないため今回採用しない。

### 一覧の状態とページ送り

- 1ページ20件、21件取得して次ページの有無を判定する。
- 順番のキーは `(eventAt, kind, eventId)` の降順。カーソルより古い出来事を取得する。OFFSETによるページングは使わない。
- 「次の20件」と「最新に戻る」をリンクで表示する。次のページは一覧を置き換える方式。ブラウザの戻る操作で前ページへ戻れる。
- フォローの切り替えではカーソルを捨てて先頭へ戻る。次ページリンクはフォロー条件を保持する。
- カーソルは順番だけを表し、閲覧権限や利用者の識別には使わない。
- 空一覧：「まだ投稿がありません」。フォロー絞り込み時：「自分とフォロー中のユーザーの投稿はまだありません」。
- 取得失敗：「投稿を取得できませんでした。時間をおいて再度お試しください」と再試行ボタン。`router.refresh()` で現在のURL条件を保持して再取得し、単なる同一URLへのリンクで済ませない。再取得中はボタンを無効化する。DBの詳細は表示しない。
- 不正・長すぎるカーソルはDBに渡さず、条件を保った「最新に戻る」導線を表示する。通常の0件として扱わない。

### 画面案との関係

- 左ナビゲーション、見出し「最新ツイート」、フォローのみ、カードの並びを再現する。
- この段階ではホームだけを有効なナビゲーションにする。プロフィール・お気に入り・もっと見る・投稿など、遷移先や処理がない項目は表示しない。404リンクや押しても動かないボタンを作らない。
- カードの反応アイコン・編集メニューも、対応する操作の実装時に追加する。投稿者名はこの段階ではテキストとする。
- 375pxでは左ナビを上部のコンパクトなホーム導線にし、一覧を全幅で表示する。本文は折り返す。
- `aria-label="ログイン中のユーザー"` の領域と現在の名前・ID表示を維持し、既存E2Eが同一UUIDの認証継続を確認できるようにする。

## 3. 実装方式の比較

| 案 | 特徴 | 判断 |
| --- | --- | --- |
| 読み取り専用Query + Server Component | 必要な項目をSQLでまとめて取得。認証とURL条件をサーバーで処理できる | 推奨 |
| 各EntityのRepositoryを個別に呼び出して結合 | 行ごとの追加取得や複雑な結合処理がapplicationに増える | 今回は採用しない |
| クライアントfetch + 新しい一覧API | 自動更新や外部クライアントには使いやすいが、現段階ではAPIが増える | 必要になった時点で検討 |

読み取りポートはapplicationに置く。画面用の結合結果を返すために、書き込み用Tweet Entityや巨大な汎用Repositoryを作る必要はない。

## 4. 型と取得契約

`application/timeline/timeline.ts` に読み取りモデルを置く。Userの保存用型を流用せず、passwordHashを含まない公開項目だけを返す。

```ts
type TimelinePerson = { id: string; name: string; displayId: string };
type TimelineCursor = {
  eventAt: string; // UTC、DB精度を保持するタイムスタンプ
  kind: 'tweet' | 'retweet';
  eventId: string;
};
type TimelineItem = {
  key: TimelineCursor;
  tweet: {
    id: string;
    content: string;
    author: TimelinePerson;
    createdAt: string;
  };
  retweetedBy: TimelinePerson | null;
};
type TimelinePage = { items: TimelineItem[]; nextCursor: TimelineCursor | null };
interface TimelineQuery {
  findPage(input: {
    followingOnly: boolean;
    viewerId: string | null;
    after: TimelineCursor | null;
    limit: number;
  }): Promise<TimelinePage>;
}
```

`getTimeline` は固定limit=20でQueryを呼ぶ。followingOnlyかつviewerIdなしは `LOGIN_REQUIRED`、取得障害は `UNAVAILABLE`。ページの取得成功は `TimelinePage` として返す。Queryのthrowを0件へ変換しない。

カーソルのBase64urlエンコード・デコードは `app/lib/timeline-query.ts`。入力文字数上限512、JSONの形・日時・種類・UUIDを検証し、無効な値をSQLへ渡さない。日時は日付・時刻として有効かまで確認する。

**日時精度に注意：** PostgreSQLのマイクロ秒をJSのDateに変換してからカーソルへ戻すとページ境界がずれる。SQL側でUTC・小数秒6桁の文字列を返し、カーソルはその文字列を保持する。表示のためのDate変換と、比較用カーソルの値を分ける。

## 5. DBとSQL

新規migration `infra/db/migrations/002-create-timeline.sql` で次を追加する。既存001と `public` schemaには変更を加えない。

| テーブル | 列・制約 |
| --- | --- |
| `twitter.tweets` | id UUID PK、owner_id FK users、content TEXT NOT NULL（1〜280コードポイント）、created_at/updated_at TIMESTAMPTZ NOT NULL |
| `twitter.follows` | id UUID PK、follow_id FK users（フォローされる側）、follower_id FK users（する側）、created_at TIMESTAMPTZ、UNIQUE(follower_id,follow_id)、自己フォロー禁止 |
| `twitter.retweets` | id UUID PK、executor_id FK users、tweet_id FK tweets、created_at TIMESTAMPTZ、UNIQUE(executor_id,tweet_id) |

全てのcreated_atはNOT NULL。FKは利用者や投稿の削除に伴って関連行を削除できるようON DELETE CASCADEとする。これは削除機能の実装ではなく、関連行の整合性とテスト後片付けを保つため。画像投稿を追加する際には、本文1文字以上という今回のテキスト投稿用制約を、画像との組み合わせの要件に合わせて改める。

- tweetsには `(created_at DESC,id DESC)` と `(owner_id,created_at DESC,id DESC)`、retweetsには同様の日時・executor_idの索引を置く。followsの一意制約はfollower_idからの検索にも使う。
- 通常投稿のSELECTとリツイートのSELECTを同じ列へ揃え、`UNION ALL` でまとめる。
- フォロー絞り込みは各SELECTの「出来事の実行者 = viewerId または、viewerIdからその実行者へのfollowが存在する」にする。
- 元投稿者とリツイート実行者の公開情報をJOINで取得し、カードごとに別のユーザー照会をしない。
- 並び順とカーソル条件で同じ型・照合規則を使う。kindはDB内の固定数値（tweet=0、retweet=1）で順序を固定し、公開モデルへ変換する。UUIDの比較はUUID型で行う。
- `eventAt / kind / eventId` の辞書順で `after` より小さい行を21件取得し、最初の20件だけ返す。21件目は返さず、20件目のキーをnextCursorにする。
- 日時・UUID・絞り込み値は全てパラメータ化する。

## 6. ファイル配置

```text
Create:
  application/timeline/timeline.ts
  application/timeline/ports/timeline-query.ts
  application/timeline/get-timeline.ts
  infra/db/migrations/002-create-timeline.sql
  infra/queries/postgres-timeline-query.ts
  app/_composition/timeline.ts
  app/lib/timeline-query.ts
  app/ui/timeline/main-navigation.tsx
  app/ui/timeline/timeline-filter.tsx
  app/ui/timeline/tweet-card.tsx
  app/ui/timeline/timeline-list.tsx
  app/ui/timeline/timeline-pagination.tsx
  app/ui/timeline/timeline-retry.tsx
  app/loading.tsx
  test/support/timeline-fixtures.ts
  test/support/in-memory-timeline-query.ts
  test/unit/application/get-timeline.test.ts
  test/unit/app/timeline-query.test.ts
  test/unit/app/home-page.test.tsx
  test/unit/ui/timeline.test.tsx
  test/integration/postgres-timeline-query.test.ts
  test/e2e/main-screen.spec.ts

Modify:
  app/page.tsx
  test/support/test-db.ts
  README.md
  docs/front_design.md
```

`app/_composition/timeline.ts` はserver-onlyでQueryの具体実装を組み立てる。既存のアカウント用composition・auth・findAccountProfileは再利用する。既存の成功通知コンポーネントもそのまま利用する。

## 7. TDDタスク

Task 5の受け入れE2Eは、Task 3〜4の実装前に先に書いて失敗を確認する。各単体・結合テストも1挙動ずつ追加し、意図したRedを観測してから最小実装する。

### Task 1: 取得契約・ユースケース・URL条件

**Files:** `application/timeline/*`、`app/lib/timeline-query.ts`、対応するunitテストとin-memory Query。

- [x] `getTimeline` がviewerId・followingOnly・カーソル・limit=20をQueryに渡して結果を返すテストを書く。
- [x] followingOnlyでviewerIdがない場合はQueryを呼ばず `LOGIN_REQUIRED`、Queryの障害では `UNAVAILABLE` を返すテストを書く。
- [x] URLのfollowが単一の `'true'` の場合だけ絞り込みになることを、欠落・false・未知値・配列と対比してテストする。
- [x] カーソルの往復、上限長、壊れたBase64/JSON、無効な日時・UUID・kindを検証する。DB精度の小数秒6桁が往復して変わらないことを確認する。
- [x] フォローを切り替えるURLはカーソルを削除し、次ページURLはフォロー条件を保持するテストを書く。

代表ケース：

```ts
it('フォロー一覧にはログインが必要で、未認証ならDBを照会しない', async () => {
  const findPage = vi.fn();
  const result = await getTimeline(
    { query: { findPage } },
    { viewerId: null, followingOnly: true, after: null },
  );
  expect(result).toEqual({ ok: false, code: 'LOGIN_REQUIRED' });
  expect(findPage).not.toHaveBeenCalled();
});
```

Run: `pnpm exec vitest run --project unit test/unit/application/get-timeline.test.ts test/unit/app/timeline-query.test.ts`。

### Task 2: DB migrationと実Query

**Files:** `002-create-timeline.sql`、`infra/queries/postgres-timeline-query.ts`、`test/support/timeline-fixtures.ts`、`test/support/test-db.ts`、対応するintegrationテスト。

- [x] 専用DBにmigrationを適用し、通常投稿1件を公開情報付きで取得するテストからQueryを実装する。
- [x] 投稿・リツイートを混ぜ、出来事の日時の降順になることをテストする。古い投稿の新しいリツイートが上に来て、updated_atの変更では順序が変わらないことを確認する。
- [x] 自分A、フォロー中B、未フォローCを用意し、次の表の結果を実DBで検証する。

| 出来事 | 全体 | Aのフォロー一覧 |
| --- | --- | --- |
| Aの投稿 | 表示 | 表示 |
| Bの投稿 | 表示 | 表示 |
| Cの投稿 | 表示 | 非表示 |
| BがCの投稿をリツイート | 表示 | 表示 |
| CがBの投稿をリツイート | 表示 | 非表示 |
| AがCの投稿をリツイート | 表示 | 表示 |

- [x] フォロー0人でも自分の投稿・リツイートが表示されるテストを書く。
- [x] 同じ投稿の元投稿・複数リツイートが別イベントとして表示されることを確認する。
- [x] 21件以上、同一時刻の複数イベント、ミリ秒未満だけ異なる時刻を用意し、次ページとの重複・欠落がないことを検証する。kindの同時刻比較も含める。
- [x] 0件・20件ちょうど・21件のnextCursorを確認する。取得結果にpasswordHashが含まれないことを確認する。
- [x] 不正なFK、フォロー/リツイートの重複、自己フォローをDBが拒否することを確認する。
- [x] 後片付けはテスト自身の投稿・関係・利用者に限定する。既存のユーザーテストの削除処理がcascade追加後も成功することを確認する。

Run: `pnpm exec vitest run --project integration test/integration/postgres-timeline-query.test.ts`。

### Task 3: 投稿カード・フィルター・一覧状態

**Files:** `app/ui/timeline/*`、`test/unit/ui/timeline.test.tsx`。

- [x] 通常カードの名前・ID・本文・日時、リツイートカードの実行者表示をテストする。署名やハッシュなど不要なフィールドをpropsへ含めない。
- [x] 本文の改行を維持し、HTML風の文字列をDOMとして実行せず表示するテストを書く。
- [x] フォロー切り替えをラベル付きcheckboxで表現し、URL遷移で切り替える。未ログイン時はログインリンクを表示する。
- [x] 空一覧とフォロー中の空一覧のメッセージ、取得失敗と再試行ボタン、不正なカーソルの表示をテストする。再試行はrouter.refreshを呼び、pending中は二重実行を防ぐ。
- [x] 次ページがある時だけ「次の20件」を表示し、「最新に戻る」とともにURL条件が正しいことをテストする。
- [x] PCの左ナビと375pxのコンパクト表示、長い本文の折り返しを実装する。実寸はTask 5で確認し、class文字列をテストしない。

Run: `pnpm exec vitest run --project ui test/unit/ui/timeline.test.tsx`。

### Task 4: Server Componentへ接続

**Files:** `app/page.tsx`、`app/loading.tsx`、`app/_composition/timeline.ts`、`test/unit/app/home-page.test.tsx`。

- [x] 導入済みNext.jsガイドに従い、`searchParams` をPromiseとしてawaitする。
- [x] `auth()` と `findAccountProfile` から実在するviewerを決定し、URL条件と合わせてgetTimelineを呼ぶ。Queryの具体実装はcomposition rootだけで組み立てる。
- [x] 未ログインの全体一覧、ログイン中の全体/フォロー一覧、セッションだけ残った利用者、利用者照会のDB障害をテストする。
- [x] 未ログインでfollow=trueはQueryを呼ばず `/login` へredirect。redirectをtry/catchで握り潰さないことを確認する。
- [x] 不正なカーソルではQueryを呼ばず、絞り込みを保持した先頭リンクを表示する。
- [x] 一覧取得失敗は空表示へ変換せず、再試行導線を出す。認証情報やSQLエラーを画面に返さない。
- [x] AccountCreatedFlashとログイン中利用者の既存表示を維持する。読み取り中のloadingは一覧の骨格を示す。
- [x] 利用者ごとのフォロー一覧を共有キャッシュへ保存しない。auth/searchParamsを使った実行時取得とし、ビルド時のDB接続を前提にしない。

Run: `pnpm exec vitest run --project ui test/unit/app/home-page.test.tsx`。

### Task 5: メイン画面E2E

**Files:** `test/e2e/main-screen.spec.ts`、`test/support/timeline-fixtures.ts`。

- [x] UIの実装前に代表シナリオを書いてRedを確認する。fixtureは専用DBにSQLで投稿・follow・retweetを作り、未実装の投稿UIを前提にしない。
- [x] 未ログインで実データが新しい順に表示され、ログイン・登録へ移動できる。
- [x] ログイン後にフォロー切り替えでURLが `/?follow=true` になり、Task 2の表どおりに表示範囲が変わる。再読込・戻る操作でも条件を維持する。
- [x] 元投稿者とリツイート実行者が違うfixtureを使い、実行者のフォロー関係で絞り込まれることを確認する。
- [x] フォローの切り替えでページの先頭に戻り、次ページへ進むと同じイベントが重複せず、フォロー条件が残る。
- [x] 未ログインでfollow=trueへ直接アクセスすると `/login` に移動する。
- [x] 空のDB全体を仮定しない。全体一覧は今回のfixtureの相対的な並びを検証し、空一覧は隔離した利用者のフォロー一覧で確認する。本文・日時は一意なfixtureにし、既存データに依存しない。
- [x] DB障害は境界unitテストで再現し、E2E用の本番障害注入APIを作らない。
- [x] PC/375pxでナビ、切り替え、本文、ページ送りが操作できる。長い本文で横スクロールが出ない。キーボードでも操作できる。
- [x] 既存の登録・ログインE2E9件も通し、登録成功Toast・ログイン後の名前/ID・再読込後の認証を維持する。
- [x] fixtureの識別子だけを削除して接続を閉じる。PlaywrightのDB分離チェックとglobal setupをそのまま使う。

Run: `pnpm exec playwright test test/e2e/main-screen.spec.ts`、その後 `pnpm test:e2e`。

### Task 6: 全体検証・補完仕様の記録

**Files:** `README.md`、`docs/front_design.md`。

- [x] 通常一覧とフォロー一覧の違い、リツイートの時刻・実行者、ページ送り、未ログイン時の動作を記載する。
- [x] 今回はテキスト表示までで、投稿や反応・画像は別の計画であることを開発資料に記載する。画面内に実装の事情を説明する文言は足さない。
- [x] `pnpm test:unit`：登録・ログインの回帰を含め成功。
- [x] `pnpm test:integration`：新Queryと既存Repository/Hasherが専用DBで成功。
- [x] `pnpm typecheck`：エラーなし。
- [x] `pnpm build`：DBへのビルド時接続なしで成功。
- [x] `pnpm test:e2e`：専用DB・専用サーバーで全件成功。
- [x] 個人ごとの一覧が他利用者へ混ざらないこと、全体一覧の戻り値にパスワードやhashがないことを確認する。
- [x] migration後の索引と、カード件数に応じてSQL呼び出しが増えないことを確認する。
- [x] Task単位で変更ファイルを明示してコミットする。既存のログインブランチの扱いは実装開始時に作業状態を確認し、勝手にmerge/pushしない。

## 8. 実装前に読むローカルガイド

AGENTS.mdに従い、実装時点の導入済みNext.jsで以下を確認する。計画作成時はpageのsearchParamsと実行時取得の説明を確認済み。

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`

## 9. 完了条件

利用者がメイン画面で実データの投稿・リツイートを読み、フォロー条件を変え、過去の出来事へページ送りできる。新しい順・同時刻・ページ境界・リツイート実行者の絞り込みが正しく、空一覧と障害が区別される。既存の登録・ログインと通知が動作し続け、PC/375pxで閲覧・操作できる。
