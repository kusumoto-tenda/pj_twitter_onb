# アカウント削除画面 Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、各挙動をRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本人が `/profile/{ユーザーID}/delete` で現在のパスワードを再入力し、アカウントと関連データを削除してログイン画面へ戻れる。

**Architecture:** applicationがセッション由来のUUIDと対象UUIDの比較、パスワード照合、削除の手順を担当する。infraはUUID指定の単一DELETEと既存ON DELETE CASCADEを利用する。appは入場・保存時の認証、フォーム、Auth.jsのsignOut、キャッシュ無効化、通知と画面遷移を担当する。

**Tech Stack:** 現在導入済みのNext.js、React、TypeScript、Auth.js、postgres、scrypt、Vitest、Testing Library、Playwright。新規テーブル・migration・外部サービスの追加は不要。

**Status:** 実装前の計画。今回の依頼では文書のみ作成する。実在するアカウントやDBの削除、アプリコードの変更は実行しない。

---

## 1. 資料と対象範囲

- `docs/functions.md`：自分のアカウントを削除できる。導線はログアウトの近く。
- `docs/front_design.md`：削除画面は `/profile/{ユーザーID}/delete`。
- `docs/front/アカウント削除画面.png`：「パスワードを確認」、登録パスワードの説明、入力欄、「戻る」「アカウント削除」。
- 既存001/002：usersを削除すると、その人の投稿、関係するfollows、本人のretweets、削除される投稿へのretweetsがCASCADEで削除される。

今回含めるもの：本人専用の画面、現在のパスワードによる再確認、実DB削除、キャンセル、失敗表示、削除後のログアウトとログイン画面への遷移、各画面から削除済みデータが消えることの確認。

今回含めないもの：通常のログアウト用UI、削除の猶予期間・復元、論理削除、パスワード再発行、未実装の画像・いいね・お気に入りデータの処理。将来それらのテーブルや外部ストレージを追加する際は、削除対象も拡張する。

## 2. 提案する補完仕様

### 入場と削除導線

- 画面案どおりパスワード再入力で確認し、別の確認モーダルやIDの再入力は追加しない。
- 「削除するとアカウント・投稿・フォロー関係・リツイートは元に戻せません」と、実際の影響を画面内に明示する。
- 通常のログアウトUIはまだないため、自分のプロフィールの操作領域へ「アカウント削除」のリンクを追加する。他人・未ログインには出さない。将来ログアウト導線を追加する際に同じ領域で整理する。
- GETのページ表示と保存Actionを分ける。GETで削除しない。
- 未ログインで削除URLを開くと `/login`。セッションが残っていても利用者がDBに存在しない場合は同じ扱い。
- URLのIDは自分の現在のIDだけを受け付け、大小文字は区別しない。他人・形式違反・変更前の古いIDは既存のnot-found表示。
- 閲覧者確認でDB障害が起きた場合は、ログインや404に変換せず再試行表示にする。
- 対象は画面表示時の内部UUIDをActionへbindして固定する。保存のたびに現在のセッションを確認し、`actorId === targetId` をユースケースで検証する。bind値・hidden値・previousStateを本人確認の代わりにしない。

### パスワード・処理中・失敗

- 入力はパスワード1項目のみ。`type=password`、`autocomplete=current-password`、関連付けたlabel・欄エラーを使う。
- 登録と同じ8〜50コードポイントを検証し、trim・改行正規化・大小文字変換をしない。bio用のnormalizeNewlinesは適用しない。
- 空欄・長さ違反は欄エラーで、DB読取・Hasher・削除を呼ばない。
- 現在の保存済みpassword_hashを、既存PasswordHasher.verifyで照合する。不一致は「パスワードが違います」。削除せず、ログイン状態も維持する。
- 送信中は「削除中…」とし削除ボタンを無効にする。Enterも同じsubmit経路を使う。
- 通常の失敗時は削除画面に留まり、パスワードを空へ戻す。state・ログ・URLにパスワードやハッシュを入れない。
- DB/Hasher障害は「削除できませんでした。時間をおいて再度お試しください」。不一致・未登録と混同しない。
- 「戻る」は保存済みIDの自分のプロフィールへ移動するLink。入力した内容を保存せず、削除もしない。
- フォームを開いた後で別アカウントにログインし直した場合は「このアカウントは削除できません」。以前の対象も現在の利用者も削除せず、現在の利用者をログアウトさせない。

