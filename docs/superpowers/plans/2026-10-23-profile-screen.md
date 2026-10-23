# プロフィール画面 Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、各挙動をRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/profile/{ユーザーID}` で自分・他人の公開プロフィール、投稿・リツイート、フォロー／フォロワーを閲覧でき、メイン画面と相互に移動できる。

**Architecture:** applicationにプロフィール読み取りのQueryポートと取得ユースケースを置き、infraが既存のusers・tweets・follows・retweetsから公開情報を取得する。appはURL・認証状態・表示・ページ送りを担当する。既存の投稿カードとカーソルの精度対策を再利用する。

**Tech Stack:** 現在導入済みのNext.js、React、TypeScript、Auth.js、postgres、Vitest、Testing Library、Playwright。新しい依存やDBテーブルの追加は不要。

**Status:** 実装前の計画。ユーザー回答により「閲覧機能まで」で範囲確定。編集・フォロー操作・いいね等は別計画とする。今回の依頼ではアプリコードやDBを変更しない。

---

## 1. 資料と今回の範囲

根拠：`docs/functions.md`、`docs/front_design.md`、`docs/front/プロフィール画面(自分).png`、`docs/front/プロフィール画面(他人).png`、`docs/ER_diagram.drawio`。

| 今回実装するもの | 根拠・判断 |
| --- | --- |
| 名前・ユーザーID・bio・作成日の表示 | 機能一覧のプロフィール確認 |
| 自分・他人・未ログインでの閲覧 | 画面案2種類と、未ログインでも他人のフォロワーを閲覧できる要件 |
| 対象利用者の投稿一覧 | 機能一覧の利用者ごとのツイート表示 |
| 対象利用者のリツイート一覧 | 画面案のリツイートタブと既存データモデル |
| フォロー／フォロワー数と一覧 | 画面案の件数と、フォロワーを確認できる要件。件数から一覧へ移動する |
| 投稿者名・リツイート実行者・利用者一覧からのプロフィール導線 | 閲覧を実際に辿れるようにする |
| 自分のプロフィールへのナビゲーション | 既存のホーム導線に追加 |
| 0件・未登録ID・取得障害・不正カーソル・読み込み中の表示 | 今回の補完仕様 |

今回の対象外：プロフィール編集、フォロー／解除、いいね・お気に入り一覧、画像のアップロード・配信、投稿の編集・削除、ログアウト、鍵アカウント。画面案の画像はオプションなので追加しない。プロフィール編集ボタン・フォローボタン・未実装のタブは、その操作を実装する計画で追加する。

## 2. URLと画面の補完仕様

### 公開プロフィール

- `/profile/{displayId}` は未ログインでも閲覧可能。プロフィールを読むためのログインredirectは設けない。
- URLのIDは登録時と同じ形式で検証する。形式違反はDB照会前に `NOT_FOUND` とする。
- 検索は大小文字を区別しない。`/profile/ALICE_1` でも `Alice_1` が見つかり、表示と新たに生成するリンクでは保存済みの表記を使う。大文字小文字だけの差ではredirectしない。
- 自分かどうかは、DBから得た対象UUIDとサーバー側セッションのUUIDを比較する。URLのIDの綴りやクライアントのフラグでは判断しない。
- 名前・ID・bio・利用開始日を表示する。日付は `YYYY年MM月DD日から利用しています`（Asia/Tokyo）。空のbioは空の余白を作らず省略する。
- bioは改行を保持したプレーンテキスト。HTMLとして解釈せず、長いURLなども折り返す。自動リンク化は別対応。
- 自分の場合は「自分のプロフィール」と分かる補助表示を付ける。他人の場合、ログイン中の自分が対象をフォロー済みなら読み取り専用の「フォロー中」を表示する。操作ボタンとして表示しない。
- 未登録IDは `notFound()` を使って「このユーザーは見つかりませんでした」とホームへのリンクを表示する。DB障害は404へ変換しない。

