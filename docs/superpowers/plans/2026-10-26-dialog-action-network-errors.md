# 投稿ダイアログの通信失敗対応 Implementation Plan

> **For agentic workers:** `executing-plans` スキルを使い、各TaskをRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作成・編集・削除ダイアログとその開始処理でAction呼び出しがrejectしても画面をエラー境界へ置き換えず、入力を保って再試行でき、Next.jsの正常な遷移も維持する。

**Architecture:** Action呼び出しの例外分類をapp内の小さな共通アダプターにまとめる。各ダイアログは通常の失敗結果と通信等の例外を別のフォーム状態として表示し、Next.jsの制御例外は再throwする。domain/application/DBの契約・ロック順・再送判定は変更しない。

**Tech Stack:** 導入済みNext.js 16.4.2、React、TypeScript、Vitest、Playwright。新規依存・migration・ストレージ設定なし。

**Status:** Task1〜6の実装・レビュー・最終検証は完了（2026-10-27）。単体/UI1011件、結合164件、全E2E105件、型チェック・本番ビルド成功。実行の詳細は末尾を参照。

## 1. 現状と判断

- `FavoriteButton` はActionの失敗結果とPromiseのrejectを分けて処理済み。
- `create-tweet-dialog.tsx`、`edit-tweet-dialog.tsx`、`delete-tweet-dialog.tsx` のuseActionState内は `await action(...)` の例外を受け止めていない。通信切断や応答読取失敗がReactのエラー境界へ進む。
- `tweet-composer.tsx` のprepareも開始Actionをtry/finallyで呼ぶだけでcatchがない。ダイアログを開く際の通信失敗も同じ境界として扱う。
- **Next.jsのredirectもrejectで伝わる。** 正常な投稿成功後の `/` 遷移と未認証時の `/login` 遷移を通信エラーへ変換してはいけない。
- 通信失敗だけでは「DBが変更されなかった」と断言できない。サーバーで確定して応答だけ失った場合も含め、**処理結果を確認できない状態**として扱う。

方式は「共通アダプターで制御例外を再throw、それ以外のrejectは明示した失敗結果へ変換」を採用する。各画面に独自のredirect判定をコピーせず、すべてのActionをクライアント遷移専用APIへ変更するような大改修もしない。

## 2. 表示・再試行の契約

| 場面 | 処理 |
| --- | --- |
| Actionが通常のエラー状態を返す | 既存の欄エラー・全体案内・失敗Toastを維持 |
| Action自体が一般の例外でreject | ダイアログと入力を維持、通信の3秒Toast、下記の固定案内、pending解除 |
| Next.jsの制御例外 | 同じ例外をNext.jsへ渡す。通信Toastや偽の成功通知を出さない |
| 開く前の一般例外 | ダイアログを開かず既存のrootエラー案内。openingを解除し、再び開ける |

通信Toast文言：`通信に失敗しました。もう一度お試しください`。

ダイアログ内の固定案内：`通信に失敗し、処理結果を確認できませんでした。入力を変更せず、もう一度お試しください`。

- 同じ通信失敗が続いてもattemptを増やし、Toastを毎回3秒表示する。生のError.message、SQL、資格情報を表示・ログ出力しない。
- 作成はcontent・draftId・新規uploadIds、編集はcontent・draftId・keepImageIds・uploadIds、削除はtweetId・expectedActorIdを維持する。通信失敗でfinish/onClosed、下書きの破棄、画像解除を呼ばない。
- 再試行は利用者が同じボタンを押したときだけ。勝手に送信し直さず、新しい下書きや画像予約を作り直さない。
- 作成の確定済み再送は既存のfingerprintによる成功、編集の確定済み再送は既存のreplay成功を利用する。削除の確定済み再送は既存のnot-foundとなり、「既に削除されています」として閉じて一覧更新する。
- 応答不明後に入力を変えた場合も、既存のCONFLICT等のサーバー判定に従う。別の投稿として自動保存しない。
- 送信中の入力変更で再試行内容がずれないよう、作成のtextareaにも編集と同じ `readOnly={pending}` を設定する。readOnlyならFormDataには本文が含まれる。画像・閉じる・Esc・submitの既存pending制御を維持する。
- エラーから復帰した後は閉じる・Esc・画像操作・再試行が可能。失敗後も次の操作を妨げない。フォーカス復帰・StrictMode対応は維持する。
- 開始Actionがサーバーで下書きを作った後に応答を失い、そのUUIDを取得できなかった場合、推測で削除せず既存TTLの回収に任せる。

