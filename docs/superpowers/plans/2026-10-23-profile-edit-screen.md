# プロフィール編集画面 Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、各挙動をRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本人だけが `/profile/{ユーザーID}/edit` で名前・ユーザーID・自己紹介を編集でき、保存後は更新済みのプロフィールへ戻れる。

**Architecture:** domainの既存ルールを再利用して編集入力を検証し、applicationが本人確認と更新を担当する。infraは内部UUIDを条件とする3列のUPDATEと一意制約の競合処理を実装する。appが認証・フォーム・通知・キャッシュ更新・画面遷移を担当し、画面と保存処理の双方で認可する。

**Tech Stack:** 既存のNext.js、React、TypeScript、Auth.js、postgres、Vitest、Testing Library、Playwright。テーブル・外部サービス・依存パッケージの追加は不要。

**Status:** 実装前の計画。今回は文書のみ作成する。資料にない保存後の動作・通知・競合方針は第2節の補完仕様として扱う。

---

## 1. 資料と今回の範囲

根拠：

- `docs/functions.md`：本人のプロフィールに編集ボタン。名前・ユーザーID・bioを同じ画面で編集。パスワード変更は対象外。
- `docs/front_design.md`：編集URLは `/profile/{ユーザーID}/edit`。
- `docs/front/プロフィール編集画面.png`：閉じる導線、保存ボタン、名前・自己紹介の入力欄。画像はオプション。
- 既存の登録ルール：名前1〜50文字、ID5〜15文字・半角英数字とアンダーバー・重複不可、bio0〜160文字。

画面案にユーザーID欄はないが、明示された機能一覧を優先して追加する。画像、パスワード変更、アカウント削除、フォロー操作は今回含めない。

既存の `twitter.users` とIDの大小文字を区別しない一意インデックスを使い、新しいmigrationは作らない。

## 2. 挙動と補完仕様

### 入場・本人確認

- 自分のプロフィールだけに「プロフィール編集」リンクを追加する。既存の「自分のプロフィール」表示は維持する。
- 未ログインで編集URLにアクセスしたら `/login` へ移動する。任意のcallbackUrlへの戻り機能は追加しない。
- ログイン中でURLのIDが自分の現在のIDと一致すれば表示する。比較では大小文字を区別しない。
- 他人のID・形式違反のID・自分の変更前の古いIDで編集URLを開いたら、既存のプロフィール用not-found表示にする。
- セッションは残っているが利用者が存在しない場合はログインへ。利用者照会の障害は未ログインと混同せず、再試行表示にする。
- 表示判定だけで保存を許可しない。保存時にも新たにサーバーでセッションと利用者を確認する。
- 編集対象は画面表示時に内部UUIDで固定し、Actionへbindする。bind値・hidden値も認可の代替とはせず、applicationで `actorId === targetId` を検証する。
- フォーム表示後に別アカウントでログインし直しても、以前のフォームから元の利用者や現在の利用者を誤って更新しない。

### 入力・保存・キャンセル

- 現在の名前・ID・bioを初期表示する。パスワードやハッシュは取得結果からフォームpropsへ渡さない。
- 名前は前後trim後1〜50コードポイント。IDは加工せず既存ルールで検証し、表示用の大文字小文字を保持する。bioは改行・前後空白を保持し、未入力は空文字。
- エラーは全項目分を集めて該当欄に表示する。bio空欄は既存の内容を消す操作として保存する。
- 未変更のIDは保存できる。`Alice_1` → `ALICE_1` のような本人の大小文字だけの変更も許可する。
- 他人が使うIDとの大小文字違いの重複は、ID欄に「このユーザーIDは既に使われています」。保存済みの名前・ID・bioはいずれも変えない。
- 保存は3項目を1つのUPDATEで行う。UUID・作成日・password_hash・投稿・フォロー・リツイートの外部キーは変更しない。
- 保存中は「保存中…」とし、ボタンを無効化する。Enter送信も同じ処理を使う。
- 通常の入力／重複／DBエラーでは編集画面に留まり、入力した3項目を保持する。DB障害は入力違反と分けて一般的なメッセージを表示する。
- 保存成功時は新しい保存済みIDのプロフィール先頭へ移動する。IDを変えなくても同じ動作。
- 「プロフィールを更新しました」を遷移先で3秒だけ表示し、再読込時は再表示しない。これは今回の補完仕様。失敗はフォーム内に修正・再試行まで表示し、失敗用Toastは追加しない。
- 画面上部の閉じる導線は、編集前の保存済みIDのプロフィールへ戻るLinkとし、アクセシブル名を「編集をキャンセル」とする。入力を保存しない。未保存変更の確認ダイアログは今回追加しない。

