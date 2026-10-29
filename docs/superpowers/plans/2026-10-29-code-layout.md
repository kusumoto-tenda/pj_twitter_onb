# コード配置・DI移行 Implementation Plan

> **For agentic workers:** `executing-plans` スキルを使ってTask順に実行する。各ステップをチェックボックスで管理する。

**Goal:** 参照プロジェクトの役割別フォルダ構造に合わせ、`presentation` は作らず、DIを `app/_composition` からルート直下の `main/container` に移す。

**Architecture:** `domain` はモデル・ルール・永続化や外部サービスの契約、`application` はユースケース・DTO・読み取り契約、`infra` は具体実装、`main` は依存の組み立てを担当する。Next.jsの画面・Server Action・Route Handlerは `app` に残す。既存の関数、型、公開挙動を維持する配置変更とする。

**Tech Stack:** Next.js 16.4.2 App Router、TypeScript、Auth.js、postgres、Vercel Blob、Vitest、Playwright。

**Status:** Task 1〜6の実装・差分レビュー・最終検証を完了。型チェック・単体/UI1031件・E2E105件が成功。統合テストは全169件中168件成功・1件タイムアウトとなり、その1件は同条件の単独再実行で成功。詳細は末尾の検証記録を参照。

---

## 方針と比較

参照先: [Almondo-Tech/webapp-base の backend/src/backend](https://github.com/Almondo-Tech/webapp-base/tree/develop/backend/src/backend)。

2026-10-29に `develop` のコミット `db86ecf0f3dd227938e728095206e9667de94c37` を確認した。フォルダ一覧に加え、`main/README.md`・`main/container.py`・`domain/README.md`・`application/README.md`・`infra/persistence/README.md`・`shared/README.md` を読み、以下を採用する。

- フォルダ名は `entities`・`value_objects`・`repository_ifs`・`external_service_ifs`・`usecases`・`dtos`・`query_service_ifs`・`external_services` に合わせる。TypeScriptの既存ファイル名は維持する。
- DIは参照先の `main/container.py` の役割を `main/container/` に対応させる。機能別の9ファイルへ分け、全DIを再公開する一括import用ファイルは設けない。
- 永続化は参照先の `persistence/<技術名>/repositories`・`query_services` に合わせる。こちらはSQLAlchemyを使わないため、技術名は `postgres` とする。
- `shared` は全レイヤーが使える、業務知識を含まない処理に限定する。現在の汎用UUID正規化を `shared/uuid.ts` に移す。環境設定の全面集約は今回行わない。

1. **推奨: 役割別フォルダ構造を合わせ、既存ファイルを移動する。** 要望を満たし、業務処理を書き換えずに進められる。
2. DIだけを移す方法は差分が小さいが、`application/users/ports` などの配置が参照先と揃わない。
3. クラス化、Value Objectの新設、入力型の全面分割まで行う方法は変更範囲が大きい。今回の配置変更には含めない。

参照先にある `domain_services`・`exceptions`・ORM用の `models` は、現在対応する独立した実装がないため、空フォルダや仮のクラスを作らない。Python用の `__init__.py`、基底Entity/ValueObject/UseCaseクラス、DIライブラリ、FastAPI起動処理も導入しない。

## 移行後の構成

```text
app/                               # Next.jsの画面・Action・API・認証境界
main/
  container/                       # Web用DI。現在の9ファイルを機能別に配置
    cli/                           # CLI用DI。server-onlyをimportしない
domain/
  entities/users/                  # 既存のuser.ts
  value_objects/
    users/                         # アカウント・ログイン・プロフィール入力ルール
    tweets/                        # 投稿・編集の入力ルール
    media/                         # 画像の状態・属性・保存パス・期限
  repository_ifs/                  # 永続化インターフェース
  external_service_ifs/
    auth/                          # セッション終了・パスワードハッシュの契約
    media/                         # ストレージ・画像検査の契約
application/
  usecases/<機能>/                 # users、tweets、mediaなどの処理
  dtos/<機能>/                     # 結果型・一覧型・カーソルなど
  query_service_ifs/<機能>/         # timeline、profile、favoritesの読み取り契約
infra/
  persistence/
    postgres/
      db/                          # 接続・migration実行・SQL
      repositories/                # 更新系実装とmedia-sql.ts
      query_services/              # 読み取り実装とtimeline-rows.ts
  external_services/
    auth/                          # scrypt
    media/                         # Blob・sharp
shared/
  uuid.ts                          # 業務に依存しないUUID正規化
scripts/                           # CLI入口・引数と環境の選択
test/                              # 既存のテスト配置を維持
```

`value_objects` は参照先のフォルダ名に合わせる。既存の検証関数をこの配下へ移すだけで、クラスや新しい不変条件は導入しない。`user.ts` に同居する入力型・公開型も今回分割しない。

## ファイル移動表

以下の `*` は該当ディレクトリの既存ファイルすべてを表し、ファイル名は維持する。

| 現在 | 移行先 |
| --- | --- |
| `app/_composition/*.ts` | `main/container/*.ts` |
| `domain/users/user.ts` | `domain/entities/users/user.ts` |
| `domain/shared/uuid.ts` | `shared/uuid.ts` |
| `domain/users/account-validation.ts` | `domain/value_objects/users/account-validation.ts` |
| `domain/users/login-validation.ts` | `domain/value_objects/users/login-validation.ts` |
| `domain/users/profile-edit-validation.ts` | `domain/value_objects/users/profile-edit-validation.ts` |
| `domain/tweets/tweet-validation.ts` | `domain/value_objects/tweets/tweet-validation.ts` |
| `domain/tweets/edit-tweet-validation.ts` | `domain/value_objects/tweets/edit-tweet-validation.ts` |
| `application/media/media.ts` | `domain/value_objects/media/media.ts` |
| `application/users/ports/user-repository.ts` | `domain/repository_ifs/user-repository.ts` |
| `application/tweets/ports/tweet-writer.ts` | `domain/repository_ifs/tweet-writer.ts` |
| `application/tweets/ports/tweet-editor.ts` | `domain/repository_ifs/tweet-editor.ts` |
| `application/tweets/ports/tweet-deleter.ts` | `domain/repository_ifs/tweet-deleter.ts` |
| `application/media/ports/media-repository.ts` | `domain/repository_ifs/media-repository.ts` |
| `application/favorites/ports/favorite-repository.ts` | `domain/repository_ifs/favorite-repository.ts` |
| `application/follows/ports/follow-repository.ts` | `domain/repository_ifs/follow-repository.ts` |
| `application/likes/ports/like-repository.ts` | `domain/repository_ifs/like-repository.ts` |
| `application/retweets/ports/retweet-repository.ts` | `domain/repository_ifs/retweet-repository.ts` |
| `application/users/ports/password-hasher.ts` | `domain/external_service_ifs/auth/password-hasher.ts` |
| `application/auth/ports/session-terminator.ts` | `domain/external_service_ifs/auth/session-terminator.ts` |
| `application/media/ports/media-storage.ts` | `domain/external_service_ifs/media/media-storage.ts` |
| `application/media/ports/image-inspector.ts` | `domain/external_service_ifs/media/image-inspector.ts` |
| `application/timeline/ports/timeline-query.ts` | `application/query_service_ifs/timeline/timeline-query.ts` |
| `application/profile/ports/profile-query.ts` | `application/query_service_ifs/profile/profile-query.ts` |
| `application/favorites/ports/favorite-query.ts` | `application/query_service_ifs/favorites/favorite-query.ts` |
| `application/timeline/timeline.ts` | `application/dtos/timeline/timeline.ts` |
| `application/profile/profile.ts` | `application/dtos/profile/profile.ts` |
| `application/favorites/favorite.ts` | `application/dtos/favorites/favorite.ts` |
| `application/follows/follow.ts` | `application/dtos/follows/follow.ts` |
| `application/likes/like.ts` | `application/dtos/likes/like.ts` |
| `application/retweets/retweet.ts` | `application/dtos/retweets/retweet.ts` |
| `application/tweets/tweet.ts` | `application/dtos/tweets/tweet.ts` |
| `application/tweets/tweet-edit.ts` | `application/dtos/tweets/tweet-edit.ts` |
| `application/tweets/tweet-delete.ts` | `application/dtos/tweets/tweet-delete.ts` |
| 上記以外の `application/<機能>/*.ts` | `application/usecases/<機能>/*.ts` |
| `infra/db/`（SQLを含む） | `infra/persistence/postgres/db/` |
| `infra/repositories/*.ts`（`media-sql.ts` を含む） | `infra/persistence/postgres/repositories/*.ts` |
| `infra/queries/*.ts`（`timeline-rows.ts` を含む） | `infra/persistence/postgres/query_services/*.ts` |
| `infra/security/scrypt-password-hasher.ts` | `infra/external_services/auth/scrypt-password-hasher.ts` |
| `infra/media/*.ts` | `infra/external_services/media/*.ts` |

ユースケース内に定義済みの `AccountDependencies`・`CreateAccountResult` などは、そのファイルと一緒に移す。すべての型をDTOへ抽出する変更は含めない。

## 依存関係と維持する条件

- `shared` は他の層をimportしない。`domain` は `shared` を利用できるが、`application`・`infra`・`main`・`app` をimportしない。
- `application` は `domain`・`shared` とapplication内のDTO・契約を利用する。Next.jsや具体実装には依存しない。
- `infra` は対応するdomain契約またはapplicationのQueryServiceを実装する。`app`・`main` はimportしない。
- `main/container` でWeb用の具体実装を組み立て、画面・Action・APIはその関数を呼ぶ。
- **参照先との差:** 参照先はFastAPI起動時にDIコンテナをwireするため、presentationからmainへのimportを禁止している。本計画ではNext.jsのファイルベースの入口に合わせ、`app` のサーバー処理 → `main/container` の取得関数だけは許可する。Pythonの起動方式や文字列IDによるDIを再現しない。クライアントコンポーネントからmainの実行時importは禁止する。
- `main/container/session.ts` → `app/_auth/end-session.ts` の参照は、既存Auth.jsアダプターを利用するため維持する。`end-session.ts` と `auth.ts` は `main/container/session.ts` をimportしない。認証アダプター全体を移す作業は行わない。
- Web用DIの `server-only`、遅延初期化、インスタンスの再利用、UUID・日時の生成方法を維持する。共通barrelを作って全DIを一括評価させない。
- `MediaRepository` が参照する `UploadStatus`・`VerifiedImage` は `domain/value_objects/media/media.ts` に置く。これによりrepositoryをdomainへ移してもapplicationへの逆向き依存が生まれない。
- `EditableTweet`・`DeleteTarget`・保存結果の型は対応repositoryファイル内に残す。画面用の一覧型は `application/dtos`、読み取り契約は `application/query_service_ifs` に置く。
- パスエイリアス `@/* → ./*` は維持する。`src` 導入や `tsconfig.json` の無関係な整理はしない。
- SQLの内容・ファイル名・適用履歴・ロック順は変更しない。`migrate.ts` と `migrations/` を一緒に移し、`new URL('./migrations/', import.meta.url)` を維持する。
- `app/lib/data.ts` など教材由来の請求書コードの整理は対象外。現在のTwitter機能のDIを `main` に集約する。

## Task 1: 移動前の基準を確認する

**Read:** `AGENTS.md`、`README.md`、`package.json`、`vitest.config.ts`、`playwright.config.ts`。

- [x] `git status --short` で既存差分を確認し、利用者の変更を保持する。
- [x] 導入版の `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md` と `05-server-and-client-components.md` を読む。
- [x] `pnpm typecheck` と `pnpm test:unit` を実行し、移動前の結果を記録する。既存失敗があれば配置変更の失敗と区別する。

## Task 2: DIをmainへ移す

**Move:** `app/_composition/{account,favorites,follow,likes,profile,retweets,session,timeline,tweet}.ts` → `main/container/`。

**Modify:** 呼び出し元の `app/**` と `test/unit/app/**`。

- [x] 上記9ファイルを `git mv` で移動する。
- [x] リポジトリ内の現行コード・テストの `@/app/_composition/` を `@/main/container/` に置換する。`vi.mock` と動的importも含む。過去の計画書は書き換えない。
- [x] 既存の関数名・返り値・遅延初期化・`server-only` を維持する。
- [x] `pnpm typecheck` と `pnpm test:unit` を実行する。ログアウトがDBを開かないことを `test/unit/app/end-session.test.ts`・`logout-actions.test.ts` で確認する。

## Task 3: domainとapplicationを役割別に移す

**Move:** 移動表の `domain/**`・`application/**`。**Create directory:** `shared/`（既存UUIDファイルの移動先）。

**Modify:** 全呼び出し元・型import・テスト・mock。

- [x] 移動表に従ってdomainモデル・検証・repository・外部サービス契約を移動する。汎用UUID正規化は `shared/uuid.ts` に移す。画像の共通型も同じ変更単位でdomainへ移す。
- [x] 一覧型・結果型を指定の `application/dtos`、Query契約を `application/query_service_ifs`、残りの処理ファイルを `application/usecase` に移す。
- [x] `@/` から始まるパスに加え、`./ports/*`・`../media`・`../../timeline/timeline` などの相対importを実際の移動先へ更新する。移動した内部参照は `@/domain/...`・`@/application/...`・`@/shared/...` に揃える。
- [x] `domain/value_objects/users/*-validation.ts` の `./user` 参照を `@/domain/entities/users/user` に更新する。
- [x] `scripts/cleanup-media.mts` のユースケースimportなど、`.mts` の相対参照も更新する。
- [x] 旧パスでのre-exportは作らず、旧フォルダを空にする。型のプロパティ・エラーコード・判定・トランザクション契約は変更しない。
- [x] `pnpm typecheck` と `pnpm test:unit` を実行する。

## Task 4: infraを役割別に移す

**Move:** 移動表の `infra/**`。

**Modify:** `main/container/*.ts`、`scripts/{migrate,cleanup-media}.mts`、`test/support/test-db.ts`、関連テスト。

- [x] DB・repository・queryservice・外部サービス実装を移動する。SQLディレクトリも移す。
- [x] importと `vi.mock` の `infra/db`・`infra/repositories`・`infra/queries`・`infra/media`・`infra/security` を更新する。
- [x] `media-sql.ts` と `timeline-rows.ts` を利用する相対importも更新する。
- [x] `test/support/test-db.ts` のmigration動的importを更新する。
- [x] `pnpm typecheck` と `pnpm test:unit` を実行する。

## Task 5: CLIの組み立てもmainへ集める

**Create:** `main/container/cli/media-cleanup.ts`、`main/container/cli/migration.ts`。

**Modify:** `scripts/cleanup-media.mts`、`scripts/migrate.mts`。

- [x] `media-cleanup.ts` に `createMediaCleanupDependencies(databaseUrl: string, blobToken: string)` を用意する。`postgres(databaseUrl, { max: 1, onnotice: () => {} })`、`PostgresMediaRepository`、`VercelBlobStorage`、`now` の組み立てを元のscriptから移し、`{ sql, dependencies: { media, storage, now } }` を返す。
- [x] `migration.ts` に `createMigrationDependencies(databaseUrl: string)` を用意する。元の `postgres(databaseUrl, { max: 1, onnotice: () => {} })` を移し、`{ sql, run: () => runMigrations(sql) }` を返す。
- [x] 両scriptは環境読込・対象選択の後に上記factoryを呼ぶ。cleanupは既存 `cleanupMedia(dependencies, {})`、migrationは `run()` を実行し、既存の `finally { await sql.end(); }` と出力形式を維持する。
- [x] CLI用の2ファイルに `server-only` を追加しない。Web用の `getSql()` や `getTweetDependencies()` をCLIから利用しない。対象選択・本番用とテスト用の分離・環境変数の優先順位は変更しない。
- [x] `pnpm typecheck` と `pnpm test:unit` を実行する。既存 `test/unit/scripts/{cleanup-target,migration-target}.test.ts` が成功することを確認する。

## Task 6: ドキュメント更新と最終確認

**Modify:** `README.md` の構成表と、現在の運用手順内の移動対象パス。

- [x] READMEに `main/container`・新しいdomain/application/infra/sharedの役割と配置、Next.jsで許可するmainへの依存を書く。古い計画書は作成時の記録として維持する。
- [x] `rg -n '_composition|@/infra/(db|repositories|queries|media|security)/|@/application/[^/]+/ports/|@/domain/(users|tweets|shared)/' app main domain application infra shared scripts test README.md` で旧参照がないことを確認する。期待結果は該当なし（終了コード1）。
- [x] `rg -n '(from\s+|import\s*\().*["\x27](@/|\.{1,2}/).*(application|infra|main|app)/' domain` でdomainから上位層への依存がないことを確認する。補助検索なので、相対importの移動先も目視確認する。
- [x] `shared/uuid.ts` が他の層をimportせず、利用元が `@/shared/uuid` を参照していることを確認する。
- [x] `git diff --check`、`pnpm typecheck`、`pnpm test:unit` が成功することを確認する。
- [x] `pnpm test:integration` を専用テストDB・Blobの設定で全169件実行。168件成功、1件は30秒タイムアウト。同じ接続設定・同じ30秒上限の単独再実行では成功し、全169ケースの成功を確認した。全件実行自体の終了コードは1であり、一度の実行で全件成功したという扱いにはしない。
- [x] `pnpm test:e2e` を実行する。既存設定がテスト専用環境で `pnpm build` と本番サーバー起動を行うので、別途同じbuildを重ねない。認証・ログアウト、投稿作成/編集/削除、画像、一覧、各反応の既存E2Eが成功することを確認する。
- [x] `pnpm db:migrate --test` と `pnpm media:cleanup --test` でCLIのimport解決・実行・接続終了を確認する。専用テスト環境を使い、通常の開発/本番対象へは実行しない。
- [x] `git diff --stat`・`git diff --find-renames` で配置と参照の変更が中心であることを確認する。DB・Blob環境が利用できず未実行の検証は、成功扱いせず明記する。

配置のみの変更を写す新規テストは増やさず、既存の振る舞いのテストを利用する。途中の失敗はそのTask内で解消してから次へ進む。

## 完了条件

- `presentation/` を作らず、画面・URL・Action・APIの振る舞いを維持している。
- `app/_composition/` がなくなり、9個のWeb用DIが `main/container/` にある。
- 現行CLIの組み立てが `main/container/cli/` にあり、Web専用モジュールに依存しない。
- 参照先の複数形・snake_caseの層別フォルダ名を採用し、永続化実装が `infra/persistence/postgres/` にある。
- repositoryと外部サービス契約はdomain、Query契約はapplicationにあり、domainがapplicationへ依存しない。`shared/uuid.ts` は他の層へ依存しない。
- 移動表にあるファイルの現行コード・テストの参照が更新され、旧パスの互換ファイルが残っていない。
- SQLと既存の業務処理を変更せず、型チェック・既存テスト・本番ビルド・CLI実行の検証結果を提示できる。

## 計画の確認記録

新しい参照先の固定コミットの構成・設計説明・DI実装と、移行元の実ファイル、DI9ファイル、相対import、画像共通型、CLI、migrationの相対パス、Auth.js境界、テストmockを確認した。`presentation` 不要・DIを `main` に配置という要件を移動表と完了条件に反映済み。実装済みの差分レビューでは、importの変更とCLI用DIの抽出以外に業務処理・SQLの変更がないことを確認した。


## 2026-10-29 最終検証記録

DB・Blobを使うコマンドには `NODE_OPTIONS="--network-family-autoselection-attempt-timeout=5000"` を実行時に指定した。リポジトリの接続設定・テスト上限・業務コードは変更していない。統合テストとE2Eは順番に実行した。

| 検証 | 結果 |
| --- | --- |
| `pnpm typecheck` | 成功 |
| scriptsの型チェック | `/tmp` の一時tsconfigから `scripts/**/*.mts` を対象として成功 |
| `pnpm test:unit` | 77ファイル・1031件成功 |
| 統合テスト全件 | 18ファイル・169件中168件成功、1件タイムアウト |
| タイムアウトしたケースの単独再実行 | 同じ30秒上限のまま成功（テスト本体約7.1秒） |
| `pnpm media:cleanup --test` | 正常終了。expiredDrafts/deleted/failed/orphansはすべて0 |
| 標準ビルド・`pnpm db:migrate --test` | E2E起動時に成功。migrationは適用済み |
| E2E全件 | 標準設定で105件すべて成功（22.3分） |
| 差分レビュー | 指摘なし。import・mock・動的importの移動先、SQLファイルの同一性、CLIとWebの依存境界を確認 |

統合テストのタイムアウトは `test/integration/postgres-tweet-writer.test.ts` の「利用者を削除した後は、その下書きから投稿できない」の1件。全件実行ログは `/tmp/code-layout-final-integration.log`、単独再実行ログは `/tmp/code-layout-final-integration-retry.log`。

E2Eの初回には、今回の実行前から残っていた `fixture-hash` の利用者2人を確認した。そのうち1人が2426年の投稿23件を持ち、新規投稿が一覧先頭に出るという検証を妨げていた。専用テストDBからこの2人だけをIDとフィクスチャハッシュの両条件で削除し、保持対象6人を残して、未来日付の投稿・固定UUIDのお気に入りがともに0件になったことを確認した。E2Eはそこから最初から実行し直し、105件すべて成功した。成功ログは `/tmp/code-layout-final-e2e-clean.log`。

終了後のDB確認でも利用者6人を保持し、未来日付の投稿・固定UUIDのお気に入りがともに0件であることを確認した。3100番ポートのテストサーバーも終了している。`git diff --check` と `git diff --cached --check` に問題はなく、今回の検証では業務コードやテストコードへの追加変更は行っていない。
