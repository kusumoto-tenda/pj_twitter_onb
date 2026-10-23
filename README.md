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