### ID変更・セッション・競合

- セッションの識別子は既存どおりUUID。ID変更で再ログインを要求せず、JWTに表示用IDや名前を書き足さない。
- 変更後の名前・IDは、プロフィール、メイン画面、投稿者リンク、リツイート実行者、フォロー／フォロワー一覧、ナビに反映する。
- 旧IDのURLは別名として保持しない。未使用なら404となり、後で他の利用者がそのIDを取得すれば、その人の公開プロフィールを指す。本人確認には引き続きUUIDを使う。
- 新IDは以後の認証に使え、旧IDでは同じ利用者として認証できない。パスワードは変更しない。
- 異なる利用者が同じ新IDへ同時変更した場合は、一意制約により片方だけ成功する。登録と変更の同時競合も同様に扱う。
- 本人が複数タブから同時保存した場合は、最後に成功した保存を採用する。今回はバージョン列・楽観ロック・競合ダイアログを追加しない。
- 名前等を変更しても、カーソルに含まれる内部UUID・投稿日時・関係日時は変わらないため、既存のページ送りを維持する。

## 3. 実装方式の比較

| 案 | 特徴 | 判断 |
| --- | --- | --- |
| Server Action + 更新ユースケース + UUID指定UPDATE | 既存フォームと認証の仕組みに合い、認可と業務ルールを単体テストできる | 推奨 |
| 汎用アカウント全体の上書き保存 | 認証情報や作成日まで誤って上書きしやすい | 採用しない |
| 新規REST更新API + クライアントfetch | 外部クライアントには便利だが、今回の要件では入口が増える | 今回は不要 |

IDの事前検索は一意性の保証にはならない。UPDATE時のDB一意制約が最終判断を行う。

## 4. 型・ポート・認可契約

`domain/users/profile-edit-validation.ts` に編集入力と検証を置く。既存の `validateName`、`validateDisplayId`、`validateBio` を使い、パスワード必須の登録validatorは呼ばない。

```ts
type EditProfileInput = { name: string; displayId: string; bio?: string };
type ValidEditProfileInput = { name: string; displayId: string; bio: string };
type EditProfileFieldErrors = Partial<Record<keyof ValidEditProfileInput, string[]>>;
type EditProfileValidation =
  | { ok: true; value: ValidEditProfileInput }
  | { ok: false; fieldErrors: EditProfileFieldErrors };
```

既存 `UserRepository` に、更新可能な3項目だけを受け取るメソッドを追加する。入力型はdomainからimportし、戻り値は公開情報のみ。

```ts
type UpdateProfileOutcome =
  | { status: 'updated'; profile: AccountProfile }
  | { status: 'display-id-taken' }
  | { status: 'not-found' };

// UserRepositoryへの追加メソッド
updateProfile(id: string, input: ValidEditProfileInput): Promise<UpdateProfileOutcome>;

type UpdateProfileResult =
  | { ok: true; profile: AccountProfile }
  | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'DISPLAY_ID_TAKEN' | 'UNAVAILABLE' }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: EditProfileFieldErrors };
```

`updateProfile` ユースケースの入力は `{ actorId: string | null; targetId: string; input: EditProfileInput }`、依存は `Pick<UserRepository, 'updateProfile'>`。

1. actorIdなしはUNAUTHENTICATED、対象と違えばFORBIDDEN。どちらもRepositoryを呼ばない。
2. domainで入力を検証し、INVALID_INPUTなら保存しない。
3. Repositoryの結果を公開結果へ変換。想定外例外はUNAVAILABLE。

対象の存在はUPDATEの返却行で確認する。事前にアカウント全体を読み出して保存し直す必要はない。

### Repositoryの更新

```sql
UPDATE twitter.users
SET name = $1, display_id = $2, bio = $3
WHERE id = $4
RETURNING id, name, display_id, bio, created_at;
```

- SQLはpostgres.jsのパラメータ化されたテンプレートで実装する。
- 0行はnot-found。成功の戻り値にpassword_hashは含めない。
- SQLSTATE `23505` **かつ** `users_display_id_ci_unique` の制約違反だけをdisplay-id-takenに変換する。接続障害・CHECK違反・他の制約違反はthrowする。
- 一意制約違反でUPDATE文全体が失敗するため、名前やbioだけ変わった状態にならない。複数UPDATEや別トランザクションへ分割しない。