### 削除対象と原子性

| データ | 削除後 |
| --- | --- |
| 本人のusers行 | 削除 |
| 本人が作成したtweets | 削除 |
| 本人がした／本人へのfollows | 削除 |
| 本人が実行したretweets | 削除 |
| 他人が本人の投稿に行ったretweets | 元投稿の削除に伴い削除 |
| 他人のusers行・投稿・本人と無関係の関係やリツイート | 維持 |

- 本人のusers行を単一のDELETEで削除し、既存FKのCASCADEへ任せる。関連テーブルを順番に別々のDELETEで消さない。
- IDや名前で削除せず、内部UUIDで対象を指定する。IDの変更や再利用で別人を削除しない。
- 削除は即時の物理削除。復元・旧IDの予約は行わない。旧IDを別の利用者が取得しても、新しいUUIDとなる。
- DB削除とブラウザのCookie変更は1つのトランザクションにはできない。DB削除後のsignOut失敗で、削除済みデータを戻したり削除を再実行させたりしない。

### 成功・ログアウト・通知

- 削除成功後、Auth.jsの `signOut({ redirect: false })` で現在の認証Cookieを無効化し、`/login` へ移動する。独自の認証Cookie名をハードコードしない。
- ログイン画面で「アカウントを削除しました」を3秒表示する。削除成功時の遷移・通知は今回の補完仕様。
- 削除用の表示Cookieは登録・プロフィール更新用と分け、個人情報を入れない。一度消費したら消し、再読込・Strict Modeで重複表示しない。
- メインと全プロフィール・編集・削除ページの訪問済み表示を無効化してからredirectする。導入バージョンのrevalidatePathの動作に合わせる。
- 削除後、公開プロフィールは404、自分の投稿やリツイートは一覧から消え、フォロー数・フォロワー数にも反映される。
- 他のブラウザにJWTが残っていても、利用者の実在確認で未ログインとして扱う。旧UUIDを新規登録された同じ表示IDの利用者へ対応付けない。
- DB削除は完了したがsignOutが失敗した場合は、削除成功とセッション後処理の失敗を区別する。削除を再送させず `/login` へ移動し、専用表示Cookieの別値で「アカウントは削除済みですが、ログアウト処理を完了できませんでした」を表示する。通常の削除成功Toastと同時表示しない。この例外メッセージは消えると見落とすため固定表示とする。
- その例外時も利用者行はないので、既存resolveViewerとログイン画面の実在確認は旧JWTに権限を与えない。signOut成功・失敗をユニットでそれぞれ検証する。
- 同一セッションから同時削除され、既に対象がない場合は削除成功と断定せず、signOutしてログイン画面へ戻す。「アカウントを確認できません。再度ログインしてください」を固定表示する。

## 3. 方式と認可契約

| 方式 | 利点・負担 | 判断 |
| --- | --- | --- |
| 本人＋現在パスワード確認 → UUID指定DELETE＋CASCADE | 画面案に合い、既存の関連削除で一括処理できる | 推奨 |
| 論理削除・復元猶予 | 復元を提供できるが、全読取・認証・一意制約の設計変更が必要 | 今回の範囲外 |
| 関連行をアプリから順に削除 | 個別失敗時に部分削除になる | 採用しない |

既存UserRepositoryへ次のメソッドを追加する。

```ts
// 対象行が実際に削除された場合だけdeleted。その他のDBエラーはthrow。
deleteById(id: string): Promise<'deleted' | 'not-found'>;

type DeleteAccountResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: { password: string[] } }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_PASSWORD' | 'UNAVAILABLE';
    };
```

`deleteAccount` の依存は `Pick<UserRepository, 'findById' | 'deleteById'>` と `Pick<PasswordHasher, 'verify'>`。入力は `{ actorId: string | null; targetId: string; password: string }`。

1. actorIdなし・targetIdと不一致はDB・Hasherを呼ばず拒否する。
2. 既存domainのvalidatePasswordで入力検証し、不正なら拒否する。単なるラッパーvalidatorや新しいdomain型を増やす必要はない。
3. 対象UUIDの現在のアカウントを取得する。なければNOT_FOUND。
4. パスワードが一致したときだけdeleteByIdを呼ぶ。結果が0行ならNOT_FOUND。
5. DB/Hasher例外はUNAVAILABLE。成功結果にアカウント情報や秘密を含めない。

