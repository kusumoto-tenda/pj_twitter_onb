# ツイート削除ダイアログ Implementation Plan

> **For agentic workers:** `executing-plans` スキルを使い、各TaskをRed → Green → Refactorで実行する。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自分の投稿の「削除する」から確認し、本文・画像・関連リツイートを削除して現在の一覧へ反映する。

**Architecture:** applicationが本人専用の準備・削除契約、infraがUUID＋ownerによるDELETEと既存CASCADE／削除予約トリガー、appがセッション・確認ダイアログ・通知・再取得を担当する。

**Tech Stack:** 現行Next.js、Auth.js、postgres、Vitest、Playwright。migration・外部サービス追加なし。003/004適用済みのDBを前提とする。

**Status:** 実装済み（レビュー待ち）。[全体計画](2026-10-26-remaining-core-features.md)の第1段階。前提は編集機能 `0d8906b` までの実装。計画書の作成のみで実データを削除しない。

## 仕様

- 本人の元投稿カードの三点メニューに「削除する」を追加する。編集と同じ判定で、他人の投稿をリツイートしただけの人には出さない。
- 開くときにサーバーで所有者を確認する。確認文「本当に削除しますか？」、「投稿・添付画像・この投稿へのリツイートは元に戻せません」、「はい」「いいえ」を表示する。削除は「はい」の送信時だけ。
- 「いいえ」・閉じる・Escは何も変更しない。背景クリックで閉じない。初期フォーカスは「いいえ」。処理中は全操作をロックする。
- 保存のたびに現在のactorと準備時のactorを確認する。Aで開いてBに切り替えた場合、A/Bどちらの投稿も削除しない。未認証なら/loginへ移動し、ログインが必要な旨を表示する。
- 成功は現在のURL・条件を維持し「ツイートを削除しました」を3秒表示。同じ元投稿のカードとリツイートをすべて消す。自分の最後の投稿を消した場合も空一覧へ更新する。
- 既に存在しない対象は削除成功と区別し「このツイートは既に削除されています」と通知し、閉じて再取得する。他人・障害は理由を表示して削除しない。障害時は再試行できる。
- 元投稿DELETE→images/retweetsのCASCADEとmedia_delete_jobs作成を同じDBトランザクションで行う。Blob APIは削除Actionから呼ばない。画像URLは即404、実体はトークン期限以降の既存回収で削除する。
- 編集用下書きのtargetがNULLになっても削除を妨げない。編集中の新規画像は下書き破棄・期限切れで回収し、無関係な投稿・利用者・画像を残す。
- 第2段階でfavorites、第3段階でlikesを追加するとき、この削除のCASCADE回帰テストをそれぞれ拡張する。

## ポートとファイル

```ts
// application/tweets/ports/tweet-deleter.ts
export type DeleteTarget = { tweetId: string; ownerId: string; content: string };
export interface TweetDeleter {
  findTarget(tweetId: string): Promise<DeleteTarget | null>;
  deleteOwned(input: { actorId: string; tweetId: string }):
    Promise<'deleted' | 'not-found' | 'forbidden'>;
}
// application/tweets/delete-tweet.ts
// 入力は { actorId: string|null, expectedActorId: string, tweetId: string }。
// 結果は {ok:true} または {ok:false,code:
// 'UNAUTHENTICATED'|'SESSION_CHANGED'|'INVALID_REQUEST'|'NOT_FOUND'|'FORBIDDEN'|'UNAVAILABLE'}。
```

`deleteOwned` は `sql.begin` 内で対象を `FOR UPDATE`、存在とowner確認後に `DELETE ... WHERE id=... AND owner_id=...` を実行する。既にない場合の結果もロック後の状態で決める。DBエラーはthrowし、applicationでUNAVAILABLEへ変換する。

### Task 1: 削除ユースケースと準備

**Create:** `application/tweets/begin-tweet-delete.ts`、`delete-tweet.ts`、`tweet-delete.ts`、`ports/tweet-deleter.ts`、`domain/shared/uuid.ts`、`test/unit/application/delete-tweet.test.ts`。

- [x] 未認証、不正UUID、actor切替、他人、存在なし、削除成功、DB例外の失敗テストを書く。UUID検証は新規shared関数 `normalizeUuid(value): string|null` を作り、この計画群で再利用する。
- [x] `pnpm exec vitest run --project unit test/unit/application/delete-tweet.test.ts` → FAILを確認する。
- [x] 準備と削除を別ユースケースにする。actor切替・入力違反で削除ポートを呼ばない最小実装を追加する。
- [x] 同じテストをPASSにし `pnpm typecheck`。コミット：`feat: 本人のツイート削除ユースケースを追加`。

