# アカウント作成 Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、タスク単位で進める。Steps use checkbox (`- [ ]`) syntax for tracking. この依頼は計画作成までで、実装開始の指示ではない。

**Goal:** 利用者が `/signin` でアカウントを作成でき、ログイン済みで `/` に移動し、成功通知が3秒表示される。

**Architecture:** `domain` に入力の業務ルールとユーザーを置き、`application` に登録・認証の手順と外部依存のポートを置く。`infra` がPostgreSQLとパスワードハッシュを実装し、`app` がフォーム、Server Action、Auth.jsとの接続、画面遷移を担当する。依存の組み立てはサーバー専用のcomposition rootに限定する。

**Tech Stack:** 現在導入済みのNext.js 16.0.10 / React 19.2.0 / TypeScript / postgres / next-auth 5.0.0-beta.25。テストにはVitest、Testing Library、Playwrightを追加する。パスワードにはNode.js標準の非同期scryptを使う案とする。

**Status:** レビュー用の計画案。ユーザーIDの大文字小文字の扱いは「Twitterに準拠」という回答を反映済み。それ以外の資料にない補完判断は下記に明記した。アプリコードの変更、依存の追加、DBへの接続・変更はまだ行わない。

---

## 1. 根拠と現在の状態

- `docs/functions.md` の「利用者はアカウントを作成できる」が受け入れ条件の基準。
- `docs/front_design.md` では登録画面は `/signin`、ログインは `/login`、メインは `/`。
- `docs/front/サインイン画面.png` はユーザーID・名前・パスワード、登録ボタン、ログインリンクの配置を示す。自己紹介欄がないため、機能一覧を優先して任意の自己紹介欄を追加する。
- `docs/ER_diagram.drawio` のUserは `id / name / display_id / bio / password_hash / created_at`。
- `app/signin/page.tsx` は空。`app/page.tsx` と `app/login/page.tsx` は教材の初期画面。
- `domain/`、`application/`、`infra/`、`test/` は空。テストランナーとテスト用scriptは未導入。
- `app/lib/definitions.ts` のUserと `app/seed/route.ts` のusersテーブルはメール認証を前提にした教材用。Twitter用Userの定義として流用しない。
- 調査時の `pnpm exec tsc --noEmit --incremental false` は失敗。空のsigninページと、教材UIが参照する未作成の `app/ui/fonts.ts` が原因として出力された。
- この環境の `.git` にはGitメタデータがなく、`git status` / `git log` は実行できなかった。コミットは実装環境でGit操作が可能な場合にタスク単位で行う。

## 2. 対象範囲と受け入れ条件

| 項目 | 条件 | テスト対象 |
| --- | --- | --- |
| 名前 | 1〜50文字 | 空・1・50・51文字、日本語・絵文字 |
| ユーザーID | 5〜15文字、半角英数字と `_` のみ | 4・5・15・16文字、許可文字、全角・空白・記号 |
| IDの一意性 | 大文字小文字を区別しない。表示上は元の綴りを保持 | `Alice_1` 登録後の `alice_1`、同時登録 |
| 自己紹介 | 任意、160文字以下 | 未入力・空・160・161文字 |
| パスワード | 8〜50文字 | 7・8・50・51文字、多バイト文字、前後の空白を保持 |
| 自動設定 | UUID、作成日時 | 固定UUID・時計を注入したユースケーステスト |
| 保存内容 | パスワードは復元不能なハッシュのみ | 実ハッシュで照合、DB行に平文なし |
| 成功 | ログイン済みで `/` に遷移 | サーバーで認証済みUUIDを取得、再読込後も認証継続 |
| 成功通知 | 上部に「アカウントを作成しました」を3秒表示 | 遷移先で表示、3000ms後に非表示、再読込で再表示しない |
| 失敗 | `/signin` に留まる | URLとDB件数 |
| 失敗通知 | 上部に「アカウントの作成に失敗しました」を3秒表示 | 入力違反、重複、DB障害、再送時の通知 |
| 項目エラー | 入力違反の欄にメッセージ | 名前・ID・自己紹介・パスワード、ID重複 |

今回の対象外：投稿、実際のタイムライン取得、プロフィール編集、メール認証、OAuth、パスワード強度表示、自己紹介の自動リンク化、アカウント削除。`/` は登録後の認証状態と通知を確認できる最小のメイン画面までとする。