RepositoryのSQLは `DELETE FROM twitter.users WHERE id = $1 RETURNING id`。値はパラメータ化する。CASCADEは既存001/002のまま使う。

## 4. Action・状態・画面の接続

- GETの入場判定は編集画面と同じresolveViewerを利用する。
- Actionでは `auth()` を毎回呼び、署名検証済みセッションのUUIDだけをactorIdへ渡す。アカウントの現在の存在とパスワードはユースケース内で照会する。
- ActionでresolveViewerだけを使うと「同時削除でもう利用者がいない」ときに旧セッションを後処理できないため、ここではセッション取得と対象照会を分ける。
- FormDataは既存readStringFieldsでpassword1件だけを取り出し、File・重複・欠落を拒否する。余分なUUID・actorId・hashは採用しない。
- FORBIDDENやINVALID_PASSWORDではsignOut・通知・revalidate・redirectをしない。入力エラーや障害も同様。
- 認証なしは `/login` へredirect。NOT_FOUNDでsignOutする前にもactorIdとtargetIdの一致が確認済みであることを保証する。
- 削除成功後はキャッシュ無効化 → signOut(redirect:false) → 削除通知Cookie → redirect('/login')。signOut例外は専用の後処理結果へ変換し、削除ユースケースへ戻さない。
- ログアウトの成功判定は導入済みAuth.jsの戻り値・型と照合する。throwしなかっただけで無条件に成功と扱うテストにはしない。
- redirect/notFoundはtry/catchの外で呼ぶ。入力由来の任意URLへredirectしない。
- 失敗stateは `status / code / message / fieldErrors / attempt` のみ。パスワード、hash、actorId、targetIdを戻さない。フォームは失敗時に再マウントしパスワードを消す。
- 専用loadingは `/profile/[displayId]/delete` 配下へ置く。既存プロフィール・編集・ログインのloading表示を広げない。
- PC/375pxで説明・現在のアカウント・入力・戻る・削除が操作できる。削除ボタンは危険な操作と分かる見た目にする。

## 5. ファイル構成

```text
Create:
  application/users/delete-account.ts
  app/profile/[displayId]/delete/page.tsx
  app/profile/[displayId]/delete/loading.tsx
  app/profile/[displayId]/delete/actions.ts
  app/profile/[displayId]/delete/form-state.ts
  app/ui/profile/account-delete-form.tsx
  app/ui/notifications/account-deleted-flash.tsx
  test/unit/application/delete-account.test.ts
  test/unit/app/account-delete-page.test.tsx
  test/unit/app/account-delete-actions.test.ts
  test/unit/ui/account-delete-form.test.tsx
  test/unit/ui/account-deleted-flash.test.tsx
  test/integration/postgres-account-delete.test.ts
  test/e2e/account-delete-screen.spec.ts

Modify:
  application/users/ports/user-repository.ts
  infra/repositories/postgres-user-repository.ts
  test/support/in-memory-user-repository.ts
  app/ui/profile/profile-header.tsx
  app/login/page.tsx
  app/ui/notifications/flash.ts
  test/unit/ui/profile.test.tsx
  test/unit/app/login-page.test.tsx
  README.md
  docs/front_design.md
```

PageShell、FormField、Toast、consumeFlashCookie、getAccountDependenciesは既存を使う。既存signOutを公開するauth.tsを再利用し、通常ログアウト用の画面やActionは別途作らない。

## 6. TDDタスク

代表E2EはTask 3〜4の実装前に書いて失敗を確認する。各タスクでも1挙動ずつ、テスト → 意図したRedの観測 → 最小実装 → Green → 必要な整理、の順で進める。

### Task 1: 削除ユースケース・認可・パスワード照合

**Files:** `application/users/delete-account.ts`、`application/users/ports/user-repository.ts`、in-memory Repository、`test/unit/application/delete-account.test.ts`。

- [x] ポート追加でfakeの型を更新したうえで、本人＋正しいパスワードで削除される挙動からTDDする。
- [x] 未認証・別UUIDではread/verify/deleteを呼ばない。パスワード長違反ではread/verify/deleteを呼ばない。
- [x] 未登録はverify/deleteなし、不一致はdeleteなし、read/verify/deleteの例外はUNAVAILABLEとなるテストを書く。
- [x] パスワードをtrim・正規化せず照合すること、成功結果に秘密情報がないことを確認する。
- [x] 照合後に別リクエストが先に削除し、deleteがnot-foundになった場合をテストする。