```ts
expect(await deleteTweet(deps, { actorId: bob, expectedActorId: alice, tweetId }))
  .toEqual({ ok: false, code: 'SESSION_CHANGED' });
expect(deps.deleter.deleteOwned).not.toHaveBeenCalled();
```

### Task 2: DB削除と画像回収の整合性

**Create:** `infra/repositories/postgres-tweet-deleter.ts`、`test/integration/postgres-tweet-deleter.test.ts`。**Modify:** `app/_composition/tweet.ts`、専用fixture。

- [x] 他人・存在なし・同時削除、本人の画像付き投稿、他人によるリツイート、開いている編集下書きを含む結合テストを書く。
- [x] `pnpm exec vitest run --project integration test/integration/postgres-tweet-deleter.test.ts` → FAIL。
- [x] 上記トランザクションを実装。images/retweetsを手作業で別々に削除しない。
- [x] 投稿・画像・リツイートの消失、削除予約とtoken_valid_untilの関係、無関係データ維持、DB失敗時のロールバックを確認する。専用テストBlobで画像配信が404になり、後続回収で実体が消えることも既存lifecycleテストへ加える。
- [x] PASS・型チェック後、コミット：`feat: 投稿と関連データを一括削除する`。

### Task 3: 先行E2E

**Create:** `test/e2e/delete-tweet-dialog.spec.ts`。

- [x] 本人メニュー、キャンセル、成功通知、画像とリツイート消失、他人に導線なし、actor切替、同時削除、375px・キーボードを実装前にテスト化する。
- [x] `pnpm exec playwright test test/e2e/delete-tweet-dialog.spec.ts` → 削除メニュー未実装のFAILを確認。
- [x] fixtureは専用DB/Blobのみで、自分が作った行とBlobだけを後片付けする。コミット：`test: ツイート削除ダイアログのE2Eを先に追加`。

### Task 4: Actionと状態

**Create:** `app/tweets/delete-actions.ts`、`delete-form-state.ts`、`test/unit/app/delete-tweet-actions.test.ts`。**Modify:** `app/ui/notifications/flash.ts`、`tweet-flash.tsx`。

- [x] 開始・確定それぞれのviewer障害、未認証、actor切替、改ざん、他人、存在なし、成功、DB障害をテスト化する。
- [x] `pnpm exec vitest run --project unit test/unit/app/delete-tweet-actions.test.ts` → FAIL。
- [x] Actionで毎回resolveViewer、UUIDとexpectedActor照合を行う。成功時だけ `/` と全profileページをrevalidateし、redirectせず結果を返す。第2段階以降は/favoritesも対象にする。
- [x] GETとダイアログを開く操作でDELETEが呼ばれないことを確認する。PASS・型チェック後、コミット：`feat: ツイート削除の認証と結果を扱うActionを追加`。

### Task 5: 確認ダイアログとメニュー

**Create:** `app/ui/tweets/delete-tweet-dialog.tsx`、`test/unit/ui/delete-tweet-dialog.test.tsx`。**Modify:** `tweet-actions-menu.tsx`、`tweet-composer.tsx`、メニューUIテスト。

- [x] 「いいえ」・Esc、初期フォーカス、focus循環、pending中ロック、失敗保持、成功／存在なしで閉じる、StrictModeのテストを先に書く。
- [x] `pnpm exec vitest run --project ui test/unit/ui/delete-tweet-dialog.test.tsx test/unit/ui/tweet-actions-menu.test.tsx` → FAIL。
- [x] composerにdeleteモードを追加し、create/edit/deleteを排他的にする。メニューは項目が2つになるため上下矢印・Home/End・Esc・Tabで破綻しないようにする。
- [x] 削除後は起動元が消えるので一覧見出し等へ `focus({preventScroll:true})`。成功通知はrootで一回だけ出す。未認証redirectを削除成功として通知しない。
- [x] UIとTask3のE2EをPASSにする。コミット：`feat: ツイートの削除確認と一覧更新を追加`。

### Task 6: 全体確認と資料

- [x] `pnpm test:unit`、`pnpm typecheck`、`pnpm test:integration`、`pnpm test:e2e`、`pnpm build` をすべて通す。新規削除E2Eは連続2回通す。
- [x] 期限前にはBlobが削除されず、期限後の `pnpm media:cleanup --test` で回収され、再実行が成功することを確認する。保持・無関係の画像を残す。
- [x] READMEと`docs/front_design.md`に本人限定・確認・失敗・回収の仕様と結果を記載する。コミット：`docs: ツイート削除の仕様と確認結果を記載`。
- [ ] レビューを済ませてから次の計画へ進む。merge/pushは別指示による。
