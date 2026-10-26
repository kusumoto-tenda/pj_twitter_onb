# Twitter クローン（オンボーディング課題）

Next.js App Router の教材をベースにした Twitter（X）風アプリ。要件は `docs/functions.md`、画面遷移は `docs/front_design.md` を参照。

## 構成

| 層 | 場所 | 役割 |
| --- | --- | --- |
| domain | `domain/` | 入力ルール・ユーザーの型。フレームワークやDBに依存しない |
| application | `application/` | 登録・認証などのユースケースと、外部依存のポート（interface） |
| infra | `infra/` | PostgreSQL・scrypt によるポートの実装、マイグレーション |
| app | `app/` | 画面、Server Action、Auth.js の設定。具体実装の組み立ては `app/_composition/` だけで行う |

## セットアップ（Vercel + Postgres）

DB は Vercel の Storage から作成する Postgres（Neon）を使う。

1. Vercel にプロジェクトを作成（GitHub リポジトリを Import するか、`pnpm dlx vercel link`）。
2. Vercel ダッシュボードの **Storage → Create Database → Neon (Postgres)** で DB を作成し、プロジェクトに接続する。`POSTGRES_URL` などの環境変数が自動で登録される。
3. **Settings → Environment Variables** に `AUTH_SECRET`（`openssl rand -base64 32` の値）を追加する。`AUTH_URL` は Vercel 上では設定しない。
4. ローカルに接続情報を取得してマイグレーションを適用する。

```bash
pnpm install
pnpm dlx vercel env pull .env.local   # POSTGRES_URL などを .env.local に保存
pnpm db:migrate                       # POSTGRES_URL_NON_POOLING（なければ POSTGRES_URL）に適用
pnpm dev
```

- `.env.local` が `.env` より優先される。ローカル専用の `AUTH_URL` などは `.env` に書く（`.env.example` 参照）。
- `vercel env pull` で取得するDBは本番と同じ。開発で分けたい場合は Neon で開発用ブランチを作り、その接続URLを `.env.development.local` の `POSTGRES_URL`（プール経由）と `POSTGRES_URL_NON_POOLING`（プールなし）に書く。`pnpm dev` と `pnpm db:migrate` はこちらを優先する。
- Twitter 用のテーブルは PostgreSQL schema `twitter` に作成する。教材の `/seed` は `public` schema の教材用テーブルを作るもので、このアプリのDB準備には使わない。
- マイグレーションはリクエスト処理やビルドからは実行しない。スキーマを変えたらデプロイ前に `pnpm db:migrate` を実行する。

### テスト用DB

結合テストと E2E はデータを書き込むため、本番・開発とは別の DB を `TEST_POSTGRES_URL` に指定する。Neon コンソールでテスト用のブランチ（または別の database）を作り、その接続URLを `.env` に書く。Vercel の環境変数には登録しない。

`pnpm db:migrate --test` で `TEST_POSTGRES_URL` 側にも適用できる（テストは自動で適用する）。

## テスト

| コマンド | 内容 |
| --- | --- |
| `pnpm test:unit` | domain・ユースケース・Server Action・UI の単体テスト（DB不要） |
| `pnpm test:integration` | 実 PostgreSQL の Repository と実 scrypt のテスト |
| `pnpm test:e2e` | Playwright。テストDBに向けた本番ビルドを port 3100 で起動して検証 |
| `pnpm typecheck` | 型チェック |

- 結合テストと E2E は `TEST_POSTGRES_URL` が必須。未設定、またはアプリ用の URL（Neon のプール経由・プールなしを含む）と同じ DB なら実行前に失敗する。
- テストは自分で作成した行だけを削除し、DB全体の drop・truncate は行わない。
- E2E 初回は `pnpm exec playwright install chromium` でブラウザを取得する。

## アカウント作成の仕様メモ

- ユーザーIDは大文字小文字を区別せず一意（表示は登録時の綴りを保持）。文字数は Unicode コードポイント数で数える。
- パスワードは Node.js 標準の scrypt（N=2^17, r=8, p=1）でハッシュ化して保存する。bcrypt の72バイト制限を避けるため。
- 認証は Auth.js の Credentials + JWT セッション（7日）。セッションには内部 UUID だけを入れる。
- 登録直後の自動ログインだけが失敗した場合は、作成済みのアカウントを削除せず、ログイン画面へ案内する。

## ログインの仕様メモ