### 投稿・リツイート・利用者一覧

| URL | 表示内容 |
| --- | --- |
| `/profile/{id}` | 対象者が作成した通常投稿のみ |
| `/profile/{id}?tab=retweets` | 対象者が実行したリツイートのみ |
| `/profile/{id}?tab=following` | 対象者がフォローしている利用者 |
| `/profile/{id}?tab=followers` | 対象者をフォローしている利用者 |

- 投稿タブに対象者のリツイートを混ぜない。画面案どおりリツイートタブへ分ける。
- 対象者の投稿を他人がリツイートした出来事は、対象者のリツイート一覧に含めない。
- 通常投稿は投稿日時、リツイートは実行日時の降順。リツイートカードは既存と同じく実行者と元投稿者を表示する。
- フォロー／フォロワー一覧は関係の作成日時・関係UUIDの降順。各行は名前・ユーザーIDとプロフィールリンクを表示する。bio全文やハッシュを付加しない。
- 一覧は全て20件単位。次ページの有無を21件取得で判定する。時刻・UUIDを使ったキーセット方式を採用する。
- 投稿／リツイートのカーソルには既存の `TimelineCursor` を使い、タブとkindが一致するか追加確認する。
- 利用者一覧のカーソルは `{ createdAt: string; relationId: string }`。フォローとフォロワーの向きをURL条件として維持する。
- カーソルは現在のタブ・対象プロフィールに結び付けた形式でエンコードし、他タブや他人のページへ持ち込まれた場合は不正カーソルとして扱う。カーソル自体を認証には使わない。
- タブ・件数リンクを切り替える際はカーソルを除去する。「次の20件」「最新に戻る」は対象IDと現在のタブを保持する。戻る／進むでも選択表示と一覧が一致する。
- 未知のtab・重複パラメータは通常投稿タブへ戻す。通常投稿のURLにはtabを付けない。
- 投稿0件、リツイート0件、フォロー0人、フォロワー0人でそれぞれ内容の分かる空表示を出す。対象者が存在すれば投稿0件でも404にしない。

### 件数・障害・レイアウト

- `follower_id = 対象UUID` がフォロー数、`follow_id = 対象UUID` がフォロワー数。両方の関係を同時JOINして件数を掛け合わせない。
- プロフィール全体の取得障害は「プロフィールを取得できませんでした」と再試行ボタン。存在しない利用者の表示と区別する。
- 一覧だけの取得障害では、取得済みのヘッダー・件数・タブを残し、一覧部分に再試行ボタンを表示する。件数を勝手に0にしない。
- 再試行は `router.refresh()`。現在のURLを保持し、処理中は二重操作を防ぐ。単なる同一URLリンクにしない。
- 不正カーソルは一覧部分で説明し、現在の対象・タブの先頭に戻るリンクを出す。DBに不正値を渡さない。
- PCではメイン画面と同じ左ナビ、375pxではコンパクトな上部ナビを使う。プロフィール専用のloadingを置き、ログイン・登録の遷移中にプロフィールの骨格を出さない。

## 3. 方式の比較と依存関係

| 方式 | 利点・負担 | 判断 |
| --- | --- | --- |
| プロフィール専用の読み取りQuery + 既存カード・共通レイアウト | 公開フィールドと取得項目を限定し、投稿・関係一覧をDB側でページングできる | 推奨 |
| 全体タイムラインを取得してJSで対象者を絞る | 20件に足りない・他人のデータが混ざる・ページ送りが壊れる | 採用しない |
| APIとクライアントfetchを追加 | 自動更新などへ拡張しやすいが、現在は公開API要件がない | 今回は不要 |

`app → application → 読み取りポート`、`infra → applicationの型・ポート` を守る。domainは既存のID検証ルールを再利用する。読み取り機能のための書き込み用Entity・Repositoryや変更APIは追加しない。

## 4. 読み取り契約