ログインの認証処理は登録直後の自動ログインに必要なため含める。`/login` は後述の登録後認証失敗から復帰するため、ID・パスワードによる最小フォームまで含める。ログアウトなどの機能全体は別計画にする。

## 3. 資料にない部分の補完判断

1. **IDの扱い：** `displayId` は入力の大文字小文字を保持し、検索と一意性にはASCII小文字化した値を使う。先頭の `@` を自動除去せず、形式エラーにする。Twitterへの準拠は今回確認されたIDの扱いに適用し、資料にない予約語・本人確認などは追加しない。
2. **文字数：** `Array.from(value).length` によるUnicodeコードポイント数。結合文字・複合絵文字の見た目1文字を1とする方式ではない。HTMLのmaxlengthだけに依存しない。
3. **空白：** 名前は前後をtrimして検証・保存。IDはtrimせず、空白を含めばエラー。自己紹介は入力を保持し、省略時は空文字。パスワードはtrim・小文字化・Unicode正規化をしない。
4. **バリデーション：** サーバーのdomainが最終判断。フォームは同じ純粋な検証関数を利用可能だが、クライアント側の検証だけで登録しない。複数欄のエラーを一括で返す。
5. **日時：** UTCの時点として保存。UUIDと時計をユースケースの依存として注入し、テストで固定する。
6. **認証：** 導入済みAuth.jsのCredentials + JWT sessionを使用。セッションには内部UUIDを格納し、パスワードやハッシュを含めない。認証期間は7日を初期値とする。
7. **保存後の認証失敗：** DB保存とAuth.jsのCookie発行は単一トランザクションにはできない。保存済みユーザーを削除せず、通常の失敗通知に加えて「アカウントは作成済みです。ログインしてください」を表示し `/login` へ案内する。再登録で回復しようとしない。この例外経路は資料の補完仕様としてレビュー対象。
8. **秘密情報：** Server Actionの戻り値、Reactのstate、URL、通知、ログにパスワードやハッシュを含めない。入力保持は名前・ID・自己紹介のみとし、パスワードは失敗時に再入力する。

## 4. 実装方式の比較

| 方式 | 利点 | 負担・制約 | 判断 |
| --- | --- | --- | --- |
| Server Action + Auth.js + RepositoryへのDI | 既存依存を使え、業務処理をNext.jsから独立してテストできる | DB保存後の認証失敗を別経路で扱う必要 | 推奨 |
| Route Handlerの登録API + クライアントfetch | APIを別クライアントからも利用しやすい | 今回は外部API要件がなく、HTTP契約が増える | 外部クライアントが必要になった際に検討 |
| DBセッションを独自実装 | ユーザーとセッション行を同じトランザクションで作れる | セッションの発行・検証・失効を独自に保守する必要 | 今回は採用しない |

既存のbcryptには先頭72バイトのみを扱う制約がある。資料は「8〜50文字」でASCII限定ではないため、そのまま使うと多バイトパスワードの末尾を無視し得る。新規登録では非同期scryptを使い、bcryptは教材コードのために残す。`PasswordHasher` ポートでアルゴリズムを隔離する。

## 5. 層・契約・データフロー

```text
app/signin → 登録用Server Action → CreateAccount → domainの検証
                                      ↓ 注入したinterface
                                 UserRepository / PasswordHasher
                                      ↑ 実装
                                 infraのPostgres / scrypt

保存成功 → Auth.js signIn → AuthenticateUser → UserRepository / PasswordHasher
         → 認証Cookie設定 → 成功通知の受け渡し → redirect('/')
```

- `domain` はReact、Next.js、Auth.js、postgres、node:cryptoをimportしない。
- `application` は `domain` と自身のポートだけに依存する。HTTP、FormData、Cookieを扱わない。
- `infra` は内側の型・ポートを実装する。DBの行・制約エラーを外部に漏らさない。
- `app` がFormDataを安全に解析する。Fileや必須欄の欠落、重複キーを想定する。クライアント提供のUUID・createdAt・hashは採用しない。
- `app/_composition/account.ts` が唯一の具体実装の組み立て場所。`server-only` を指定し、Client Componentからimportしない。
- Auth.js設定は `app/_auth/auth.ts` に置き、Credentialsのauthorizeから認証ユースケースを呼ぶ。登録ユースケース自体はAuth.jsを知らない。
- JWTのsubとsession.user.idはUUID。型拡張を用意する。`auth()` を使ったサーバー側取得で「ログイン済み」を確認する。