代表ケース：

```ts
it('別アカウントからは照合も削除も行わない', async () => {
  const findById = vi.fn();
  const deleteById = vi.fn();
  const verify = vi.fn();
  const result = await deleteAccount(
    { users: { findById, deleteById }, passwords: { verify } },
    { actorId: 'actor-a', targetId: 'target-b', password: 'password123' },
  );
  expect(result).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(findById).not.toHaveBeenCalled();
  expect(verify).not.toHaveBeenCalled();
  expect(deleteById).not.toHaveBeenCalled();
});
```

Run: `pnpm exec vitest run --project unit test/unit/application/delete-account.test.ts`。

### Task 2: 実DBの削除・CASCADE・他人データの維持

**Files:** `infra/repositories/postgres-user-repository.ts`、`test/integration/postgres-account-delete.test.ts`。

- [x] 対象1件の削除、0行、接続障害のthrowから実装する。
- [x] A/B/Cを作り、A所有の投稿、B所有の投稿、A/B間の双方向follow、A→B投稿のretweet、B→A投稿のretweet、B/C間の無関係なデータを用意する。
- [x] A削除後、第2節の表どおりに関連データだけが消えることを実DBで検証する。B/Cのアカウント・投稿・無関係なfollow/retweetを維持する。
- [x] 対象が2回削除されても、最初だけdeletedで後はnot-found。他人の削除に波及しないことを確認する。
- [x] 削除済みIDでは旧アカウントが認証できず、公開プロフィールはnull、一覧や件数にも削除が反映されることを確認する。
- [x] 同じ表示IDを別UUIDで登録し直せることと、旧UUIDから新アカウントへ自動的に対応付けないことを確認する。
- [x] パスワード不一致で実ユースケースを呼んだ場合、本人と関連行が一切変わらないことを確認する。
- [x] 専用テストDBのfixtureだけを削除し、既存データ全体のtruncate/dropはしない。

Run: `pnpm exec vitest run --project integration test/integration/postgres-account-delete.test.ts`。

### Task 3: ページ・Action・削除後の処理

**Files:** `app/profile/[displayId]/delete/*`、`test/unit/app/account-delete-{page,actions}.test.ts*`。

- [x] GETで本人・大小文字違い・未認証・他人・古いID・DB障害を分けるテストを書く。ページ表示だけでdeleteを呼ばない。
- [x] Actionは毎回authを呼び、別アカウントへ切り替わったフォーム、改変したpreviousStateやhidden値でも削除できないことを確認する。
- [x] File・重複キー・欠落を拒否し、余分なactorId・targetId・hashを無視することをテストする。
- [x] 誤パスワード、入力違反、DB/Hasher障害では画面に留まり、signOutもrevalidateも呼ばないことを確認する。
- [x] 削除成功→キャッシュ無効化→signOut→専用通知→loginへのredirectを検証する。
- [x] signOutがthrowする／失敗結果を返すケースでは、DB削除を再実行せず、削除済み・後処理失敗の表示へ進むことを確認する。
- [x] 同じactorId/targetIdで対象が既にない場合、他人のデータを操作せず認証Cookieを処理し、成功とは異なる通知でloginへ戻す。
- [x] キャッシュ無効化にはメインと全プロフィールのpageパターン、edit/deleteのpageパターンを指定する。redirectをcatchしない。

Run: `pnpm exec vitest run --project unit test/unit/app/account-delete-actions.test.ts`、`pnpm exec vitest run --project ui test/unit/app/account-delete-page.test.tsx`。

### Task 4: フォーム・導線・ログイン画面の通知

**Files:** `app/ui/profile/{account-delete-form,profile-header}.tsx`、`app/ui/notifications/{flash.ts,account-deleted-flash.tsx}`、`app/login/page.tsx`、対応するUIテスト。

- [x] 本人のプロフィールだけに削除リンクを表示するテストを書く。編集リンク・フォロー状態の既存表示を維持する。
- [x] 現在の利用者と削除の影響、パスワード、戻る、削除ボタンを表示する。
- [x] 誤パスワードと入力違反の欄エラー、障害の全体メッセージ、失敗後のパスワード消去を検証する。
- [x] Promise保留中の「削除中…」・disabled・aria-busyと、追加クリックでActionが再送されないことを検証する。
- [x] 戻るでは削除せずプロフィールへ戻る。PC/375pxで操作できるレイアウトにする。
- [x] ログイン画面で成功Toastを2999ms/3000msで確認し、再読込・Strict Modeでも重複しないことを検証する。
- [x] ログアウト後処理失敗と対象なしは、それぞれ固定の説明を表示し、通常成功Toastと混同しない。別の通知Cookieを消費しない。