`application/profile/profile.ts` に以下を定義する。公開プロフィールの取得ではpassword_hashをSELECTしない。既存のログイン用UserRepositoryを画面用DTOとして露出しない。

```ts
type PublicPerson = { id: string; name: string; displayId: string };
type ProfileSummary = PublicPerson & {
  bio: string;
  createdAt: string;
  followingCount: number;
  followerCount: number;
  followedByViewer: boolean;
};
type ProfileTab = 'tweets' | 'retweets' | 'following' | 'followers';
type ConnectionCursor = { createdAt: string; relationId: string };
type ConnectionPage = {
  items: PublicPerson[];
  nextCursor: ConnectionCursor | null;
};
interface ProfileQuery {
  findSummary(input: { displayId: string; viewerId: string | null }): Promise<ProfileSummary | null>;
  findActivityPage(input: {
    subjectId: string;
    kind: 'tweet' | 'retweet';
    after: TimelineCursor | null;
    limit: number;
  }): Promise<TimelinePage>;
  findConnectionsPage(input: {
    subjectId: string;
    direction: 'following' | 'followers';
    after: ConnectionCursor | null;
    limit: number;
  }): Promise<ConnectionPage>;
}
```

ここでTimelineCursor/TimelinePageは既存のapplication/timelineの型をimportする。PublicPersonも既存のTimelinePersonと構造を揃え、必要なら型エイリアスで再利用する。

ユースケース：

- `getProfile`：IDの形式検証 → findSummary → 公開情報。結果は成功／`NOT_FOUND`／`UNAVAILABLE`。viewerIdはセッションから渡す。
- `getProfileActivity`：対象UUID・kind・カーソルを受け取り固定20件で取得。失敗は `UNAVAILABLE`。
- `getProfileConnections`：対象UUID・direction・カーソルを受け取り固定20件で取得。失敗は `UNAVAILABLE`。

ページはgetProfileの成功後だけ一覧を取得する。APIとしてクライアントからsubjectIdを受け取らず、URLを解決して得た対象UUIDを利用する。

### SQLと日時

- ヘッダーはユーザーの公開列＋方向ごとの独立したCOUNTサブクエリ＋viewerから対象へのEXISTSで取得する。COUNT結果は数値に変換する。
- 通常投稿は `tweets.owner_id = subjectId`、リツイートは `retweets.executor_id = subjectId`。元投稿者・実行者はJOINして1ページ1回のSQLで取得する。
- フォロー一覧は `follows.follower_id = subjectId` からfollow_id側usersへ、フォロワー一覧は `follows.follow_id = subjectId` からfollower_id側usersへJOINする。
- 一覧を1度全件取得してJSで切らない。limit+1とカーソル比較をSQLで行う。カードや利用者行ごとの追加SQLを発行しない。
- ミリ秒未満の時刻を保持するため、返すキーはDB側でUTC・小数秒6桁に整形し、境界値は `${value}::text::timestamptz` の形でパラメータ化する。JSのDateを経由させない。
- SQL値は全てパラメータ化。方向・kindを使ってクライアント由来の識別子をSQLへ直接連結しない。
- 既存002の索引を利用する。今回、新しいmigrationは作らず、開発・本番へのDB変更も不要。

## 5. ファイル構成

