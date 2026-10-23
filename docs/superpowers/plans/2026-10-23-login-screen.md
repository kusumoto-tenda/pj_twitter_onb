# ログイン画面 Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、下記タスクを1挙動ずつRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の `/login` を仕上げ、利用者がIDとパスワードでログインでき、入力ミス・認証失敗・障害・送信中の状態を判断できるようにする。

**Architecture:** 既存の `LoginPage → LoginForm → loginAction → Auth.js Credentials → authenticateUser → UserRepository / PasswordHasher` を再利用する。追加する入力ルールはdomainに置き、Actionと認証ユースケースの双方から利用する。画面、HTTP、Cookie操作をapplication/domainに持ち込まない。

**Tech Stack:** 導入済みNext.js 16.4.2、React 19.3.1、next-auth 5.0.0-beta.32、TypeScript、Vitest、Testing Library、Playwright、PostgreSQL、scrypt。依存パッケージ・DBスキーマの追加は不要。

**Status:** 実装前の計画案。今回はこの文書のみ作成する。資料にない追加判断は第3節で区別する。

---

## 1. 画面単位で進める際の境界

画面を作業単位にし、その画面で利用者が操作を完了できるまでのユースケース・認証・保存・テストを縦に扱う。ファイル配置は引き続き `app / application / domain / infra` の責務で分ける。

ログイン画面だからといって認証処理を `app/login` に集約したり、既存の認証ユースケース・Repository・Hasherを別途作り直したりしない。ログアウトは別の操作として次の計画に分ける。

## 2. 資料と実装済みの範囲

根拠：

- `docs/functions.md`：認証はユーザーID＋パスワード。ログイン・ログアウトが可能。3秒通知の指定はログアウト時にある。
- `docs/front_design.md`：ログインは `/login`、登録は `/signin`、メインは `/`。
- `docs/front/ログイン画面.png`：見出し「すべての話題が、ここに。」、ID、パスワード、ログインボタン、サインインリンク、右側ロゴ。
- `docs/superpowers/plans/2026-10-23-create-account.md`：登録直後の認証失敗から復帰できる最小ログインは実装済み。

| 既存のもの | 今回の扱い |
| --- | --- |
| `app/login/page.tsx` | 画面案を保ちつつ、ログイン済みの場合の遷移と狭い画面の対応を追加 |
| `app/ui/account/login-form.tsx` | 欄ごとの入力エラー、送信中の文言とテストを追加 |
| `app/login/actions.ts` | 入力違反・認証不一致・障害の結果を明示的に分ける |
| `application/users/authenticate-user.ts` | 不正な資格情報をDBやHasherに渡す前に検証する |
| `app/_auth/config.ts` | Credentials → 認証ユースケースの既存接続を維持 |
| Postgres Repository / scrypt Hasher | 再利用。今回のための再実装・アルゴリズム変更なし |
| 既存の登録E2Eに含まれるログインケース | 登録フローの回帰として維持。詳細は新しいログインE2Eへ |

今回の対象外：ログアウト、パスワード再発行・変更、メール/OAuth認証、ログイン先のタイムライン実装、任意のURLへ戻すcallbackUrl、認証基盤の置換。

## 3. 画面の仕様と補完判断

資料に明示されているのは経路・画面要素・ID＋パスワード方式まで。以下は今回の仕上げとして提案する仕様であり、Twitter全体の仕様を追加するものではない。

### 入力・失敗時

- IDの大文字小文字は区別せず認証し、表示用の綴りは登録済みの値を使う。
- IDは登録時と同じ5〜15文字・半角英数字とアンダーバー。`@` や前後空白を自動除去しない。
- パスワードは登録時と同じ8〜50コードポイント。trim、大小文字変換、Unicode正規化をしない。
- 名前・bioなど登録専用の項目をログイン画面に持ち込まない。
- 空欄と形式違反は該当欄に説明し、認証処理は呼ばない。型・File・重複キーなど不正な送信は一般的な入力エラーとして拒否する。
- 未登録IDと誤パスワードは、ともに「ユーザーIDまたはパスワードが違います」。どちらが不一致か表示しない。
- DB障害などは「ログインできませんでした。時間をおいて再度お試しください」。認証不一致と区別する。
- 失敗時は `/login` に留まり、IDだけを保持し、パスワードは空に戻す。
- エラーはフォーム内で修正まで表示する。ログイン成功・失敗の3秒Toastは追加しない。既存の登録成功Toastは維持する。
- 送信中はボタンを無効にし「ログイン中…」を表示する。二重クリックで追加送信しない。