## 3. 共通アダプターとフォーム状態

**Create:** `app/ui/tweets/invoke-dialog-action.ts`。これはフレームワーク境界の処理でありdomain/applicationへ置かない。

```ts
import { unstable_rethrow } from 'next/navigation';

export type DialogActionOutcome<T> =
  | { ok: true; value: T }
  | { ok: false };

export async function invokeDialogAction<T>(run: () => Promise<T>): Promise<DialogActionOutcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    // 導入版の公開API。redirect/notFound等はNext.jsへ戻し、通常の例外だけを結果へ変換する。
    unstable_rethrow(error);
    return { ok: false };
  }
}
```

- 導入版のローカルガイド `unstable_rethrow.md` とブラウザ実装を確認済み。unstable APIへの依存はこのファイル一か所に閉じ込める。Next更新時にはこの契約をテストする。
- `error.message === 'NEXT_REDIRECT'` の独自判定やdigestの自作パーサー、`next/dist/...` のアプリ本体への直接importは採用しない。
- catchする範囲はAction呼び出しだけ。finishやDOM処理のプログラム上の例外まで一括して通信失敗と扱わない。
- 実際のredirectは値がundefinedで返るのではなく、導入版のserver-action-reducerがredirect例外でPromiseをrejectする。既存のundefinedを返すテスト用Actionとの互換は維持してよいが、正常遷移の証拠は実際の制御例外の再throwとE2Eで確認する。

**Modify:** `app/tweets/form-state.ts`、`edit-form-state.ts`、`delete-form-state.ts` のapp用エラーコードに `'NETWORK_ERROR'` を追加。applicationの結果型へ通信のコードを追加しない。

作成の分岐例（編集・削除では各画面の既存型に合わせる）：

```ts
const outcome = await invokeDialogAction(() => action(previous, formData));
if (!outcome.ok) {
  return {
    status: 'error' as const,
    code: 'NETWORK_ERROR' as const,
    message: DIALOG_NETWORK_UNCONFIRMED_MESSAGE,
    fieldErrors: {},
    attempt: previous.status === 'error' ? previous.attempt + 1 : 1,
  };
}
const result = outcome.value;
// この後は既存の成功・通常エラーの処理を行う。
```

各Toastは `failed?.code === 'NETWORK_ERROR'` の場合だけ通信文言を使い、それ以外は既存の作成／編集／削除失敗文言を使う。定数は既存 `app/ui/notifications/flash.ts` に追加し、通信のために表示Cookieを増やさない。

## 4. TDDタスク

### Task 1: 例外の分類契約と先行E2E

**Create:** `app/ui/tweets/invoke-dialog-action.ts`、`test/unit/app/invoke-dialog-action.test.ts`、`test/e2e/dialog-network-errors.spec.ts`。

- [x] 共通アダプターのテストを先に書く。通常成功、通常エラー値、互換用undefinedはそのまま返し、TypeError/Errorのrejectはok:false。制御例外は再throwする。
- [x] `pnpm exec vitest run --project unit test/unit/app/invoke-dialog-action.test.ts` → FAILを確認してから上記の最小アダプターを実装する。
- [x] 制御例外テストは実際の公開API `redirect('/login')`、`redirect('/')`、`notFound()` が投げた値を捕捉して使う。単なる `new Error('NEXT_REDIRECT')` や、unstable_rethrowをno-opへmockしたテストでは代用しない。