Run: `pnpm exec vitest run --project ui test/unit/ui/account-delete-form.test.tsx test/unit/ui/account-deleted-flash.test.tsx test/unit/ui/profile.test.tsx test/unit/app/login-page.test.tsx`。

### Task 5: アカウント削除E2Eと既存フローの回帰

**Files:** `test/e2e/account-delete-screen.spec.ts`。

- [x] UI実装前に、本人のリンク→パスワード入力→削除→login→3秒通知の代表E2EをRedにする。
- [x] キャンセル、空欄、誤パスワードではDBもログイン状態も変わらず、失敗後パスワードだけが空になることを確認する。
- [x] 正しいパスワードで削除後は再ログインできず、プロフィール・編集・削除画面に本人として入れない。
- [x] 削除前にホーム・プロフィール・フォロー一覧を訪問し、削除後に再訪・戻る／進むをしても古い本人の表示や投稿を利用できないことを確認する。
- [x] A削除後にBのアカウント、B所有投稿、無関係な関係・リツイートが維持されることを確認する。
- [x] 別contextにAのセッションを残して削除し、そのcontextからプロフィール編集等へ入っても実在確認で拒否されることを確認する。
- [x] 未認証・他人URLと、別アカウントへ切り替えた古いフォームからの保存拒否を、ページE2EとAction境界テストで確認する。
- [x] PC/375px、キーボード、成功通知の消滅と再読込後非表示を確認する。障害注入APIを本番コードへ追加しない。
- [x] fixtureは内部UUIDで追跡し、既に削除済みでも後片付けできるようにする。既存の登録・ログイン・メイン・プロフィール・編集E2E27件も通す。

Run: `pnpm exec playwright test test/e2e/account-delete-screen.spec.ts`、その後 `pnpm test:e2e`。

### Task 6: 全体検証と補完仕様の記録

**Files:** `README.md`、`docs/front_design.md`。

- [x] 即時削除・現在の削除対象・他人データの維持・パスワード確認・削除後の通知と例外処理を記録する。
- [x] `pnpm test:unit`：本人認可、秘密情報の非返却、既存認証・各画面の回帰を含め成功。
- [x] `pnpm test:integration`：実照合・CASCADEと既存Queryが専用DBで成功。
- [x] `pnpm typecheck`：UserRepositoryのfake追加を含めエラーなし。
- [x] `pnpm build`：実行時に認証し、ビルド時のDB接続なしで成功。
- [x] `pnpm test:e2e`：専用DB・専用サーバーで全件成功。
- [x] アプリの成功結果、ログ、state、Cookie、URLにパスワードやhashを含めない。認可失敗でsignOutや削除をしない。
- [x] 新規migrationなし。開発は既存 `.env.development.local`、自動テストは専用DB。実利用者を動作確認目的で削除せず、専用fixtureを使う。
- [x] 実装開始時にGit状態を確認する。現時点は `feat/profile-edit-screen` なので、その作業を勝手にmergeせず、必要ならその上に削除用ブランチを積む。Taskごとに変更ファイルを明示してコミットし、push/mergeは別の指示に従う。

## 7. 実装時に読むローカルガイド

AGENTS.mdに従い、実装時点の `node_modules/next/dist/docs/` と導入済みAuth.jsの型・実装を確認する。計画時はServer Actionの直接POST・削除時の認証・revalidatePath・Auth.js signOutの処理を確認した。

- `01-app/02-guides/server-actions.md`
- `01-app/03-api-reference/04-functions/revalidatePath.md`
- `01-app/03-api-reference/04-functions/redirect.md`
- `01-app/03-api-reference/04-functions/cookies.md`
- `01-app/03-api-reference/03-file-conventions/page.md`
- `node_modules/next-auth/index.d.ts` と `node_modules/next-auth/lib/actions.js`

## 8. 完了条件

本人が現在パスワードを再入力して自分だけを削除でき、誤入力・不一致・別セッション・障害では削除しない。関連行だけが原子的に消え、他人のデータは残る。削除後はログイン画面へ戻り、旧セッションに本人の権限が残らず、成功と後処理失敗を区別でき、既存5画面が動作し続ける。