- `/login` は登録時と同じ形式ルールでID・パスワードを検証してから認証する。形式違反はAuth.jsへの直接リクエストでも認証ユースケースで拒否する。
- 未登録IDと誤パスワードは同じメッセージ、DB障害などは別のメッセージで区別する。失敗時はIDだけを保持する。
- ログイン済みでセッションのUUIDに対応する利用者がDBに存在する場合、`/login` は `/` に移動する。Cookieの有無だけでは判断しない。

## メイン画面（タイムライン）の仕様メモ

- 投稿（`twitter.tweets`）・フォロー（`twitter.follows`）・リツイート（`twitter.retweets`）は `002-create-timeline.sql` で作成する。利用者を削除すると関連行もcascadeで削除される。
- 一覧は投稿とリツイートを1本のSQL（UNION ALL）で取得し、`(出来事の日時, 種類, ID)` のキーセットで20件ずつページングする。OFFSETは使わない。
- カーソルの日時はDBのマイクロ秒精度を保つ文字列のまま扱う。postgres.js は `timestamptz` 型のパラメータを `Date`（ミリ秒）に変換するため、SQLでは `::text::timestamptz` で渡している。
- 投稿の作成・反応・画像はまだ実装していない。動作確認用のデータはSQLで直接入れる（テストでは `test/support/timeline-fixtures.ts`）。

## プロフィール画面の仕様メモ

- `/profile/{ユーザーID}` は未ログインでも閲覧できる。自分かどうかはDBの対象UUIDとセッションのUUIDで判断する。
- フォロー数は `follower_id = 本人`、フォロワー数は `follow_id = 本人` の件数。向きごとの独立したサブクエリで数える。
- 投稿・リツイート・フォロー・フォロワーの一覧は、それぞれ1回のSQLでキーセット方式（20件）で取得する。カーソルには対象者とタブを含め、他の画面・他人のページへ持ち込まれた場合は不正として扱う。
- 新しいテーブル・マイグレーションはない（`002` までを使う）。

## プロフィール編集の仕様メモ

- `/profile/{ユーザーID}/edit` は本人だけが使える。画面の表示時に加え、保存のたびにServer Actionでセッションと利用者を確認し、`actorId === targetId` のときだけ更新する（フォームの値や previousState は権限判断に使わない）。
- 更新は名前・ユーザーID・bioの3列だけを1つのUPDATEで行う。ID重複は一意インデックス `users_display_id_ci_unique` の違反だけを競合として扱い、部分的な更新は起きない。
- 保存後は `revalidatePath` でメイン・プロフィール・編集画面の表示を無効化し、表示用Cookie `flash_profile` で更新通知を出す（登録通知の `flash` とは別）。
- `textarea` の改行はブラウザがCRLFで送るため、自己紹介はサーバーでLFに揃えてから検証・保存する（登録画面も同様）。
- 新しいマイグレーションはない。

## アカウント削除の仕様メモ

- `/profile/{ユーザーID}/delete` は本人だけが使える。ページ表示（GET）では削除せず、Server Actionで毎回セッションのUUIDを確認し、`actorId === targetId` かつ現在のパスワードが一致したときだけ削除する。
- 削除は `DELETE FROM twitter.users WHERE id = ...` の1文だけで行い、投稿・フォロー・リツイートは既存FKのON DELETE CASCADEで消える（論理削除・復元はなし）。
- 削除後は表示を `revalidatePath` で無効化し、Auth.jsの `signOut({ redirect: false })` で認証Cookieを無効化してから `/login` へ移動する。通知は表示用Cookie `flash_account`（`deleted` / `signout-failed` / `account-missing`）で出す。
- DB削除とCookieの変更は1つのトランザクションにできないため、signOutに失敗しても削除は戻さず、その旨をログイン画面に固定表示する。他のブラウザに残ったセッションは、利用者の実在確認で未ログインとして扱われる。
- 新しいマイグレーションはない。

## ツイート作成ダイアログ・画像の仕様メモ

### 環境

- 画像は Vercel Blob の**非公開**ストアに保存する。開発・本番・テストで別のストアを用意し、アプリ用は `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID`（開発は `.env.development.local`）、テスト用は `TEST_BLOB_READ_WRITE_TOKEN` / `TEST_BLOB_STORE_ID`（`.env`）に書く。
- 結合テスト・E2Eは、実体を作る前にテスト用トークンが宣言したテスト用ストアを指し、アプリ用ストアと別であることを確認する。資格情報がなければskipせず失敗する。
- `003-create-tweet-media.sql` を `pnpm db:migrate`（開発）・`pnpm db:migrate --test`（テスト）で適用する。既存データの移行は不要。
- Vercel には `CRON_SECRET` を登録する。`vercel.json` のCronが毎日 18:00 UTC（日本時間3:00）に回収を実行する（Hobbyプランの日次制約に合わせている）。