## 5. Action・ページ・更新後の表示

- `app/profile/[displayId]/edit/page.tsx` は `params` をawaitし、resolveViewerの結果から入場判定する。
- 初期表示にはresolveViewerが返す公開プロフィールを使い、表示のためだけに同じアカウントを再取得しない。URLの大小文字違いは同じ編集対象として扱う。
- Actionは対象UUIDをbindし、毎回resolveViewerを呼ぶ。actorIdはそこから作り、FormDataのid・owner・actorId・createdAt・passwordHashを採用しない。
- 未認証は `/login`、別アカウントから以前のフォームを送った場合はFORBIDDENのstateと「このプロフィールは編集できません」を返す。別アカウントを代わりに更新しない。
- 利用者照会に失敗したらUNAVAILABLEを返し、更新ユースケースを呼ばない。セッションだけ残った利用者は未認証として扱う。
- FormDataは既存 `readStringFields` で解析し、File・重複キー・必須欄欠落を拒否する。bio欠落は空文字。previousStateやhidden値を権限判断に使わない。
- 通常失敗のstateには `code / fieldErrors / values / attempt / message` を持たせる。valuesは名前・ID・bioだけ。成功はredirectで終わる。
- NOT_FOUNDは「アカウントを確認できません。再度ログインしてください」とし、保存成功とは扱わない。
- 更新後は `revalidatePath('/')`、`revalidatePath('/profile/[displayId]', 'page')`、`revalidatePath('/profile/[displayId]/edit', 'page')` で、メイン・公開プロフィール・編集フォームの訪問済み表示を無効化してから新URLへredirectする。導入バージョンのガイドとE2Eで実際の戻る／進むも確認する。
- 保存後のredirectはtry/catchの外。クライアント提供のURLを遷移先にしない。
- 成功通知には個人情報を含めない専用の表示用Cookieを使い、プロフィールページのClient Componentで一度だけ消費する。登録用のflash Cookieを上書き・流用しない。
- 成功通知はStrict Modeでも重複せず3秒で消える。Cookieの処理・属性は既存の登録通知に合わせ、認証Cookieは独自実装しない。
- 編集ルート専用のloadingを作る。画像欄や未実装操作を押せる形で置かない。PC/375pxで閉じる・保存・入力欄が使えるようにする。

## 6. ファイル構成

```text
Create:
  domain/users/profile-edit-validation.ts
  application/users/update-profile.ts
  app/profile/[displayId]/edit/page.tsx
  app/profile/[displayId]/edit/loading.tsx
  app/profile/[displayId]/edit/actions.ts
  app/profile/[displayId]/edit/form-state.ts
  app/profile/[displayId]/edit/parse-form.ts
  app/ui/profile/profile-edit-form.tsx
  app/ui/notifications/profile-updated-flash.tsx
  test/unit/domain/profile-edit-validation.test.ts
  test/unit/application/update-profile.test.ts
  test/unit/app/profile-edit-actions.test.ts
  test/unit/app/profile-edit-page.test.tsx
  test/unit/ui/profile-edit-form.test.tsx
  test/unit/ui/profile-updated-flash.test.tsx
  test/integration/postgres-profile-update.test.ts
  test/e2e/profile-edit-screen.spec.ts

Modify:
  application/users/ports/user-repository.ts
  infra/repositories/postgres-user-repository.ts
  test/support/in-memory-user-repository.ts
  app/ui/profile/profile-header.tsx
  app/profile/[displayId]/page.tsx
  app/ui/notifications/flash.ts
  test/unit/ui/profile.test.tsx
  README.md
  docs/front_design.md
```

フォームは既存FormField、通知は既存Toast、編集画面は既存PageShellを使う。compositionは既存の `getAccountDependencies` を再利用し、更新ユースケースへ必要なusersだけを渡す。

## 7. TDDタスク

代表E2EはTask 4のUI・Action実装前に書き、意図したRedを確認する。各タスクも1挙動ずつ、テスト追加 → 失敗の観測 → 最小実装 → 成功 → 必要な整理、の順に進める。

### Task 1: 編集入力のdomain検証

**Files:** `domain/users/profile-edit-validation.ts`、`test/unit/domain/profile-edit-validation.test.ts`。