### 成功・セッション

- 成功後は既存の認証Cookieを設定して `/` へ移動。再読込後もサーバー側で同じ内部UUIDの利用者として認証できる。
- セッションの7日という既存設定を維持する。保存先やCookieの独自実装を追加しない。
- 既に認証済みでDBにも利用者が存在する場合、GET `/login` は `/` に移動する。
- セッションがない・期限切れ・利用者が存在しない場合はログインフォームを表示する。Cookieが存在することだけで認証済み扱いにしない。
- ログイン画面の既存利用者確認中にDB障害が起きてもフォームを表示できるようにする。送信時の障害は上記の一般メッセージで扱う。
- Actionの成功遷移は既存どおりtry/catchの外で実行する。任意のリダイレクト先をクライアントから受け取らない。

### レイアウト・操作

- PCでは画面案の見出し・左側フォーム・右側ロゴを維持。
- 幅375pxではロゴを非表示にし、ボタンとリンクを折り返して横スクロールを出さない。
- ラベル、`autocomplete=username/current-password`、`aria-invalid`、`aria-describedby` を使う。
- 認証不一致・障害のメッセージは `role=alert`、欄エラーは対応する入力に関連付ける。
- Enterで送信でき、キーボードで入力欄・ボタン・登録リンクを操作できる。

## 4. 実装方式の比較

| 案 | 利点・負担 | 判断 |
| --- | --- | --- |
| 既存のServer Actionと認証ユースケースを拡張 | 登録時の自動ログインと同じ認証を利用でき、変更が小さい | 推奨 |
| ログイン専用Route Handlerを作る | 他クライアント向けAPIには使いやすいが、今回はHTTP処理が重複 | 今回は不要 |
| クライアント側だけで入力検証する | 画面の反応は作れるが、直接POSTする経路で回避できる | サーバー検証の代替にはしない |

## 5. 変更ファイルと契約

```text
Create:
  domain/users/login-validation.ts
  test/unit/domain/login-validation.test.ts
  test/unit/app/login-page.test.tsx
  test/e2e/login.spec.ts

Modify:
  application/users/authenticate-user.ts
  app/login/form-state.ts
  app/login/actions.ts
  app/login/page.tsx
  app/ui/account/login-form.tsx
  test/unit/application/authenticate-user.test.ts
  test/unit/app/account-actions.test.ts
  test/unit/ui/login-form.test.tsx
  test/unit/app/auth-config.test.ts
  README.md
  docs/front_design.md
```

`domain/users/login-validation.ts` は既存の `validateDisplayId` と `validatePassword` を再利用する。`Credentials` は既存のapplicationの型と構造的に一致する引数にし、domainからapplicationをimportしない。

```ts
export type LoginFieldErrors = Partial<Record<'displayId' | 'password', string[]>>;
export type LoginValidationResult =
  | { ok: true }
  | { ok: false; fieldErrors: LoginFieldErrors };
// validateLoginInput(input: { displayId: string; password: string }): LoginValidationResult
```

フォームのstateは次の形へ拡張する。型を変更する際は既存のテスト内の戻り値fixtureも更新する。

```ts
type LoginFormState =
  | { status: 'idle' }
  | {
      status: 'error';
      code: 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'UNAVAILABLE';
      message: string;
      fieldErrors: LoginFieldErrors;
      displayId: string;
      attempt: number;
    };
```

パスワードはstate・URL・セッション・ログに含めない。`authenticateUser` の外部契約は公開プロフィールまたはnullのまま維持し、入力違反もnullを返す。DB障害は既存どおりthrowして上位で区別する。

## 6. TDDタスク

各チェック項目の新しい挙動に対して、テスト追加 → 意図した失敗を実行で確認 → 最小修正 → 成功確認 → 必要なリファクタリング、を繰り返す。既に成功している挙動のテストは回帰として維持し、新機能のRed確認とは扱わない。

### Task 1: ログイン入力の検証

**Files:** `domain/users/login-validation.ts`、`test/unit/domain/login-validation.test.ts`。

- [x] ID・パスワードが両方空なら両方の欄エラーが返るテストから始める。
- [x] IDの4/5/15/16文字、許可文字、`@`・空白・全角をテストする。既存validatorを組み合わせ、登録フォーム全体のvalidatorは呼ばない。
- [x] パスワードの7/8/50/51コードポイント、Unicode、前後空白を含めた長さをテストする。入力値を加工しないことを確認する。
- [x] 期待する失敗を観測後、最小限の集約処理を実装する。