主要な型の予定：

```ts
type CreateAccountInput = {
  name: string;
  displayId: string;
  bio: string;
  password: string;
};
type AccountField = keyof CreateAccountInput;
type FieldErrors = Partial<Record<AccountField, string[]>>;
type AccountProfile = {
  id: string;
  name: string;
  displayId: string;
  bio: string;
  createdAt: Date;
};
type StoredAccount = AccountProfile & { passwordHash: string };
type CreateAccountResult =
  | { ok: true; account: AccountProfile }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors }
  | { ok: false; code: 'DISPLAY_ID_TAKEN' }
  | { ok: false; code: 'UNAVAILABLE' };

interface UserRepository {
  findByDisplayId(displayId: string): Promise<StoredAccount | null>;
  create(account: StoredAccount): Promise<'created' | 'display-id-taken'>;
}
interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
type AccountDependencies = {
  users: UserRepository;
  passwords: PasswordHasher;
  newId: () => string;
  now: () => Date;
};
```

`UserRepository.create` は重複だけを結果値に変換し、接続障害などはthrowする。`CreateAccount` が想定外の保存・ハッシュ失敗を `UNAVAILABLE` に変換する。ログが必要な場合も入力内容は渡さない。

成功結果から `passwordHash` を除外する際は、型だけの変換ではなく公開フィールドを明示的に組み立てる。`AuthenticateUser` も公開プロフィールかnullだけを返す。

## 6. ファイル配置

```text
domain/users/
  user.ts                         # 公開プロフィール・保存用アカウントの型
  account-validation.ts           # 長さ・形式の純粋な検証、IDの正規化
application/users/
  create-account.ts               # 登録手順と結果型
  authenticate-user.ts            # Credentialsで利用する認証手順
  ports/user-repository.ts        # 保存・取得のinterface
  ports/password-hasher.ts        # ハッシュ・照合のinterface
infra/
  db/client.ts                    # サーバー専用DB接続
  db/migrations/001-create-users.sql
  repositories/postgres-user-repository.ts
  security/scrypt-password-hasher.ts
app/
  _composition/account.ts         # Repository・Hasher・UseCaseの組み立て
  _auth/auth.ts                   # Auth.js設定・exports
  api/auth/[...nextauth]/route.ts  # Auth.jsのGET・POST
  signin/actions.ts               # 登録・自動ログイン・成功通知・redirect
  signin/page.tsx                 # 登録画面
  login/actions.ts                # 登録後の認証失敗からの復帰用
  login/page.tsx                  # 最小のID・パスワードログイン
  ui/account/create-account-form.tsx
  ui/account/login-form.tsx
  ui/notifications/toast.tsx      # 共通の3秒通知
  ui/notifications/account-created-flash.tsx
  page.tsx                       # 登録後の最小メイン画面
  layout.tsx                     # CSS・言語の設定
  ui/fonts.ts                    # 教材の未解決importを解消する互換定義
types/next-auth.d.ts
scripts/migrate.ts               # マイグレーションを明示実行
test/
  setup.ts
  support/in-memory-user-repository.ts
  support/fake-password-hasher.ts
  support/account-fixtures.ts
  support/test-db.ts
  unit/domain/account-validation.test.ts
  unit/application/create-account.test.ts
  unit/application/authenticate-user.test.ts
  unit/app/account-actions.test.ts
  unit/app/auth-config.test.ts
  unit/ui/create-account-form.test.tsx
  unit/ui/login-form.test.tsx
  unit/ui/account-created-flash.test.tsx
  unit/ui/toast.test.tsx
  integration/postgres-user-repository.test.ts
  integration/scrypt-password-hasher.test.ts
  e2e/create-account.spec.ts
vitest.config.ts
playwright.config.ts
```

設定・説明として `package.json`、`pnpm-lock.yaml`、`.env.example`、`.gitignore`、`README.md` も更新する。環境変数の値や実データはコミットしない。テストとマイグレーションのTS実行用に `tsx` を追加する。

