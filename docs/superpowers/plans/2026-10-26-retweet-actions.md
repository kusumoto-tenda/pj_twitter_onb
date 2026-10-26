# リツイート操作 Implementation Plan

> **For agentic workers:** `executing-plans` スキルを使い、各TaskをRed → Green → Refactorで実行する。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 元投稿をリツイート・解除し、状態・件数と既存タイムライン／プロフィールへ反映する。

**Architecture:** applicationが明示的な登録／解除、infraが既存retweetsの一意制約と取得、appがセッション・ボタン・通知・再取得を担当する。

**Tech Stack:** 既存Next.js、Auth.js、postgres、Vitest、Playwright。migration・ライブラリ追加なし。

**Status:** Task 1〜6を `worktree-remaining-core` に実装済み（Task 1は `45d2787`、Task 2〜6は `b371350` 以降のいいねの後）。単体・UI・型チェックはPASS。結合・E2E（Redの確認を含む）・本番ビルドは未確認で、コーディネーターの外部リソースでの確認待ち。完了条件はその確認後に更新する。[全体計画](2026-10-26-remaining-core-features.md)の第4段階。

## 仕様と契約

- メイン・プロフィール・お気に入りの元投稿カードすべてに「リツイートする／リツイートを解除」を追加し、aria-pressedと件数を表示する。自分の投稿のリツイートも許可する（資料に制限がないための補完仕様）。引用投稿は含めない。
- リツイートカードで押しても対象は元投稿UUID。表示中のretweet行IDや、その実行者を操作対象にしない。解除できるのは自分のretweet行だけ。
- 匿名は「ログイン中のみリツイートできます」の3秒通知だけで移動・書込みなし。障害時は状態と件数を維持し、失敗通知を出す。
- `active=true` の重複要求では既存IDとcreated_atを維持する。解除は自分と元投稿の組だけをDELETE。解除後の再実行は新しいUUID・日時となり、タイムラインの先頭側へ出る。
- 元投稿のcreated_at/updated_at/revision、本文・画像・お気に入り・いいねは変更しない。追加・解除で元投稿の再編集扱いにしない。
- 既存の「元投稿＋リツイートを別の出来事として表示」「フォローのみはリツイート実行者で判定」を維持する。自分のリツイートは自分を含む絞り込みに出る。
- 更新後は現在のURL・カーソルを維持し、同じ元投稿の全カードの状態・件数を更新する。解除で表示中の自分のretweetカードが消えても、元投稿や他人のretweetカードを消さない。

```ts
// application/retweets/ports/retweet-repository.ts
export interface RetweetRepository {
  set(input:{actorId:string;tweetId:string;active:boolean;id:string;now:Date}):
    Promise<{status:'set';active:boolean;count:number}|{status:'actor-not-found'|'tweet-not-found'}>;
}
// setRetweet input: {actorId:string|null;expectedActorId:string|null;tweetId:string;active:boolean}
// result: {ok:true;active:boolean;count:number} または {ok:false;code:
// 'UNAUTHENTICATED'|'SESSION_CHANGED'|'INVALID_REQUEST'|'NOT_FOUND'|'UNAVAILABLE'}。
// TimelineItem.tweetへ retweetedByViewer:boolean / retweetCount:number を追加する。
```

DBは `sql.begin` 内で対象投稿をFOR UPDATEし、actorの実在も確認する。（実装では、いいね・お気に入りと同じく利用者を `FOR KEY SHARE` で先にロックしてから元投稿を `FOR NO KEY UPDATE` でロックする。投稿を先にロックすると、退会のCASCADEと実行者の外部キーで循環待ちになるため。`FOR NO KEY UPDATE` 同士は競合するので、同じ元投稿への操作・投稿の削除とは直列化される）同じ元投稿への登録／解除を直列化し、`INSERT ... ON CONFLICT (executor_id,tweet_id) DO NOTHING` または `DELETE WHERE executor_id=actor AND tweet_id=target`、最後に状態と件数を読む。他のSQL障害を成功とみなさない。

### Task 1: ユースケースとポート

**Create:** `application/retweets/set-retweet.ts`、`retweet.ts`、`ports/retweet-repository.ts`、`test/unit/application/retweets.test.ts`。

- [x] 未認証、actor切替、UUID不正、active true/false、対象なし、DB例外、同一状態への再送をテスト化する。新規IDと時刻はサーバー生成。
- [x] `pnpm exec vitest run --project unit test/unit/application/retweets.test.ts` → FAIL、最小実装、PASS・型チェック。（Codexのレビュー済み）
- [x] コミット：`feat: リツイート登録解除のユースケースを追加`。（`45d2787`）

```ts
await setRetweet(deps,{actorId,expectedActorId:actorId,tweetId,active:false});
expect(store.retweetsBy(otherActor,tweetId)).toHaveLength(1); // 他人の行を残す
```

### Task 2: DB操作・状態・件数

**Create:** `infra/repositories/postgres-retweet-repository.ts`、`test/integration/postgres-retweets.test.ts`。
**Modify:** TimelineItem、`timeline-rows.ts`、timeline/profile（公開いいね一覧を含む）/favorite Query、`app/_composition/tweet.ts`、fixture。