テスト例：

```ts
it('空欄は両方の入力欄にエラーを返す', () => {
  const result = validateLoginInput({ displayId: '', password: '' });
  expect(result).toEqual({
    ok: false,
    fieldErrors: {
      displayId: expect.any(Array),
      password: expect.any(Array),
    },
  });
});
```

最小実装の形：

```ts
const fieldErrors: LoginFieldErrors = {};
const idErrors = validateDisplayId(input.displayId);
const passwordErrors = validatePassword(input.password);
if (idErrors.length) fieldErrors.displayId = idErrors;
if (passwordErrors.length) fieldErrors.password = passwordErrors;
return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true };
```

Run: `pnpm exec vitest run --project unit test/unit/domain/login-validation.test.ts`。

### Task 2: 認証ユースケースとActionの入力経路

**Files:** `application/users/authenticate-user.ts`、`app/login/{form-state,actions}.ts`、`test/unit/application/authenticate-user.test.ts`、`test/unit/app/account-actions.test.ts`、`test/unit/app/auth-config.test.ts`。

- [x] 不正な資格情報なら `authenticateUser` はnullを返し、Repository・Hasherを呼ばないテストを書く。これによりAuth.jsの直接呼び出し経路にもサーバー検証を適用する。
- [x] 正しい資格情報、大小文字違い、未登録、誤パスワード、DB障害の既存テストを維持する。
- [x] `loginAction` で空欄・形式エラーを `INVALID_INPUT` と欄エラーへ変換し、`signIn` を呼ばないテストを書く。
- [x] File・重複キー・欠落は `INVALID_INPUT` と一般的なメッセージに変換する。戻り値に平文が含まれないことを検証する。
- [x] 不一致のthrowとエラーURLの両方は `INVALID_CREDENTIALS`、想定外例外・無効な戻り値は `UNAVAILABLE` にするテストを書く。返却URLの解釈を変更する場合は登録Actionの既存テストも通す。
- [x] 再送でattemptが増え、IDだけを保持することを検証する。
- [x] 成功時のみ `/` へredirectし、遷移の例外を失敗stateに変換しないことを検証する。

テスト例（既存のboundary mockとform helperを利用）：

```ts
it('空欄では認証せず、項目エラーを返す', async () => {
  const state = await loginAction(initialLoginState, form({ displayId: '', password: '' }));
  expect(state).toMatchObject({
    status: 'error', code: 'INVALID_INPUT',
    fieldErrors: { displayId: expect.any(Array), password: expect.any(Array) },
  });
  expect(boundary.signIn).not.toHaveBeenCalled();
});
```

Run: `pnpm exec vitest run --project unit test/unit/application/authenticate-user.test.ts test/unit/app/account-actions.test.ts test/unit/app/auth-config.test.ts`。

### Task 3: 欄エラー・送信中・狭い画面

**Files:** `app/ui/account/login-form.tsx`、`test/unit/ui/login-form.test.tsx`。

- [x] 新しいstate型に既存fixtureを更新する。その変更自体を新挙動のRedとは数えない。
- [x] 入力違反を返すActionで送信し、欄エラー・aria属性が表示されるテストを書く。
- [x] 失敗時にIDだけを保持し、パスワードを空にする既存テストを維持する。
- [x] 保留中のPromiseを返すActionで送信し、「ログイン中…」・disabled・aria-busyを確認する。追加クリックでActionが再実行されないことを検証してからPromiseを解決する。
- [x] 同じ認証エラーで連続失敗しても、メッセージと再入力欄が正しく表示されることを確認する。
- [x] 登録リンクを維持し、ボタン群に折り返しを設定する。レイアウトの実寸はTask 5で確認し、CSSのclass文字列そのものをテストしない。

最小変更の形：

```tsx
<FormField id="displayId" label="ユーザーID" errors={failed?.fieldErrors.displayId}>
  {/* 既存のID入力 */}
</FormField>
<FormField id="password" label="パスワード" errors={failed?.fieldErrors.password}>
  {/* 既存のパスワード入力 */}
</FormField>
// ボタン文言: pending ? 'ログイン中…' : 'ログイン'
// ボタン群: flex flex-wrap items-center ...
```

Run: `pnpm exec vitest run --project ui test/unit/ui/login-form.test.tsx`。

### Task 4: ログイン済みの場合の画面遷移

**Files:** `app/login/page.tsx`、`test/unit/app/login-page.test.tsx`。