- [x] 名前の空・1/50/51文字・trim後空文字・Unicode、IDの4/5/15/16文字・許可文字・全角・空白・@、bioの空・160/161文字をテストする。
- [x] 名前だけtrimし、ID・bioは加工しないこと、bio省略が空文字になることを確認する。
- [x] 複数欄の違反をまとめて返し、パスワードなしで検証できるテストを書く。
- [x] 最小実装として既存の3validatorを組み合わせ、検証済みの3項目だけを返す。

Run: `pnpm exec vitest run --project unit test/unit/domain/profile-edit-validation.test.ts`。

### Task 2: 更新ユースケース・本人認可

**Files:** `application/users/{update-profile.ts,ports/user-repository.ts}`、`test/support/in-memory-user-repository.ts`、`test/unit/application/update-profile.test.ts`。

- [x] ポート追加に伴ってfakeの型を更新する。型を合わせただけの成功を新挙動のRedとは数えない。
- [x] 本人の更新で3項目だけが変更されるテストから実装する。UUID・createdAt・passwordHashを保存前後で比較する。
- [x] actorIdなし・actorIdとtargetIdの不一致はRepositoryを呼ばないテストを書く。
- [x] 同じID・大小文字だけの変更・bioクリアを個別に検証する。
- [x] 無効入力、競合、0行、Repository例外をそれぞれの結果に変換するテストを書く。
- [x] 成功結果にパスワードやハッシュが存在しないことを確認する。

代表ケース：

```ts
it('別利用者は更新せずFORBIDDENを返す', async () => {
  const update = vi.fn();
  const result = await updateProfile(
    { users: { updateProfile: update } },
    {
      actorId: '00000000-0000-4000-8000-000000000001',
      targetId: '00000000-0000-4000-8000-000000000002',
      input: { name: '変更', displayId: 'Changed_1', bio: '' },
    },
  );
  expect(result).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(update).not.toHaveBeenCalled();
});
```

Run: `pnpm exec vitest run --project unit test/unit/application/update-profile.test.ts`。

### Task 3: 実DBでの更新・競合・関係維持

**Files:** `infra/repositories/postgres-user-repository.ts`、`test/integration/postgres-profile-update.test.ts`。

- [x] 実データ更新・0行・同一ID保存・本人の大小文字だけの変更を1つずつRed→Greenにする。
- [x] 他人のIDと大小文字違いで競合した場合、名前・ID・bioが全部元のままであることを確認する。
- [x] 2人が同じ新IDへ同時更新し、片方だけ成功するテストを書く。登録処理との競合でも同じ一意制約を使うことを検証する。
- [x] UUID・作成日・password_hashと、投稿・フォロー・リツイートの関連UUIDが変わらないことを確認する。
- [x] 新IDで認証でき、旧IDでは同じUUIDを取得しないことを、既存AuthenticateUserと実Hasherを使って検証する。
- [x] ヘッダー・タイムライン・フォロー一覧の読み取りが更新後の名前・IDを返すことを確認する。
- [x] 接続障害や一意性以外のCHECK違反をdisplay-id-takenと誤分類しないことを検証する。
- [x] 専用テストDBだけで作成・更新し、自身のfixtureを削除して接続を閉じる。

Run: `pnpm exec vitest run --project integration test/integration/postgres-profile-update.test.ts`。

### Task 4: 編集画面・Action・通知・導線

**Files:** `app/profile/[displayId]/edit/*`、`app/ui/profile/{profile-edit-form,profile-header}.tsx`、`app/ui/notifications/{flash.ts,profile-updated-flash.tsx}`、公開プロフィールページ、対応するunit/UIテスト。

- [x] 編集ページで本人・ID大小文字違い・未ログイン・他人・古いID・利用者なし・DB障害をテストし、表示時の入場判定を実装する。
- [x] Actionは呼ぶたびにviewerを取り直すテストを書く。フォーム表示後に別アカウントへ変わった場合、以前の対象も現在の利用者も更新しないことを確認する。
- [x] File・重複キー・必須欄欠落を拒否し、クライアントの余計なUUID・createdAt・hash・actorIdを無視することを確認する。
- [x] 入力違反は欄エラー、競合はID欄、DB障害は全体メッセージにし、値を保持して再送できることを確認する。
- [x] 初期値・bioクリア・キャンセル・Enter送信・保存中の文言とdisabled・二重送信防止をテストする。
- [x] 成功後はキャッシュ無効化→通知Cookie設定→新しい保存済みIDのURLへredirect、の順をテストする。redirectをcatchしない。
- [x] 自分のヘッダーだけに編集リンクを表示し、他人・未ログインには出さない。プロフィールの既存テストを維持する。
- [x] 成功通知を3秒で消し、再マウント・Strict Modeで重複しないテストを書く。登録成功通知とのCookie名を分ける。
- [x] 375pxでヘッダー・保存・閉じる・3項目の入力を操作できるようにする。氏名やbioが長くても横スクロールを出さない。