- [x] 二重登録・同時登録・二重解除・他人の解除不可・自己投稿・再実行時刻・元投稿削除／退会との競合を結合テスト化する。（退会・投稿削除との競合は、`pg_blocking_pids` で待機関係を確かめてから進める制御された順序のテストを含む）
- [ ] `pnpm exec vitest run --project integration test/integration/postgres-retweets.test.ts` → FAIL後に既存retweetsテーブルを利用する実装を追加する。（実装済み。Redは型チェックで `postgres-retweet-repository` 未作成・`retweetedByViewer`/`retweetCount` 未定義のFAILを確認。結合テストの実行は実装worktreeにテスト専用DBがなく未実施で、コーディネーターの確認待ち）
- [ ] Queryはページ選択後にcountとviewerのEXISTSを集約し、画像・お気に入り状態・いいね状態／件数を含めて1ページ1SQLを維持する。匿名のviewer状態はfalse。件数が他のJOINで掛け算されないことを確認する。（共通の `withImages` に相関サブクエリとして追加し、timeline/profile（公開いいね一覧を含む）/favoriteのQueryすべてに反映。確認は結合テストに記述済みでコーディネーター待ち）
- [ ] 元投稿・画像・favoritesが不変で、同じ登録の再送でタイムライン順位が上がらないことを確認する。PASS・型チェック後コミット：`feat: リツイートの永続化と状態取得を追加`。（単体・UI・型チェックPASS、コミット済み。結合はコーディネーター待ち。`app/_composition/tweet.ts` は変更せず、Task 4でいいねと同じ形の `app/_composition/retweets.ts` を追加した）

### Task 3: 先行E2E

**Create:** `test/e2e/retweets.spec.ts`。

- [x] メインから実行→自分のretweetタブ→解除、同じ元投稿の全カード同期、他人のretweetを残す、自分の投稿も実行可、匿名通知のみ、actor切替、フォローのみの実行者判定、ページ戻る進む、375pxをテスト化する。
- [ ] `pnpm exec playwright test test/e2e/retweets.spec.ts` → 未実装FAILを確認。コミット：`test: リツイート操作のE2Eを先に追加`。（ボタン実装より前にコミット済み。実行は未実施：実装worktreeにはテスト専用DBがなく、コーディネーターの確認待ち。Redは同コミットをcheckoutして確認する）

### Task 4: Actionとキャッシュ

**Create:** `app/retweets/actions.ts`、`test/unit/app/retweet-actions.test.ts`。

- [x] activeの厳密parse、改ざんした実行者、viewer障害、匿名、actor切替、対象なし、DB障害、成功を先にテスト化する。
- [x] `pnpm exec vitest run --project unit test/unit/app/retweet-actions.test.ts` → FAIL後にActionを実装する。resolveViewerのUUIDだけをactorとし、posted executorIdは使わない。（Action未作成でFAIL→実装後21件PASS）
- [x] 成功後にhome/profile/favoritesをrevalidateし、canonicalなactive/countを返す。失敗でrevalidateせず、匿名はredirectしない。PASS・型チェック後コミット：`feat: リツイートのActionを追加`。（対象なしの場合だけは、消えた投稿を表示し続けないよう失敗でも再取得させる。いいねと同じ）

### Task 5: ボタンと一覧への連携

**Create:** `app/ui/retweets/retweet-button.tsx`、`test/unit/ui/retweet-button.test.tsx`。**Modify:** TweetCardと必要なviewer情報。

- [x] aria-pressed、件数、期待するactive、pending、匿名3秒通知、エラー時維持、元投稿UUID送信のUIテストを書く。（通常の失敗結果・Action自体のreject・Next.jsの制御例外を区別して確認）
- [x] `pnpm exec vitest run --project ui test/unit/ui/retweet-button.test.tsx` → FAIL後に実装。お気に入りで追加したActionFeedbackProviderを使い、rootへの別の通知基盤を追加しない。（部品未作成でFAIL→実装後14件PASS）
- [ ] 通常カードとretweetカードで同じ元投稿に同じ状態を表示する。操作の連打を防ぎ、再取得後のDB状態を表示する。Task3 E2EをPASSにする。（実装・UIテストはPASS。E2Eはコーディネーターの確認待ち）
- [x] コミット：`feat: リツイート操作と件数をカードに表示`。

### Task 6: 全体確認と資料

- [ ] `pnpm test:unit`、`pnpm typecheck`、`pnpm test:integration`、`pnpm test:e2e`、`pnpm build` を通し、新規E2Eを2回連続で通す。（実装worktreeでの実測 2026-10-27: `pnpm test:unit` 71ファイル・932件PASS、`pnpm typecheck` PASS。結合・E2E・ビルドはコーディネーターの確認待ち）
- [ ] 投稿編集・削除・アカウント削除とリツイート操作が相互に破綻せず、SQL回数がカード数に比例しないことを確認する。（結合テストに記述済み。件数・本人状態はページ選択後の相関サブクエリで1ページ1回のSQL。実行確認はコーディネーター待ち）
- [x] README・front_designに自己投稿可、解除の範囲、重複時刻維持、匿名通知を記載。コミット：`docs: リツイート操作の仕様と確認結果を記載`。レビュー後に第5段階のフォローへ。