```text
Create:
  application/profile/profile.ts
  application/profile/ports/profile-query.ts
  application/profile/get-profile.ts
  application/profile/get-profile-activity.ts
  application/profile/get-profile-connections.ts
  infra/queries/postgres-profile-query.ts
  app/_composition/profile.ts
  app/lib/profile-query.ts
  app/lib/cursor-validation.ts
  app/profile/[displayId]/page.tsx
  app/profile/[displayId]/loading.tsx
  app/profile/[displayId]/not-found.tsx
  app/ui/layout/page-shell.tsx
  app/ui/profile/profile-header.tsx
  app/ui/profile/profile-tabs.tsx
  app/ui/profile/profile-activity-list.tsx
  app/ui/profile/profile-connections-list.tsx
  app/ui/profile/profile-retry.tsx
  test/support/in-memory-profile-query.ts
  test/unit/application/profile.test.ts
  test/unit/app/profile-query.test.ts
  test/unit/app/profile-page.test.tsx
  test/unit/ui/profile.test.tsx
  test/integration/postgres-profile-query.test.ts
  test/e2e/profile-screen.spec.ts

Modify:
  app/lib/timeline-query.ts
  app/(home)/layout-shell.tsx
  app/(home)/page.tsx
  app/ui/timeline/main-navigation.tsx
  app/ui/timeline/tweet-card.tsx
  test/unit/app/timeline-query.test.ts
  test/unit/app/home-page.test.tsx
  test/unit/ui/timeline.test.tsx
  test/support/timeline-fixtures.ts
  README.md
  docs/front_design.md
```

共通化は必要な範囲に限定する。

- `cursor-validation.ts` には既存の日時・UUID・Base64urlの検証を抽出する。年0000拒否、上限長、マイクロ秒の回帰を維持する。プロフィール用カーソルの対象／タブ検証はprofile-query側に置く。
- PageShellは既存HomeShellのレイアウトを抽出して利用する。HomeShellは互換wrapperとして残し、メイン画面の構造とloadingを維持する。
- MainNavigationは `activePage` と自分の `profileHref` を受け取る。ホームを常にaria-currentにしない。未ログインでは自分のプロフィールリンクを出さない。
- TweetCardの投稿者とリツイート実行者をプロフィールへのLinkに変える。URLは保存済みdisplayIdから生成し、自分のナビURLと閲覧対象のURLを混同しない。

## 6. TDDタスク

Task 5の代表E2EはTask 3〜4の実装前に作ってRedを確認する。各タスクも1挙動ずつ、失敗の観測 → 最小実装 → 全件成功 → 必要な整理の順で進める。

### Task 1: 公開プロフィール取得とURL条件

**Files:** `application/profile/*`、`app/lib/{profile-query,cursor-validation,timeline-query}.ts`、対応するunitテスト、in-memory Query。

- [x] getProfileの正常取得、未登録、DB障害、形式違反でQueryを呼ばないテストから実装する。
- [x] activity/connectionsのユースケースが対象UUID・kind/direction・20件を正しく渡し、取得障害と0件を区別するテストを書く。
- [x] tabの正規化、切り替えでカーソル削除、次ページで対象IDとtabを保持するテストを書く。
- [x] 投稿カーソルと関係カーソルの往復、対象者・タブの不一致、長すぎる入力、壊れたJSON・日時・UUIDをテストする。
- [x] 日時・UUIDの検証を必要分だけ共通化し、メイン画面の年0000拒否・年0001許可・小数秒6桁の既存テストを維持する。

代表テストの形：

```ts
it('形式違反のIDではDBを照会しない', async () => {
  const findSummary = vi.fn();
  const result = await getProfile(
    { query: { findSummary } },
    { displayId: '@bad', viewerId: null },
  );
  expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(findSummary).not.toHaveBeenCalled();
});
```

このユースケースの依存型は `Pick<ProfileQuery, 'findSummary'>` とし、テストで不要なポートを実装しない。他のユースケースも利用するメソッドだけに依存する。

Run: `pnpm exec vitest run --project unit test/unit/application/profile.test.ts test/unit/app/profile-query.test.ts test/unit/app/timeline-query.test.ts`。

### Task 2: 実DBのプロフィールQuery

**Files:** `infra/queries/postgres-profile-query.ts`、`test/integration/postgres-profile-query.test.ts`、`test/support/timeline-fixtures.ts`。