Run: `pnpm exec vitest run --project unit test/unit/app/profile-edit-actions.test.ts`、`pnpm exec vitest run --project ui test/unit/app/profile-edit-page.test.tsx test/unit/ui/profile-edit-form.test.tsx test/unit/ui/profile-updated-flash.test.tsx test/unit/ui/profile.test.tsx`。

### Task 5: 編集E2Eと既存画面の回帰

**Files:** `test/e2e/profile-edit-screen.spec.ts`。

- [x] UI実装前に、自分の編集リンク→初期値→3項目保存→新プロフィールURLと3秒通知、のE2Eを書きRedを確認する。
- [x] ID変更後に再読込しても同じ内部UUIDでログイン済みであり、ナビ・メインの投稿者・フォロー一覧のリンクが新IDを使うことを確認する。
- [x] 事前に旧プロフィール・メイン画面を訪問し、更新後にブラウザで戻る／進む・ホームリンクから再訪しても古い名前やIDが残らないことを検証する。
- [x] 新しいブラウザcontextで、新IDと元のパスワードによりログインできる。旧IDでは同じ利用者としてログインできない。
- [x] 不正入力・他人のIDとの大小文字違いの競合では、画面に留まり欄エラーと入力値を表示し、DBの3項目は更新されない。
- [x] 未変更ID、本人の大小文字だけの変更、bioクリア、キャンセル時に保存されないことを検証する。
- [x] 未ログインで編集URLはログイン画面、他人の編集URLは見つからない表示。自分の保存Actionに別アカウントのセッションが使われる場合の認可はAction境界テストでも直接確認する。
- [x] PC/375px、キーボード送信、成功通知の消滅と再読込後の非表示を確認する。
- [x] DB障害はunit境界で再現し、テスト用の本番障害注入APIを作らない。
- [x] 元のfixture IDを変更しても削除できるよう、後片付けは内部UUIDを追跡する。登録・ログイン・メイン・プロフィールの既存E2E21件も通す。

Run: `pnpm exec playwright test test/e2e/profile-edit-screen.spec.ts`、その後 `pnpm test:e2e`。

### Task 6: 全体検証・補完仕様の記録

**Files:** `README.md`、`docs/front_design.md`。

- [x] 画面案へID欄を追加する理由、本人のみの編集、保存後の通知・URL、旧ID・同時保存の扱いを記載する。
- [x] `pnpm test:unit`：既存の認証・プロフィール閲覧を含め成功。
- [x] `pnpm test:integration`：更新・競合・実認証・関係維持と既存Queryが専用DBで成功。
- [x] `pnpm typecheck`：UserRepositoryを実装するfakeを含め型エラーなし。
- [x] `pnpm build`：編集ページは認証を実行時に確認し、ビルド時のDB接続なしで成功。
- [x] `pnpm test:e2e`：専用DB・専用サーバーで全件成功。
- [x] 更新対象の3列以外が不変であること、FormDataとpreviousStateを改変しても本人確認を回避できないこと、公開結果にhashがないことを確認する。
- [x] 新規migrationなし。開発は既存 `.env.development.local`、自動テストは専用DBを使う。DB分離チェックを維持する。
- [x] Task単位で変更ファイルを明示してコミットし、merge/pushは別の指示に従う。

## 8. 実装時に読むローカルガイド

AGENTS.mdに従い、実装時点の `node_modules/next/dist/docs/` を確認する。計画作成時はServer Actionsの直接POST・認可・再描画とrevalidatePathの説明を確認した。

- `01-app/02-guides/server-actions.md`
- `01-app/01-getting-started/07-mutating-data.md`
- `01-app/03-api-reference/04-functions/revalidatePath.md`
- `01-app/03-api-reference/04-functions/redirect.md`
- `01-app/03-api-reference/04-functions/cookies.md`
- `01-app/03-api-reference/03-file-conventions/page.md`

## 9. 完了条件

本人が編集画面で現在値を確認し、名前・ID・bioを更新・キャンセルできる。未認証や他人のフォーム送信では更新せず、ID競合でも部分更新しない。新IDのURL・認証・リンクに反映され、ログイン状態・UUID・作成日・パスワード・投稿や関係を維持し、既存4画面の回帰がない。