```ts
let control: unknown;
try { redirect('/login'); } catch (error) { control = error; }
await expect(invokeDialogAction(() => Promise.reject(control))).rejects.toBe(control);
expect(await invokeDialogAction(() => Promise.reject(new TypeError('Failed to fetch'))))
  .toEqual({ ok: false });
```

- [x] UI修正より前にE2Eを追加する。作成・編集・削除それぞれの「送信前に通信切断→画面保持→再試行」を書き、画面がエラー境界へ進むため失敗することを確認する。
- [x] `pnpm exec playwright test test/e2e/dialog-network-errors.spec.ts` → 未対応FAILを記録する。失敗目的は通信処理の未実装であり、DBやBlob資格情報不足でのFAILをRed扱いしない。
- [x] helperテストと型チェックをPASS。コミット：`test: 投稿操作の通信失敗と遷移の契約を追加`。この時点のE2E未実装FAILだけは計画上のものとして記録する。

### Task 2: 作成の通信失敗・入力保持・再送

**Modify:** `app/ui/tweets/create-tweet-dialog.tsx`、`app/tweets/form-state.ts`、`app/ui/notifications/flash.ts`、`test/unit/ui/create-tweet-dialog.test.tsx`。

- [x] `mockRejectedValueOnce` のテストを先に書く。本文と準備済み画像を入力し、reject後も同じdialog・content・draftId・uploadIdsを保持し、通信Toast、固定案内、submit/閉じる再有効化、破棄呼出しなしを検証する。
- [x] `pnpm exec vitest run --project ui test/unit/ui/create-tweet-dialog.test.tsx` → FAILを確認。
- [x] helperを使いNETWORK_ERROR状態を返す。通信失敗でfinish(true/false)を呼ばず、textareaにreadOnly={pending}を追加する。Toastを通信／既存エラーで切り替える。
- [x] 同じフォームを再送するテストと連続rejectのattempt／Toast再表示、通常の欄エラー→rejectで古い欄エラーを残さないこと、StrictModeでも二重送信しないことを確認する。
- [x] 実際の投稿成功redirectが通信エラーにならないことはTask6のE2Eで確認する。単体・型チェックをPASS。コミット：`fix: 投稿作成の通信失敗時に入力を保って再試行できるようにする`。

### Task 3: 編集の通信失敗・画像保持・再送

**Modify:** `app/ui/tweets/edit-tweet-dialog.tsx`、`app/tweets/edit-form-state.ts`、`test/unit/ui/edit-tweet-dialog.test.tsx`。

- [x] 本文変更＋既存画像解除＋新規画像追加の状態でrejectするテストを書く。保持画像IDs・新規uploadIds・draftIdを維持し、閉じず、成功通知も下書き破棄も呼ばず、更新を再試行できることを検証する。
- [x] `pnpm exec vitest run --project ui test/unit/ui/edit-tweet-dialog.test.tsx` → FAIL後にNETWORK_ERRORの分岐を実装する。
- [x] 再送に同じIDと本文が入ること、再送の通常エラー・成功を区別すること、連続rejectの通知、競合エラーの既存動作を確認する。通信失敗だけで編集成功通知を出さない。
- [x] 単体・型チェックをPASS。コミット：`fix: 投稿編集の通信失敗時に本文と画像を維持する`。

### Task 4: 削除の通信失敗・再確認

**Modify:** `app/ui/tweets/delete-tweet-dialog.tsx`、`app/tweets/delete-form-state.ts`、`app/tweets/delete-actions.ts`、`test/unit/ui/delete-tweet-dialog.test.tsx`。