- [x] 大小文字を変えたIDから、名前・保存済みID・bio・作成日を取得するテストから実装する。未登録はnull、障害はthrow。
- [x] AがB/Cをフォロー、D/E/FがAをフォローするfixtureで、Aのフォロー2・フォロワー3になることを確認する。JOINで6に増える誤りを防ぐ。
- [x] viewerが対象をフォローしている／いない／nullでfollowedByViewerが正しいことをテストする。
- [x] Aの通常投稿、AによるBの投稿のリツイート、BによるAの投稿のリツイートを作り、投稿タブ・リツイートタブに適切な出来事だけ含むことを検証する。
- [x] 関係一覧の向きを入れ替えていないこと、各利用者の公開情報がJOINで取得できることを検証する。
- [x] 0件・20件・21件、同時刻のUUID順、ミリ秒未満の時刻を含むページ境界で重複・欠落がないことを検証する。
- [x] password_hashがヘッダー・各一覧に存在しないことを確認する。カード件数に比例してSQLが増えない実装にする。
- [x] 専用テストDBに自身のfixtureだけを作り、作成した利用者のcascadeを利用して後片付けする。既存の開発・本番DBへテストデータを入れない。

Run: `pnpm exec vitest run --project integration test/integration/postgres-profile-query.test.ts`。

### Task 3: 公開情報・タブ・関係一覧・共通導線

**Files:** `app/ui/profile/*`、`app/ui/layout/page-shell.tsx`、`app/(home)/layout-shell.tsx`、`app/ui/timeline/{main-navigation,tweet-card}.tsx`、対応するUIテスト。

- [x] ヘッダーに名前・ID・bio・JSTの利用開始日・正しい件数を表示するテストを書く。bio空、長文・改行、HTML風文字列を含める。
- [x] 自分の補助表示、他人のフォロー済み表示、未ログインの公開表示を分けて検証する。編集・フォロー操作ボタンを追加しない。
- [x] 投稿／リツイートのリンクと選択表示、件数からfollowing/followersへのリンクをテストする。選択状態はURLに従わせ、古いローカル状態を残さない。
- [x] 投稿一覧は既存TweetCardを再利用し、プロフィール固有の空表示を追加する。利用者一覧は名前・IDとリンクを表示する。
- [x] 再試行はrouter.refresh、pending中は無効。プロフィール全体と一覧部分の失敗表示を区別する。
- [x] 投稿者とリツイート実行者のリンク、自分のプロフィール用ナビ、ホームとプロフィールのaria-currentを検証する。
- [x] PageShellを抽出してメイン画面の余白・幅・loadingを維持する。375pxで長いbio・名前・タブが横にはみ出さないようにする。

Run: `pnpm exec vitest run --project ui test/unit/ui/profile.test.tsx test/unit/ui/timeline.test.tsx`。

### Task 4: URL・認証・404と画面の接続

**Files:** `app/profile/[displayId]/{page,loading,not-found}.tsx`、`app/_composition/profile.ts`、`app/(home)/page.tsx`、`test/unit/app/profile-page.test.tsx`、`test/unit/app/home-page.test.tsx`。

- [x] ローカルNext.jsガイドに従いparams/searchParamsをawaitする。公開プロフィールの表示にログインを要求しない。
- [x] 対象UUIDとセッションUUIDによる自分・他人判定をテストする。URLの大小文字が違っても自分なら同じ扱いにする。
- [x] NOT_FOUNDのみnotFoundを呼び、UNAVAILABLEでは再試行表示にする。notFoundの例外をtry/catchで握り潰さない。
- [x] 対象が存在しなければ一覧Queryは呼ばない。存在する対象で一覧0件ならヘッダーを表示する。
- [x] 不正カーソルではヘッダーを残し、一覧Queryを呼ばず先頭リンクを表示する。一覧Queryの障害でもヘッダーと件数は残す。
- [x] 自分のナビURLは実在するログイン利用者から作る。閲覧中の他人のIDを自分のリンクに使わない。利用者確認失敗時は自身のリンクを出さず、未確認の自分判定をしない。
- [x] loadingとnot-foundはプロフィール配下へ閉じ込め、ログイン・登録の表示を変えない。メタデータは静的な「プロフィール」とし、タイトル用の重複DB取得を追加しない。
- [x] viewer依存情報を利用者間の共有キャッシュに保存しない。ビルド時のDB接続を前提にしない。

