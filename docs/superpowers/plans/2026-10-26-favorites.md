# お気に入り Implementation Plan

> **For agentic workers:** `executing-plans` スキルを使い、各TaskをRed → Green → Refactorで実行する。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 投稿をお気に入りに保存・解除し、自分専用の一覧で20件ずつ閲覧できる。

**Architecture:** applicationが明示的な登録／解除と一覧取得、infraが一意制約・CASCADE・キーセット取得、appが認証・カード操作・本人専用ページ・再取得を担当する。

**Tech Stack:** 既存構成。migration005のみ追加。新規サービス・パッケージなし。

**Status:** 実装済み（レビュー待ち）。[全体計画](2026-10-26-remaining-core-features.md)の第2段階。第1段階のツイート削除を完成・レビューしてから着手する。

## 仕様と契約

- ER図のLikeとFavoriteは別機能。利用者確認により、Likeは相手からも見える「♡」、Favoriteは自分専用の保存。今回はFavoriteのみ。カードの右端へデザイン案の旗のようなbookmarkアイコンを置き、「お気に入りに追加／お気に入りを解除」のアクセシブル名と `aria-pressed` で状態を表す。ハートをお気に入りに使わない。公開件数や他人の保存一覧は追加しない。
- 対象は元投稿UUID。リツイートカードで押しても同じ元投稿を保存する。自分の投稿も保存できる。
- 未ログインは「ログイン中のみお気に入りに設定できます」を3秒表示し、その場に留まる。失敗時は登録状態を維持して理由を通知する。pending中は連打できない。
- 保存済みへの追加はcreated_at/UUIDを維持し、解除済みへの解除は成功。解除後の再追加は新しい保存時刻で先頭に出す。
- `/favorites` はログイン中の本人の一覧。左ナビに本人向け導線を追加する。未認証の直接アクセスは/login。DB障害は再試行、空一覧、カーソル不正を区別する。
- 保存した日時の降順 `(favorited_at, favorite_id)` で20+1件。カーソルはactor UUID・種別favorites・UTC6桁時刻・favorite UUIDに結び付ける。actorはセッションから取り、URL指定のuserIdで変更しない。
- お気に入り一覧は元投稿の現在の本文・画像・作者を表示し、元投稿の編集が反映される。削除・作者の退会で一覧から消える。自分の退会で自分の保存行も消える。
- 成功後は元のURL・条件を維持し、同じ投稿の全カードを再取得する。自分のお気に入り一覧で解除した行も消える。空になったページには先頭リンクを出す。

```sql
-- infra/db/migrations/005-create-favorites.sql
CREATE TABLE twitter.favorites (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES twitter.users(id) ON DELETE CASCADE,
  tweet_id UUID NOT NULL REFERENCES twitter.tweets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT favorites_user_tweet_unique UNIQUE(user_id, tweet_id)
);
CREATE INDEX favorites_user_created_idx ON twitter.favorites(user_id, created_at DESC, id DESC);
CREATE INDEX favorites_tweet_idx ON twitter.favorites(tweet_id);
```

```ts
// application/favorites/ports/favorite-repository.ts
export interface FavoriteRepository {
  set(input: { actorId: string; tweetId: string; active: boolean; id: string; now: Date }):
    Promise<{status:'set'; active:boolean} | {status:'actor-not-found'|'tweet-not-found'}>;
}
// application/favorites/ports/favorite-query.ts
export type FavoriteCursor = { createdAt: string; favoriteId: string };
export interface FavoriteQuery {
  findPage(input: { actorId:string; after:FavoriteCursor|null; limit:number }): Promise<{
    items: { favoriteId:string; favoritedAt:string; item:TimelineItem }[];
    nextCursor:FavoriteCursor|null;
  }>;
}
// TimelineItemは既存型をimport。tweetへ favoritedByViewer:boolean を追加する。
// setFavorite入力: {actorId:string|null, expectedActorId:string|null, tweetId:string, active:boolean}
// 結果: {ok:true,active:boolean} または {ok:false,code:
// 'UNAUTHENTICATED'|'SESSION_CHANGED'|'INVALID_REQUEST'|'NOT_FOUND'|'UNAVAILABLE'}。
```

setはトランザクションでactor・対象を確認し、登録は `INSERT ... ON CONFLICT (user_id,tweet_id) DO NOTHING`、解除はactor＋tweet指定DELETE。競合中の対象削除は該当FKエラーだけNOT_FOUNDへ変換し、無関係なDBエラーを成功扱いしない。関連の実在を保護するロックを使い、同一入力を2回送っても1行にする。

### Task 1: 操作と一覧のユースケース

**Create:** `application/favorites/set-favorite.ts`、`get-favorites.ts`、`favorite.ts`、`ports/favorite-repository.ts`、`ports/favorite-query.ts`、`test/unit/application/favorites.test.ts`。

- [x] 未認証、actor切替、不正UUID、true/false、対象なし、DB障害、一覧の本人限定・limit20をテスト化する。第1段階の `domain/shared/uuid.ts` を使う。
- [x] `pnpm exec vitest run --project unit test/unit/application/favorites.test.ts` → FAIL後に最小実装。
- [x] 未認証・不正入力では書込ポートを呼ばないこと、明示されたactiveをそのまま渡すことを確認しPASS・型チェック。
- [x] コミット：`feat: お気に入り登録解除と一覧のユースケースを追加`。