- [x] reject後も確認文・対象tweetId・expectedActorIdが残り、「はい」「いいえ」が再有効化され、成功／既に削除済みの通知を出さないテストを書く。
- [x] `pnpm exec vitest run --project ui test/unit/ui/delete-tweet-dialog.test.tsx` → FAIL後にhelperとNETWORK_ERRORを実装する。削除はfieldErrorsのない既存型を維持する。
- [x] delete-actionsの文言表は現在 `Record<DeleteTweetFailureCode,string>` のため、コード追加に合わせてサーバー側の型を `type ServerDeleteFailureCode = Exclude<DeleteTweetFailureCode,'NETWORK_ERROR'>` に絞り、文言表とfailure引数へ使う。NETWORK_ERRORはクライアント生成であり、サーバーから返す契約・認可を変更しない。
- [x] 再試行がsuccessならdeleted、not-foundならgone、通常エラーなら開いたままという既存契約を確認する。rejectの時点で「DBは削除されていない」と表示しない。
- [x] 単体・型チェックをPASS。コミット：`fix: 投稿削除の通信失敗でも確認を保って再試行できるようにする`。

### Task 5: 開始Actionの失敗と制御例外の取りこぼし確認

**Modify:** `app/ui/tweets/tweet-composer.tsx`、作成・編集・削除の既存UIテスト。

- [x] beginDraft/beginEdit/beginDeleteのそれぞれをrejectさせ、エラー案内、ダイアログ非表示、opening/busy解除、再度の起動成功を先にテスト化する。
- [x] `pnpm exec vitest run --project ui test/unit/ui/create-tweet-dialog.test.tsx test/unit/ui/edit-tweet-dialog.test.tsx test/unit/ui/delete-tweet-dialog.test.tsx` → 開始rejectのFAILを確認する。
- [x] prepare内でもhelperを使い、一般例外では既存rootのerror表示へ `通信に失敗しました。もう一度お試しください` をセットする。成功後処理の例外までcatchしない。finallyのopening解除とフォーカス監視停止を保つ。
- [x] 開始時のエラー表示は既存のroot案内を再利用する（ダイアログ送信時の3秒Toastとは別）。再起動時に古いerrorを消す。UUIDを知らない未応答下書きを推測で破棄しない。
- [x] Next.jsの制御例外がhelperからそのまま抜け、未ログインの開始・送信で/loginへ移動することを検証する。既存のフォーカス復帰5件も通す。
- [x] 型チェック。コミット：`fix: 投稿ダイアログを開く通信失敗からも復帰できるようにする`。

### Task 6: 応答だけ失われた場合のE2E・全体確認・記録

**Modify:** `test/e2e/dialog-network-errors.spec.ts`、README、front_design、当計画と全体計画。

Playwrightの通信制御は、開く処理を終えてから対象submitのNext-Action POSTだけを一度捕捉する。画像アップロード、RSCのGET、再試行のPOSTは止めない。

```ts
// 「サーバーへ送る前に失敗」の例。対象ダイアログを開いた後に登録する。
let failedOnce = false;
await page.route('**/*', async route => {
  const request = route.request();
  if (!failedOnce && request.method() === 'POST' && request.headers()['next-action']) {
    failedOnce = true;
    return route.abort('failed');
  }
  return route.continue();
});
```

別ケースでは `await route.fetch()` で**実際にサーバーへ1回送信し、成功応答を取得してから** `route.abort('failed')` でブラウザ側へ応答を渡さない。取得したresponseが成功であることと、専用DBの対象行を確認し、「サーバーで確定済み」の条件を固定する。再試行ではroute.continueする。重複リクエストを自前でもう一度送る実装にしない。