Run: `pnpm exec vitest run --project ui test/unit/app/profile-page.test.tsx test/unit/app/home-page.test.tsx`。

### Task 5: プロフィールE2E

**Files:** `test/e2e/profile-screen.spec.ts`、`test/support/timeline-fixtures.ts`。

- [x] UI実装前に代表シナリオを書いてRedを確認する。既存fixture・実Repositoryを使い、未実装の編集・投稿UIを前提にしない。
- [x] 未ログインで他人の基本情報・投稿・リツイート・フォロワーを閲覧できる。
- [x] メイン画面の投稿者リンク→プロフィール→ホームと移動できる。リツイート実行者と元投稿者のリンクはそれぞれ正しい相手を開く。
- [x] ログインして自分のナビを開くと自分、他人のカードを開くと他人のプロフィールになる。表示名やIDの大小文字で取り違えない。
- [x] タブ・件数リンク・ページ送りで対象IDと表示が一致し、再読込・戻る／進むでも一致する。戻る前に必ず再読込するテストだけにしない。
- [x] 21件以上の投稿／関係を用意し、2ページ目で対象者の取り違え・重複・欠落がないことを確認する。
- [x] 未登録・形式違反IDは見つからない表示、投稿のない実在利用者はヘッダーと空一覧、不正カーソルは先頭へ戻れる表示になる。
- [x] PC/375pxでプロフィール、件数、タブ、一覧、ナビを操作できる。長いbioでも横スクロールが出ず、キーボードでリンクを辿れる。
- [x] DB障害は境界unitテストで再現し、本番用の障害注入APIを追加しない。
- [x] 作成したfixtureだけを削除し、登録・ログイン・メイン画面の既存E2E15件も通す。

Run: `pnpm exec playwright test test/e2e/profile-screen.spec.ts`、その後 `pnpm test:e2e`。

### Task 6: 全体確認と補完仕様の記録

**Files:** `README.md`、`docs/front_design.md`。

- [x] 自分・他人・未ログインの違い、投稿／リツイートの範囲、件数の向き、利用者一覧URLを記録する。
- [x] 編集・フォロー操作・いいね等は別計画とし、画面内に開発上の事情を説明する文言は追加しない。
- [x] `pnpm test:unit`：既存のカーソル・フォロー切り替えの回帰を含め全件成功。
- [x] `pnpm test:integration`：新Queryと既存テストが専用DBで成功。
- [x] `pnpm typecheck`：エラーなし。
- [x] `pnpm build`：実行時にプロフィールを取得し、ビルド時のDB接続なしで成功。
- [x] `pnpm test:e2e`：登録・ログイン・メイン・プロフィールが専用DBで成功。
- [x] 開発DBは既存の `.env.development.local` を使用し、新たなDB・branch・migrationを作らない。テストとの分離チェックを維持する。
- [x] Task単位で変更ファイルを明示してコミットし、merge/pushは別の指示に従う。

## 7. 実装時に読むローカルガイド

AGENTS.mdに従い、実装時点の `node_modules/next/dist/docs/` を確認する。今回の計画時にはpage・notFound・not-foundのガイドを確認した。

- `01-app/03-api-reference/03-file-conventions/page.md`
- `01-app/03-api-reference/03-file-conventions/loading.md`
- `01-app/03-api-reference/03-file-conventions/not-found.md`
- `01-app/03-api-reference/04-functions/not-found.md`
- `01-app/03-api-reference/04-functions/redirect.md`

## 8. 完了条件

自分・他人の基本情報と、その人に属する投稿／リツイート・フォロー／フォロワーを実DBから閲覧できる。未ログインでも公開情報を見られ、メイン画面から辿れ、ページ送りや戻る操作で対象・タブ・表示が一致する。未登録と障害を区別し、秘密情報を返さず、既存3画面の動作を保つ。
