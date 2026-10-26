# フォロー操作 Implementation Plan

> **For agentic workers:** `executing-plans` スキルを使い、各TaskをRed → Green → Refactorで実行する。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 他人のプロフィールからフォロー・解除でき、人数、関係一覧、フォローのみのタイムラインへ反映する。

**Architecture:** domain/applicationが自己フォロー禁止・登録解除の契約、infraが既存followsの一意制約と原子的な変更、appがセッション確認・ボタン・通知・再取得を担当する。

**Tech Stack:** 既存構成。migration・外部サービス・ライブラリ追加なし。

**Status:** 実装前。[全体計画](2026-10-26-remaining-core-features.md)の第5段階。リツイートを完成・レビューしてから着手する。

## 仕様と契約

- 他人のプロフィールヘッダーへ「フォローする／フォロー解除」ボタンを置く。既存の操作できない「フォロー中」表示を操作に置き換え、aria-pressedで状態を伝える。
- 自分のプロフィールにはボタンを出さない。サーバーでもactorとtarget UUID一致を拒否する。表示ID変更・大小文字・再利用で別人に操作が移らないよう対象は現在のUUIDで固定する。
- 未ログインでも他人のページにボタンを表示し、押すと「ログイン中のみフォローできます」を3秒表示する。遷移・書込みはしない。
- 登録済みへの登録、解除済みへの解除は成功。同じ登録でrelation UUID・created_atを変えない。解除後の再登録は新しい日時で関係一覧に出る。
- 相互フォローは許可し、逆方向の行には触れない。解除は `follower_id=actor AND follow_id=target` だけを削除する。
- 成功後は対象のフォロワー数、本人のフォロー数、両側の関係一覧、他ページの自分から見た状態を更新する。フォローのみのタイムラインは既存どおり自分＋フォロー中の実行者で取得する。
- 自分は常に絞り込み対象に含む。フォロー解除しても自分の投稿・自分のリツイートを除かない。フォローした人が他人の投稿をリツイートした出来事も対象にする。
- 関係一覧の各行への追加ボタンは今回は作らない。そこから対象プロフィールへ移動して操作できる。鍵アカウント・承認・ブロックは範囲外。

```ts
// application/follows/ports/follow-repository.ts
export interface FollowRepository {
  set(input:{actorId:string;targetId:string;active:boolean;id:string;now:Date}):
    Promise<{status:'set';active:boolean}|{status:'actor-not-found'|'target-not-found'}>;
}
// setFollow input: {actorId:string|null;expectedActorId:string|null;targetId:string;active:boolean}
// result: {ok:true;active:boolean} または {ok:false;code:
// 'UNAUTHENTICATED'|'SESSION_CHANGED'|'INVALID_REQUEST'|'SELF_FOLLOW'|'NOT_FOUND'|'UNAVAILABLE'}。
```

`sql.begin` でactorとtargetのusers行をUUID順でロックし、相互フォローの逆順ロックを避ける。登録は既存 `(follower_id,follow_id)` 一意制約でON CONFLICT DO NOTHING、解除は上記の2列指定。自己フォローはapplicationと既存CHECKの両方で拒否する。利用者削除と重なったときに全FK違反を成功扱いせず、対象の消失だけ分類する。

### Task 1: 制約とユースケース

**Create:** `application/follows/set-follow.ts`、`follow.ts`、`ports/follow-repository.ts`、`test/unit/application/follows.test.ts`。

- [ ] 未認証、actor切替、UUID不正、自己フォロー、登録解除、対象なし、DB障害、逆方向は変更しないテストを書く。
- [ ] `pnpm exec vitest run --project unit test/unit/application/follows.test.ts` → FAIL後に最小実装。自己フォローと認証失敗でrepository.setを呼ばない。
- [ ] PASS・型チェック。コミット：`feat: フォロー登録解除と自己フォロー禁止を追加`。

```ts
expect(await setFollow(deps,{actorId,expectedActorId:actorId,targetId:actorId,active:true}))
  .toEqual({ok:false,code:'SELF_FOLLOW'});
expect(deps.follows.set).not.toHaveBeenCalled();
```

### Task 2: DB操作と既存読取への反映

**Create:** `infra/repositories/postgres-follow-repository.ts`、`test/integration/postgres-follows.test.ts`、`app/_composition/follow.ts`。

- [ ] 同時登録・重複解除・相互フォロー・再登録日時・本人／対象退会との競合を先にテスト化する。
- [ ] `pnpm exec vitest run --project integration test/integration/postgres-follows.test.ts` → FAIL後に既存followsを使って実装する。
- [ ] ProfileQueryのfollowingCount/followerCount/followedByViewer、両側の一覧、TimelineQueryのfollowingOnlyが書込み後に整合することを実DBで確認する。取得の仕様を別方式へ書き換えない。
- [ ] 自分の出来事と、フォローした実行者のリツイートが含まれ、解除した他人の出来事が除かれることを確認する。PASS・型チェック後コミット：`feat: フォロー関係を原子的に登録解除する`。

### Task 3: 先行E2E

**Create:** `test/e2e/follows.spec.ts`。

- [ ] フォロー→件数／両側一覧→フォローのみ→解除、自分には導線なし、匿名通知のみ、actor切替、他人の逆方向行維持、表示ID変更後も同じUUIDを操作、375pxをテスト化する。
- [ ] `pnpm exec playwright test test/e2e/follows.spec.ts` → 未実装FAILを確認。コミット：`test: フォロー操作のE2Eを先に追加`。

### Task 4: Actionと無効化

**Create:** `app/follows/actions.ts`、`test/unit/app/follow-actions.test.ts`。

- [ ] true/false以外拒否、actorの改ざん、未認証、自己、actor切替、消えた対象、DB障害、成功をテスト化する。
- [ ] `pnpm exec vitest run --project unit test/unit/app/follow-actions.test.ts` → FAIL後に毎回resolveViewerを呼ぶActionを実装する。
- [ ] 成功後はhomeと全profileページ、favoritesをrevalidateする。フォロー中の対象だけでなく、ログイン中の本人と別のプロフィールの閲覧状態も更新する。匿名はredirectしない。
- [ ] PASS・型チェック。コミット：`feat: フォローのActionとキャッシュ更新を追加`。

### Task 5: プロフィールの操作ボタン

**Create:** `app/ui/profile/follow-button.tsx`、`test/unit/ui/follow-button.test.tsx`。**Modify:** ProfileHeaderとprofileページ。

- [ ] 未フォロー／フォロー中、自己非表示、pendingロック、失敗維持、通知、正しいtargetIdとactive、匿名の操作をUIテストにする。
- [ ] `pnpm exec vitest run --project ui test/unit/ui/follow-button.test.tsx` → FAIL後に実装する。viewer UUIDを対象profile.idと取り違えない。
- [ ] ActionFeedbackProviderを使い、成功後はQuery由来の件数・状態を表示する。URL・タブ・スクロールを保つ。Task3 E2EをPASS。
- [ ] コミット：`feat: プロフィールからフォローと解除を操作可能にする`。

### Task 6: 回帰と資料

- [ ] `pnpm test:unit`、`pnpm typecheck`、`pnpm test:integration`、`pnpm test:e2e`、`pnpm build` を通す。新規E2Eを2回連続で通す。
- [ ] アカウント削除による両方向CASCADE、名前・ID変更後の関係維持、全タイムラインと各プロフィールの戻る・進むを確認する。
- [ ] README・front_designに自己禁止、匿名通知、重複登録、一覧での導線を記載。コミット：`docs: フォロー操作の仕様と確認結果を記載`。レビュー後に第6段階のログアウトへ。