| ケース | 必須の確認 |
| --- | --- |
| 作成・送信前失敗 | DB未作成、本文と準備済み画像を維持、同じdraftで再試行成功 |
| 作成・確定後に応答喪失 | DB上の同一draft UUIDの投稿は1件、再送で画像重複なし、正常に/へ移動して投稿成功通知 |
| 編集・送信前失敗 | 元投稿不変、編集内容と保持／新規画像を維持、同じdraftで更新可能 |
| 編集・確定後に応答喪失 | 再送でrevisionは追加加算されず、画像行・削除予約も重複しない。URLとページ位置を維持 |
| 削除・送信前失敗 | 元投稿と画像維持、確認を開いたまま再試行可能 |
| 削除・確定後に応答喪失 | 再送は既に削除済みの案内、二重削除や偽の成功通知なし、一覧更新 |
| 未認証の開始・保存 | 作成・編集・削除それぞれ/login、専用ログイン案内、通信失敗／更新成功／削除成功の誤通知なし、dialogがloginを覆わない |
| 通常エラー | 欄エラー、競合、期限切れ、別actorへの切替は既存の説明で、通信エラーと混同しない |

- [x] `pnpm exec playwright test test/e2e/dialog-network-errors.spec.ts` をPASS、連続2回通す。小さい有効なPNGで画像を確認し、不要な5MiBの反復アップロードを追加しない。
- [x] `pnpm test:unit`、`pnpm typecheck`、`pnpm test:integration`、`pnpm test:e2e`、`pnpm build` を実行し結果を記録する。専用DB/Blobの分離チェックを維持する。
- [x] ブラウザ側のネットワークエラー発生と、アプリ画面がエラー境界に置き換わることを区別する。既知のabort由来consoleエラーだけを必要な範囲で扱い、全pageerrorを無条件に無視しない。
- [x] READMEとfront_designへ入力保持・結果不明・同じ下書きでの再試行を記載する。ロック順やschemaの変更が不要であることを確認する。
- [x] コミット：`test: 投稿操作の応答喪失と再送の回帰確認を追加`。レビュー後にいいねへ進む。merge/push/デプロイは別指示による。

## 5. 完了条件

- [x] 作成・編集・削除と開始Actionの一般rejectがエラー境界へ漏れない。
- [x] 入力・対象・画像のIDを保持し、pending解除後に利用者が再試行・キャンセルできる。
- [x] 通信失敗からDB未変更を断言せず、応答喪失後の再送でも重複・追加更新を起こさない。
- [x] Next.jsの制御例外が再throwされ、投稿成功遷移と未認証ログイン遷移を維持する。
- [x] 通常の欄エラー・競合・認可・画像解除中ロック・StrictMode・フォーカス復帰を壊していない。
- [x] 単体・UI・結合・全E2E・型チェック・本番ビルドの実測結果を記録した。

## 6. 導入版で読む資料

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`
- `node_modules/next/dist/client/components/unstable-rethrow.browser.js`
- `node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js`

ローカルの仕様を優先する。内部実装は挙動の確認にのみ使い、アプリ本体は公開APIからimportする。

## コーディネーターの最終確認（2026-10-27）

- 全体の単体/UI1011件、結合164件、E2E105件が成功。型チェック成功、本番ビルドで起動したサーバーでE2Eを実行した。
- この機能のE2E10件は、現行実装で連続する2回の実行に成功した。
- 実装担当はテスト資格情報を持たず、外部DB・Blobの検証はコーディネーターが分離チェック付きで実行した。結合の初回は2ファイルでTCP接続が失敗したため失敗として記録し、全体再実行で164件すべての成功を確認した。
- E2EはUIより先に記述した。一部のRed実行は実装後に、隔離した実装前コミット `8825f4f` のアプリで再現した。実装前に全E2Eを実行したという意味ではない。通知・ハート・リツイート・フォローが未実装のため失敗し、資格情報不足の失敗ではないことを確認した。
- 作成・編集・削除の送信前切断3件は、旧実装でそれぞれ失敗することを再確認した。共有node_modulesによる最初のビルド失敗は、依存をworktree内へ配置し直して解消し、Next.js設定は変更していない。
- 本番への適用・デプロイ環境での画像確認は、この実装検証とは別のリリース作業として残す。