## 7. DB設計と教材テーブルとの衝突回避

- Twitter用には専用PostgreSQL schema `twitter` の `twitter.users` を作成する。教材用 `public.users` は変更・削除しない。ER図のUserの列名をそのまま対応させる。
- `id UUID PRIMARY KEY`、`name TEXT NOT NULL`、`display_id TEXT NOT NULL`、`bio TEXT NOT NULL DEFAULT ''`、`password_hash TEXT NOT NULL`、`created_at TIMESTAMPTZ NOT NULL`。
- `lower(display_id)` に名前付きUNIQUE INDEX `users_display_id_ci_unique` を作る。
- DBにも名前・ID・bioの長さとID形式のCHECK制約を置く。nameは1〜50、IDは5〜15かつ `^[A-Za-z0-9_]+$`、bioは0〜160。パスワード長は平文を持つdomainで検証する。
- `create` は `INSERT ... ON CONFLICT (lower(display_id)) DO NOTHING RETURNING id` のように競合を原子的に扱う。返却0件は `display-id-taken`、他のSQLエラーは握り潰さない。
- IDの事前検索だけで一意性を保証しない。同時リクエストでもDBが最終判断する。
- テストには本番用 `POSTGRES_URL` と別の `TEST_POSTGRES_URL` を必須とする。URLが未設定または同一なら実行前に失敗させる。専用テストDBだけを初期化し、共有DB全体のdropやtruncateは行わない。
- マイグレーションはリクエスト処理やGET `/seed` から実行せず、`pnpm db:migrate` で行う。

## 8. TDDの進め方とタスク

各ケースを **Red（失敗を観測）→ Green（最小実装）→ Refactor（全件成功を維持）** の順で進める。テストを全て書いた後で全実装するのではなく、下記の1挙動ずつ往復する。importエラーの解消だけでRed確認を済ませず、必要な最小のexportを用意して期待値の失敗を確認する。

### Task 1: テスト基盤と既存エラーの整理

**Files:** `package.json`、`pnpm-lock.yaml`、`vitest.config.ts`、`playwright.config.ts`、`test/setup.ts`、`.gitignore`、`app/ui/fonts.ts`。