- [x] `auth()` がnullならフォームを表示するテストを書く。
- [x] 有効なsession.user.idとDB上のプロフィールがあれば、`redirect('/')` になるテストを書く。
- [x] sessionにUUIDがない、DB上に利用者がいない場合はフォームを表示するテストを書く。
- [x] DB照会がthrowしてもフォームを表示するテストを書く。エラーオブジェクトを画面やログに露出しない。
- [x] Server Componentをasyncにし、既存 `auth()` と `findAccountProfile` を再利用する。プロフィール確認だけをtry/catch内で行い、redirectはcatchの外に置く。
- [x] 見出し・ロゴ・メタデータを維持する。ページ内にDB接続の具体実装を新設しない。

テストはNext.js/Auth.js/組み立ての境界だけをmockする。`findAccountProfile` の業務ロジック自体は既存の単体テストを利用する。

Run: `pnpm exec vitest run --project ui test/unit/app/login-page.test.tsx`。

### Task 5: ログイン専用E2E

**Files:** `test/e2e/login.spec.ts`。既存 `playwright.config.ts`、`test/e2e/global-setup.ts`、`test/support/test-db.ts` は再利用する。

- [x] Task 2〜4の実装前に、追加挙動の代表E2Eを書いてRedを確認する。既存の正常ログインだけではRedにならない点に注意する。
- [x] 既存の `createAccount` ユースケースと実Repository・Hasherで専用テストDBに利用者を用意する。登録UIを通らないため、ログイン単独の失敗を判別できる。
- [x] PlaywrightのCJS変換でinfraのimport.meta.urlを評価させない。fixtureに必要なモジュールのみを読み、マイグレーションは既存global setupに任せる。
- [x] 正しいパスワードと大小文字を変えたIDでログイン → `/` → 対応する利用者の表示 → 再読込後も同一利用者の表示を確認する。
- [x] 未登録IDと誤パスワードで同じメッセージになり、`/login` に留まり、パスワードが空になることを確認する。
- [x] 空欄・ID形式違反の欄エラーを確認し、認証済みの表示が出ないことを確認する。
- [x] ログイン済みのcontextで `/login` にアクセスすると `/` に戻ることを確認する。
- [x] 新しいcontextでは `/login` のフォームが表示され、キーボードのEnterで送信できることを確認する。
- [x] 幅375pxで入力欄・ボタン・登録リンクが見え、`document.documentElement.scrollWidth <= window.innerWidth` を確認する。PC幅では右側ロゴも確認する。
- [x] DB障害はActionの境界テストで再現し、本番用の障害注入APIを追加しない。
- [x] 作成した利用者だけをUUIDまたは一意なIDで削除し、接続を閉じる。DB全体のdrop/truncateは行わない。
- [x] 既存の登録E2E4件も実行し、自動ログインと登録失敗からの復帰を壊していないことを確認する。

Run: `pnpm exec playwright test test/e2e/login.spec.ts`、その後 `pnpm test:e2e`。

### Task 6: 全体検証と文書

**Files:** `README.md`、`docs/front_design.md`。

- [x] 画面案の要素と実装が対応していること、資料にない補完仕様を文書に追記する。
- [x] `pnpm test:unit`：登録を含む既存テストと新しいログインテストが成功。
- [x] `pnpm test:integration`：Repositoryとscryptの既存テストが成功。
- [x] `pnpm typecheck`：stateの変更に追随して型エラー0件。
- [x] `pnpm build`：本番ビルドが成功。ログインページの認証確認は実行時に行い、ビルド時のDB接続を必須にしない。
- [x] `pnpm test:e2e`：専用DB・専用サーバーで登録とログインが成功。DB分離チェックを無効化して通さない。
- [x] 開発者ツール・戻り値・ログを確認し、平文パスワードやhashがstate・URL・sessionに入っていないことを確認する。
- [x] 実行結果を記録する。実装時のコミットは変更ファイルを明示し、他作業の変更を含めない。

## 7. 完了条件

PC・375pxの双方で、入力 → 送信中 → 成功または失敗 → 修正して再送、を操作できる。IDの大小文字違い、未登録ID、誤パスワード、入力形式違反、障害が所定の結果になる。ログイン済みの遷移と再読込後の認証継続を確認し、登録フローの回帰がない。

## 8. 実装前に参照するローカルガイド

AGENTS.mdに従い、実装時点の導入バージョンにある以下を読む。今回の計画時にもredirectとServer Actionの説明を確認した。

- `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`

Auth.jsの呼び出し方法は導入済み `node_modules/next-auth` の型・実装に合わせ、既存の成功しているCredentials + JWTの接続を利用する。