### 流れ

1. 「ツイートする」を押すと、サーバーで利用者を確認して下書き（24時間有効）を作り、ダイアログを開く。未ログインならログイン画面へ移動する。
2. 画像を選ぶと、`/api/tweet-images/upload` で予約し、予約パス（`tweet-uploads/{下書きID}/{予約ID}`）だけに書き込める15分のトークンを受け取って、ブラウザから Blob へ直接アップロードする。画像の本体はアプリのサーバーを通らない（Vercel Functionsの4.5MB上限を避ける）。
3. `/api/tweet-images/verify` で、サーバーが実体を読み（5MBで打ち切り）、sharpでJPEG/PNGとしてデコードできること・画素数（4,000万以下）・Content-Typeとの一致を確かめる。完了webhookは使わない。
4. 投稿のServer Actionには本文と、準備済みの予約IDの並びだけを送る。下書き→画像の順に行ロックして、投稿と画像を1つのトランザクションで保存する。下書きIDを投稿IDとして使い、同じ内容の再送は同じ投稿を返す。
5. 投稿済みの画像は `/media/{画像ID}` からストリームで配信する（`private, no-store`・`nosniff`）。DBで公開中の投稿に属することを毎回確認する。

### 回収

- 添付の解除・キャンセル・下書きの期限切れでは、予約を破棄して実体の削除を予約する。トークンの有効期間中は遅れて届くアップロードで実体が再生成され得るため、削除はトークンの期限後に行う。
- 画像行が消えると（アカウント削除のCASCADEを含む）、トリガーが同じトランザクションで削除予約を作る。配信は直ちに404になる。
- `pnpm media:cleanup`（`--test` でテスト用）とCronが同じ回収処理を実行する。期限切れの下書きの破棄、時期が来た削除予約の実行、管理パス配下の24時間以上古い孤立した実体の削除を行う。Blobの削除に失敗した予約は残して再試行する。

### 注意

- 本文の「空なら画像が必要」という制約は、コミット時に検査する遅延制約（constraint trigger）で実装している。postgres.jsの自動コミットの単発SQLでは、この制約の失敗が呼び出し元に返らない（行はロールバックされる）。投稿を書き込む処理は必ず明示的なトランザクション（`sql.begin`）で行う。

## ツイート編集ダイアログの仕様メモ

- `004-edit-tweet.sql` を `pnpm db:migrate`（開発）・`pnpm db:migrate --test`（テスト）で適用する（`003` の後）。投稿の版（`tweets.revision`）、下書きの用途（`tweet_drafts.purpose` = create / edit・対象の投稿・準備時の版）、画像の位置の一意制約の遅延化、削除予約の時刻の変更を含む。
- 編集を始めると、サーバーで所有者を確かめ、DBの現在の内容と版を記録した編集用の下書きを作る。作成用の確定（publish）は編集用の下書きを受け付けない。
- 確定は下書き→対象の投稿→画像・予約の順にロックし、版が準備時と同じときだけ、本文・画像の解除（削除予約）・保持画像の位置の詰め直し・新規画像の追加を1つのトランザクションで行う。保持する画像は行を作り直さないので、画像ID・URLは変わらない。版が違えば何も変えずに競合を返す。
- 内容が実際に変わったときだけ版と `updated_at` を進める（何も変えない保存は成功するが、版・編集日時は変わらない）。投稿日時（`created_at`）は変えないので、一覧の並びとカーソルは変わらない。
- 同じ下書き・同じ入力の再送は成功済みとして扱う。使わなかった新規画像は確定時に破棄し、閉じた場合は編集用の下書きの新規画像だけを破棄する（元の投稿の画像は残る）。
- 画像行の削除による削除予約は、その画像のトークンの期限（最大15分）以降にする（アカウント削除経由でも同じ）。有効なトークンで同じパスに実体が作り直される隙間を作らないため。
- 成功しても画面は移動しない。`revalidatePath` で表示を更新し、成功の通知はルートlayoutのダイアログ管理（`TweetComposerProvider`）が出す。