```ts
await setFavorite(deps, { actorId, expectedActorId:actorId, tweetId, active:true });
await setFavorite(deps, { actorId, expectedActorId:actorId, tweetId, active:true });
expect(store.forUser(actorId)).toHaveLength(1);
```

### Task 2: DB・カーソル・読取モデル

**Create:** migration005、`infra/repositories/postgres-favorite-repository.ts`、`infra/queries/postgres-favorite-query.ts`、`app/lib/favorite-query.ts`、`test/integration/postgres-favorites.test.ts`、`test/unit/app/favorite-query.test.ts`。

**Modify:** `application/timeline/timeline.ts`、timeline/profileのQueryポートとユースケース、`infra/queries/timeline-rows.ts`・timeline/profile Query、対応fixture。

- [x] 登録重複・同時登録・重複解除・再追加時刻、対象削除とCASCADE、21件・同時刻・マイクロ秒境界・他actorのカーソル拒否を先にテスト化する。
- [x] `pnpm exec vitest run --project integration test/integration/postgres-favorites.test.ts` と `pnpm exec vitest run --project unit test/unit/app/favorite-query.test.ts` → FAIL。
- [x] `pnpm db:migrate --test` で005を専用DBへ適用し、上記SQL・ポートを実装する。
- [x] TimelineItemへfavoritedByViewerを追加。閲覧者UUIDを明示的にQueryへ渡し、ページ選択後のEXISTSで判定する。匿名はfalse。プロフィールのsubjectとviewerを取り違えない。お気に入り一覧のitemは元投稿カードでretweeterなし。
- [x] 1ページ1SQLで画像も含めて取得する。既存の `withImages` を必要な範囲で拡張し、JOINによる20件の増殖を防ぐ。
- [x] ツイート削除・アカウント削除の結合テストにお気に入りCASCADEを追加し、対象者以外の保存を維持することを確認する。PASS後コミット：`feat: お気に入りの保存と本人専用ページ取得を追加`。

### Task 3: 先行E2E

**Create:** `test/e2e/favorites.spec.ts`。

- [x] 登録→一覧→解除、再追加の並び、同じ元投稿の複数カード同期、匿名通知のみ、他actorの保存非表示、アカウント切替、元投稿編集／削除、20件ページ送りと戻る進む、375pxをテスト化する。
- [x] `pnpm exec playwright test test/e2e/favorites.spec.ts` → 未実装のFAILを確認し、コミット：`test: お気に入りのE2Eを先に追加`。

### Task 4: Action・専用ページ・通知

**Create:** `app/favorites/actions.ts`、`page.tsx`、`loading.tsx`、`app/_composition/favorites.ts`、`app/ui/notifications/action-feedback-provider.tsx`、`test/unit/app/favorite-actions.test.ts`、`favorites-page.test.tsx`。

- [x] activeの不正文字列/File/欠落、セッション切替、匿名通知、対象なし、DB障害、本人ページ・カーソルのテストを先に書く。
- [x] `pnpm exec vitest run --project unit test/unit/app/favorite-actions.test.ts` と `pnpm exec vitest run --project ui test/unit/app/favorites-page.test.tsx` → FAIL。
- [x] ActionでresolveViewerを毎回実行し、true/falseのみparse。非認証の操作はredirectせずUNAUTHENTICATED。成功後にhome/profile/favoritesをrevalidateする。
- [x] ページは本人のUUIDだけでQueryを呼ぶ動的ページにする。Cookie更新の再描画で通知が消えないようroot layoutへ小さいActionFeedbackProviderを追加する。APIは `notify(message,tone)` のみでDB・権限・投稿編集状態を持たせない。
- [x] 編集・削除・アカウント削除の成功Actionにも/favoritesの無効化を追加する。PASS・型チェック後コミット：`feat: お気に入りのActionと本人専用ページを追加`。

### Task 5: ボタン・ナビ・一覧

**Create:** `app/ui/favorites/favorite-button.tsx`、`favorite-list.tsx`、`test/unit/ui/favorites.test.tsx`。**Modify:** TweetCard、MainNavigation、PageShell、home/profile/favoritesからのviewer情報。

- [x] aria-pressed、pending、失敗維持、匿名3秒通知のみ、activeの明示、同じ元投稿への操作、空／失敗／不正カーソルをUIテストにする。
- [x] `pnpm exec vitest run --project ui test/unit/ui/favorites.test.tsx` → FAIL後にUIを実装する。bookmarkに対応する既存Heroiconsを使い、未実装のLikeボタンは出さない。
- [x] 一覧も既存TweetCardを使い、画像・編集・削除・今後のリツイート操作を保つ。activePageへfavoritesを追加する。成功時だけ再取得し、同じ元投稿を表示する全カードへDB状態を反映する。
- [x] Task3のE2EをPASS。コミット：`feat: お気に入り操作と保存一覧の画面を追加`。

### Task 6: 回帰・運用資料

- [x] `pnpm test:unit`、`pnpm typecheck`、`pnpm test:integration`、`pnpm test:e2e`、`pnpm build` をすべて通し、新規E2Eを2回連続で通す。
- [x] 元投稿の画像を保存操作で複製・削除していないことと、account削除がfavorite行で妨げられないことを確認する。
- [x] README・front_design・ER図にFavoriteのみ実装、本人限定、005適用順、実測した確認結果を記載する。古い「画像未実装」等の説明も現在の状態に合わせる。
- [x] コミット：`docs: お気に入りの仕様と確認結果を記載`。レビュー後に第3段階のいいねへ。