- [x] `vitest`、`@vitejs/plugin-react`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`、`@testing-library/user-event`、`@playwright/test`、`tsx` を開発依存に追加。対応するpeerDependenciesと現行Node/Reactへの適合を導入時に確認し、lockfileに固定する。
- [x] `test:unit` = `vitest run test/unit`、`test:integration` = `vitest run test/integration`、`test:e2e` = `playwright test`、`typecheck` = `tsc --noEmit`、`db:migrate` = `tsx scripts/migrate.ts` を追加する。
- [x] Vitestの `@` aliasをリポジトリルートへ向ける。UIテストだけjsdom、その他はnode。E2EはVitestの収集対象から外す。
- [x] DBテストを専用コマンドに分け、未設定時にskip成功としない。E2EサーバーにもTEST_POSTGRES_URLをPOSTGRES_URLとして渡し、開発用サーバーを使い回さない。
- [x] 教材のfonts importは外部フォント取得なしで解消できる互換exportにする。教材UIの全面改修はしない。空のsigninページ由来の型エラーはTask 7で解消する。
- [x] 最初のdomainテストを追加して、ランナーが期待するアサーション失敗を出すことを確認する。動作確認のためだけの恒久的なダミーテストは追加しない。

### Task 2: 入力ルールをdomainでTDD

**Files:** `domain/users/user.ts`、`domain/users/account-validation.ts`、`test/unit/domain/account-validation.test.ts`。

- [x] 名前の空入力で `name` エラーを返すテストを書き、失敗を確認してから最小実装する。
- [x] 名前の1・50・51文字、前後空白、空白のみを順に追加する。
- [x] IDの4・5・15・16文字、英大小文字・数字・アンダーバー、全角・ハイフン・空白・`@` を検証する。
- [x] `normalizeDisplayId('Alice_1') === 'alice_1'` と表示用の元表記の保持を検証する。
- [x] bioの0・160・161文字、省略時の空文字化を検証する。
- [x] パスワードの7・8・50・51文字、多バイト文字、前後空白をそのまま保持することを検証する。
- [x] 絵文字がUTF-16の2文字扱いにならないこと、複数項目のエラーを一括で得られることを検証する。
- [x] `pnpm test:unit test/unit/domain/account-validation.test.ts` で成功を確認する。Green後に検証の重複だけを整理する。

代表ケースの形：

```ts
it('名前が51コードポイントならname欄のエラーになる', () => {
  const result = validateAccountInput({
    name: 'あ'.repeat(51), displayId: 'Alice_1', bio: '', password: 'password123',
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.fieldErrors.name).toBeDefined();
});
```

### Task 3: 登録ユースケースをDBなしでTDD

**Files:** `application/users/create-account.ts`、`application/users/ports/*.ts`、`test/support/{in-memory-user-repository,fake-password-hasher,account-fixtures}.ts`、`test/unit/application/create-account.test.ts`。

- [x] 正常入力で1件保存され、注入したUUID・日時と元のdisplayIdを持つ公開プロフィールが返るテストから始める。
- [x] FakeHasherは明示的なテスト用文字列を返し、保存内容がその値であることを検証する。ハッシュそのものの安全性はTask 5で検証する。
- [x] 成功結果にpasswordとpasswordHashのプロパティが存在しないことを検証する。
- [x] 無効入力では保存・ハッシュ処理を行わないことを検証する。
- [x] `Alice_1` を保存した後 `alice_1` を登録すると重複結果になり、件数が増えないことを検証する。
- [x] Repositoryが競合結果を返すケース、DB障害をthrowするケース、Hasherがthrowするケースを個別にテストする。競合を事前検索結果だけで判定しない。
- [x] すべて成功後、domainの入力検証とユースケースの手順を分離できているか確認する。

### Task 4: PostgreSQL Repositoryを実DBでTDD

**Files:** `infra/db/client.ts`、`infra/db/migrations/001-create-users.sql`、`infra/repositories/postgres-user-repository.ts`、`scripts/migrate.ts`、`test/support/test-db.ts`、`test/integration/postgres-user-repository.test.ts`、`.env.example`。

- [x] 専用テストDBに必要なmigrationを適用し、Repository未実装による保存・取得の失敗を確認する。
- [x] 保存後に `findByDisplayId('ALICE_1')` で同一UUIDを取得でき、displayIdは登録時の表記を保つことを検証して最小実装する。
- [x] 固定UUIDとTIMESTAMPTZ、bio空文字、password_hashが往復できることを検証する。
- [x] `Alice_1` / `alice_1` の2つの `create` をPromise.allで同時実行し、成功が1件・競合が1件・DB行が1件になるテストを追加する。
- [x] 一意性以外のCHECK違反や切断を重複扱いにしないことを確認する。
- [x] SQLはパラメータ化し、DBのsnake_caseとアプリのcamelCaseの変換をRepositoryに閉じ込める。
- [x] `pnpm test:integration test/integration/postgres-user-repository.test.ts` を実DBで成功させる。

### Task 5: 実ハッシュと認証ユースケースをTDD

**Files:** `infra/security/scrypt-password-hasher.ts`、`application/users/authenticate-user.ts`、`test/integration/scrypt-password-hasher.test.ts`、`test/unit/application/authenticate-user.test.ts`。

- [x] 実Hasherのhash→verify成功、不一致でfalse、同じ平文でも別saltで別ハッシュになるテストを1つずつ追加する。
- [x] 72バイトを超える許可範囲内のUnicodeパスワードを2つ用意し、末尾が異なれば照合失敗になることを検証する。
- [x] scryptは非同期API、ランダムな16バイト以上のsalt、64バイトの導出鍵、timingSafeEqualを使う。初期パラメータはN=131072・r=8・p=1・maxmem=256MiBとし、バージョン・パラメータ・salt・鍵を保存用文字列に含める。実行環境でレイテンシとメモリを確認する。
- [x] 壊れた保存形式は照合失敗とし、保存文字列に任意の計算量を指定されても無制限に実行しない。対応バージョンとパラメータを制限する。
- [x] 認証ユースケースはID大小文字違いでも正しいパスワードなら公開プロフィール、未登録・誤パスワードならnullを返すテストから実装する。
- [x] 認証ユースケースは平文の扱いを登録時と合わせ、入力をログに残さない。DB障害は資格情報不一致と混同せず、上位で一般エラーに変換する。

### Task 6: Server ActionとAuth.jsを接続しTDD

**Files:** `app/_composition/account.ts`、`app/_auth/auth.ts`、`app/api/auth/[...nextauth]/route.ts`、`types/next-auth.d.ts`、`app/signin/actions.ts`、`app/login/actions.ts`、`test/unit/app/{account-actions,auth-config}.test.ts`。

- [x] FormData→入力の変換で文字列以外・欠落・重複キーを拒否し、UUIDなどの余計な入力を採用しないテストを書く。
- [x] 登録ユースケースの無効入力・重複・UNAVAILABLEをフォームのstateへ変換し、失敗時は認証・redirectを呼ばないテストを書く。
- [x] 登録成功後にのみCredentials認証を呼び、Cookieの設定後に `/` へredirectするテストを書く。Next.jsとAuth.jsの境界だけをstubし、業務処理はユースケーステストで検証する。
- [x] Credentials authorizeがAuthenticateUserを利用し、JWT/sessionのユーザー識別子がUUIDで、hashを含まないことを検証する。
- [x] 登録後にAuth.jsが失敗した場合は `ACCOUNT_CREATED_SESSION_FAILED` のstateを返す。登録失敗扱いの再作成・ユーザー削除をしないテストを書く。
- [x] `signIn('credentials', { displayId, password, redirect: false })` を使う。成功を確認後、通知用フラグを渡して、try/catchの外で `redirect('/')` を呼ぶ。予期しない認証結果を成功扱いにしない。
- [x] 通知フラグは認証・権限判定には使わない。今回の成功通知はsessionStorageの一度限りのキーで受け渡す方式ではなく、短命の通知Cookieと次項の消費処理を使う。
- [x] 最小ログインActionも同じCredentials認証を利用し、成功時は `/`、失敗時はID・パスワード不一致の一般メッセージとする。
- [x] `AUTH_SECRET` は環境変数から読み、テスト専用値と実環境値を分ける。Node.js runtimeを使用する。

### Task 7: 登録フォーム・通知・遷移先をTDD

**Files:** `app/signin/page.tsx`、`app/ui/account/{create-account-form,login-form}.tsx`、`app/login/page.tsx`、`app/ui/notifications/{toast,account-created-flash}.tsx`、`app/page.tsx`、`app/layout.tsx`、`test/unit/ui/*.test.tsx`。

- [x] 画面案に沿ったID・名前・パスワードと、追加の任意bio欄、登録ボタン、ログインリンクをラベルで取得するテストを書く。
- [x] `useActionState` で結果とpendingを扱う。送信中は登録ボタンを無効化し、項目エラーを `aria-describedby` と `aria-invalid` で関連付ける。通常のPOSTで利用できるformにする。
- [x] 失敗時は名前・ID・bioだけ保持し、パスワードはサーバーstateに返さない。欄エラーと上部失敗通知が同時に表示されることを検証する。
- [x] Toastはrole=status/alertを用途で使い分け、fake timerで2999msでは表示・3000msで非表示を検証する。同じエラーが連続しても表示が再開し、再表示から3秒で消えることを確認する。
- [x] 成功通知Cookieは個人情報を含まない固定値、path=/、短命、SameSite=Lax、実運用HTTPSではSecureとする。表示専用なのでHttpOnlyにはせず、Client Componentが読み取った直後に削除する。認証CookieはAuth.jsに任せ、JSから読まない。
- [x] `AccountCreatedFlash` はルートのlayoutで常時マウントせず、遷移先のメイン画面でマウントし、Cookieを消費後に成功Toastを起動する。Strict Modeの二重effect、再読込、別画面への移動で通知が重複しないテストを書く。
- [x] メイン画面はサーバー側 `auth()` で認証済みUUIDに対応する表示名・IDを表示する。未ログイン時はログイン・登録の導線を表示する。投稿一覧は実装しない。
- [x] `/login` は最小の復帰用フォームを作成し、保存済みアカウントでログインできる。登録画面から移動できることを検証する。
- [x] `layout.tsx` でglobal.cssを読み、html lang=jaにする。画像のXロゴは既存のテキスト表現またはCSSで再現し、画像生成は不要。

### Task 8: E2Eで受け入れ条件を通す

**Files:** `test/e2e/create-account.spec.ts`、`playwright.config.ts`、`test/support/test-db.ts`。

- [x] E2Eを先に書いて未対応の画面操作で失敗させ、Task 6〜7の各挙動を実装する際の受け入れテストとして使う。E2Eの作成を実装完了後まで待たない。
- [x] `/signin` → 有効入力 → `/` → 作成済みユーザーの表示 → 3秒の成功通知 → 通知消滅を検証する。
- [x] Cookieの存在だけで認証成功と判定せず、再読込後もサーバー側で同じUUIDの利用者として表示されることを検証する。
- [x] 入力違反では `/signin` に留まり、項目エラーと3秒通知が出て、DBに行が増えないことを検証する。ブラウザの入力制約に遮られる場合はAction/unitでサーバー検証を直接確認する。
- [x] 別ブラウザcontextで `Alice_1` 登録後 `alice_1` を登録し、ID欄エラー・遷移なし・追加保存なしを検証する。
- [x] 成功通知消滅後の再読込で通知が再表示されないことを検証する。
- [x] 登録後のセッション発行失敗とDB障害はActionの境界テストで再現する。E2Eのためだけに本番用障害注入APIを追加しない。
- [x] E2EのDB行はテストごとのUUID/IDで識別して削除し、実行ごとにDB全体を破壊しない。

### Task 9: 全体検証と手順の文書化

**Files:** `README.md`、`.env.example`、必要なら `docs/front_design.md` に任意bio欄の補足。

- [x] 開発・テスト用DB、AUTH_SECRET、migration、各テストの実行方法をREADMEに書く。教材用 `/seed` はTwitter用DB準備には使わないと記載する。
- [x] `pnpm test:unit` → 単体/UI全件成功。
- [x] `pnpm test:integration` → 専用PostgreSQLと実scryptの全件成功。
- [x] `pnpm typecheck` → 既存のfonts問題、signinの空ファイル問題を含め型エラー0件。
- [x] `pnpm build` → 本番ビルド成功。DB接続をページのビルド時に実行しない。Auth.jsを使うメイン画面が静的生成に依存しないことを確認する。
- [x] `pnpm test:e2e` → 専用DB・専用サーバーで登録・自動ログイン・エラー・通知のフロー成功。
- [x] 入力欄に平文が再描画されないこと、戻り値・session・ログに秘密情報がないこと、内側の層がNext.js/DB実装をimportしていないことを確認する。
- [ ] 利用可能なGit環境では各タスクの変更ファイルだけを指定してコミットする。完了報告には実行コマンド・結果と残る制約を記す。

## 9. 実装順と完了の判定

順序は **基盤 → domain → 登録usecase → DB → ハッシュ/認証usecase → Action/Auth.js → UI → 全体検証**。Task 8のE2EテストはTask 6〜7の実装前にRedを作り、実装に合わせてGreenへ進める。

完了とは、フォームで保存できるだけでなく、大小文字違いと同時登録を含む一意性、平文を保持しない保存、登録直後のサーバー認証、失敗時の画面維持と項目エラー、双方の3秒通知までを自動テストで確認した状態をいう。

## 10. 参考資料

- 要件：`docs/functions.md`
- 画面遷移：`docs/front_design.md`
- 画面案：`docs/front/サインイン画面.png`
- データモデル：`docs/ER_diagram.drawio`
- [Xのユーザー名ルール](https://help.x.com/en/managing-your-account/x-username-rules) — 文字種・長さの公式参考。今回の長さは課題資料を基準とする。
- [Auth.js Credentials](https://authjs.dev/getting-started/authentication/credentials) — ID・パスワード認証の接続。実装では導入済みbeta.25の型・実装とも照合する。
- [Next.js redirect](https://nextjs.org/docs/app/api-reference/functions/redirect) — redirectを例外ハンドラで握り潰さない。
- [Node.js scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) — 非同期導出・salt・計算パラメータ。
- bcryptの72バイト制約：インストール済み `node_modules/bcrypt/README.md` のSecurity Issues and Concerns。
