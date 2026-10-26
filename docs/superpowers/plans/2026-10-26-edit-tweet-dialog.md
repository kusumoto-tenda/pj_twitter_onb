# ツイート編集ダイアログ Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、各挙動を Red → Green → Refactor で進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自分のツイートの三点メニューからダイアログを開き、本文・添付画像を編集して、元の一覧の位置を保ったまま更新できる。

**Architecture:** domain は本文・画像の入力制約、application は編集準備と確定の契約を担当する。infra は編集用下書き、本人確認、版の比較、本文・画像の更新と削除予約を一つのトランザクションで扱う。app は毎回のセッション確認、メニュー、ルート layout に保持するダイアログ、通知とキャッシュ無効化を担当する。

**Tech Stack:** 既存 Next.js / React / TypeScript / Auth.js / postgres / Vercel Blob / sharp / Vitest / Testing Library / Playwright。外部サービス・パッケージの追加なし。migration `004` を追加する。

**Status:** 実装前の計画。今回の作業はこの文書の作成のみ。ブランチ作成・アプリ実装・DBへの適用・Blob操作・デプロイは行わない。作成ダイアログは `main` の `657da1c` に取り込み済み。

---

## 1. 資料と対象

- `docs/functions.md`：「自分のツイートを編集できる」「三点メニュー」「作成とほぼ同じ」。
- `docs/front/ツイート編集画面.png`：見出し「ツイートを編集」、閉じる、既存本文、画像添付、「更新」。
- `docs/front_design.md` と作成ダイアログ：本文280コードポイント、JPEG/PNG・各5MiB・最大4枚、本文か画像が必要。
- 既存 `003-create-tweet-media.sql`：下書き、画像予約、公開画像、削除予約、遅延制約。

今回含めるもの：本文変更、既存画像の保持・解除、新しい画像の追加、自分の投稿への導線、本人確認、競合検出、キャンセル、通知、各一覧・リツイートカードへの反映、不要画像回収、TDD。

今回含めないもの：ツイート削除、報告、編集履歴、編集可能時間の制限、画像の並べ替え・加工・拡大、動画、新しいリツイート操作。未実装の「削除する」「報告する」を押せる項目として置かない。それぞれの実装時にメニューへ追加する。

## 2. 挙動と補完仕様

### 開く・閉じる

- メイン、フォローのみ、プロフィールのツイート／リツイート一覧で、**元投稿者の内部UUIDが現在の利用者と一致するカードだけ**三点メニューを表示する。
- リツイートした本人でも、元投稿が他人のものなら編集できない。自分の元投稿が他人にリツイートされたカードからは編集できる。
- 三点ボタンの名前は「ツイートの操作」、展開すると「編集する」。別カードのメニューを同時に開かない。Esc・外側クリックでメニューを閉じ、キーボードでも選択できる。
- カードから受け取るのは元投稿のUUIDだけ。開く際にサーバーで本人を確認し、DBから現在の本文・画像を取得する。カードの古い内容を編集初期値として信用しない。
- 未ログインなら `/login` へ移動し「ツイートを編集するにはログインしてください」を3秒表示。他人の投稿・消えた投稿は開かず、操作できないことを通知する。DB障害は別の再試行案内。
- native `<dialog>` を使う。「閉じる」・Escは保存せず閉じる。背景クリックでは閉じない。本文に初期フォーカス、Tabの循環、閉じた際の起動元へのフォーカス復帰を保つ。
- 作成・編集は同時に一つだけ開く。root layout の既存 composer を拡張し、Cookie更新に伴う再描画で入力が消えない構成にする。準備中は二重起動を防ぐ。
- 本文のEnterは改行。送信中は「更新中…」とし、本文・添付操作・閉じる・Esc・重複submitを無効にする。

### 本文・画像

- 本文は既存 `normalizeTweetContent` でCRLF/CRをLFに正規化し、前後の空白は保存する。280コードポイント以下。空白だけの本文＋画像0枚は拒否。
- 既存画像は `/media/{imageId}` のプレビューで表示し、元の順序を保持する。解除はフォーム内の変更だけで、保存前にimages行・Blob・削除予約を変更しない。
- 新規画像は既存の直接アップロード・実体検証を使う。**保持する既存画像＋新規画像で最大4枚**。既存画像の後ろへ、新規画像を選択順で追加する。
- 既存画像の解除後は、新規画像を追加できる。解除した既存画像を戻すには、保存せず閉じて開き直す。画像の並べ替えUIは作らない。
- 新規画像の再試行・解除は、予約の破棄成功を待ち、失敗時は予約IDを保持する。処理中・失敗中の新規画像があれば送信できない。既存画像の解除と新規予約の破棄を別の処理として扱う。
- 閉じる・準備失敗・期限切れでは編集用下書きの**新規画像だけ**を破棄／回収し、元投稿の画像は保持する。既存の下書きTTL24時間・トークンTTL15分を使う。

### 保存・競合・通知

- 元投稿のID・所有者・作成日時・リツイートとの関係は変えない。内容が実際に変わった場合だけ `updated_at` と編集用の `revision` を更新する。
- 日時をキーにした一覧の位置・カーソルは変えない。本文だけ、画像だけ、画像を全削除して本文だけ、を許可する。何も変えない保存も成功とし、編集日時と版は進めない。
- 別タブで同じ投稿を編集した場合は、先に確定した内容を残す。後からの保存は「他の画面で更新されています。閉じて開き直してください」と表示し、入力を保持してDBを変更しない。勝手な上書き・自動マージはしない。
- 同じ編集用下書き・同じ正規化済み入力の再送は成功済みとして扱い、再更新・重複添付・重複削除予約をしない。同じ下書きへ別内容を送った場合は競合。
- 保存時にもログイン状態と実在する利用者を確認する。Aで開いてBにログインし直した場合、A/Bどちらの投稿も変更しない。hidden値・previousStateのactorIdや版は認可に使わない。
- 成功後はダイアログを閉じ、**現在のURL・タブ・フォロー条件・カーソル・スクロール位置を維持**し、「ツイートを更新しました」を3秒表示する。成功通知は画面案にない補完仕様。
- 元投稿を参照するメイン・プロフィール・リツイートカードを更新する。ブラウザで戻る・進むをしても更新前の本文・画像が復活しない。
- 入力違反は欄エラー。他の通常失敗は説明を出す。いずれも「ツイートの更新に失敗しました」を3秒表示し、ダイアログと入力を保持する。対象削除・権限喪失・期限切れは、閉じてやり直す案内にする。

## 3. 方式と境界

| 方式 | 性質 | 判断 |
| --- | --- | --- |
| 編集用下書き＋版比較＋一括更新 | 添付を準備でき、キャンセル・再送・競合を扱える | 採用 |
| 本文のみ先行 | 小さいが、画面案の画像添付と作成済み機能との差が残る | 今回は採用しない |
| 元投稿を消して新規作成 | UUID・投稿日・リツイート関係が変わる | 採用しない |

新規画像の保存経路は変更しない。`TweetEditor` はDB上の編集準備・確定のみを担当し、Blob SDKやNext.jsに依存させない。

```ts
// domain/tweets/edit-tweet-validation.ts
export type EditTweetInput = {
  content: string;
  keepImageIds: string[]; // 既存images.id
  uploadIds: string[];    // この編集用下書きのmedia_uploads.id
};
export type ValidEditTweetInput = EditTweetInput;
// validateEditTweetInput(input) は既存と同じ {ok,value} / {ok:false,fieldErrors} を返す。
// 本文・合計枚数・UUID形式・重複を検証し、UUIDを小文字に正規化する。

// application/tweets/ports/tweet-editor.ts
export type EditableTweet = {
  draftId: string;
  tweetId: string;
  content: string;
  images: { id: string; position: number; width: number; height: number }[];
};
export type PrepareEditOutcome =
  | { status: 'ready'; value: EditableTweet }
  | { status: 'not-found' | 'forbidden' };
export type CommitEditOutcome =
  | { status: 'updated'; tweetId: string; replayed: boolean }
  | { status: 'not-found' | 'forbidden' | 'draft-closed' | 'conflict' | 'invalid-images' | 'upload-not-ready' };
export interface TweetEditor {
  prepare(input: {
    actorId: string; tweetId: string; draftId: string; now: Date; expiresAt: Date;
  }): Promise<PrepareEditOutcome>;
  commit(input: {
    actorId: string; draftId: string; value: ValidEditTweetInput; fingerprint: string; now: Date;
  }): Promise<CommitEditOutcome>;
}
```

- `beginTweetEdit` は未認証を先に拒否し、UUID検証後に `prepare`。下書きUUID・期限はサーバーで生成する。
- `updateTweet` は未認証→入力検証→fingerprint生成→`commit`。fingerprintは `JSON.stringify([content, keepImageIds, uploadIds])`。本文はLF正規化、UUIDは小文字、配列順を含める。
- applicationのエラーは `UNAUTHENTICATED / NOT_FOUND / FORBIDDEN / DRAFT_EXPIRED / CONFLICT / UPLOAD_NOT_READY / UNAVAILABLE / INVALID_INPUT`。`invalid-images` は images欄の `INVALID_INPUT` に変換する。DB・Blobの生エラーは表示しない。

## 4. DB・画像の確定手順

`004-edit-tweet.sql` を追加する。適用済み003は書き換えない。

```sql
ALTER TABLE twitter.tweets ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE twitter.tweet_drafts
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'create' CHECK (purpose IN ('create', 'edit')),
  ADD COLUMN target_tweet_id UUID REFERENCES twitter.tweets(id) ON DELETE SET NULL,
  ADD COLUMN base_revision BIGINT,
  ADD CONSTRAINT edit_draft_base_revision CHECK (purpose <> 'edit' OR base_revision IS NOT NULL);

ALTER TABLE twitter.images DROP CONSTRAINT images_tweet_position_unique;
ALTER TABLE twitter.images ADD CONSTRAINT images_tweet_position_unique
  UNIQUE (tweet_id, position) DEFERRABLE INITIALLY IMMEDIATE;
```

- 既存行は `purpose=create`。`PostgresTweetWriter.publish` はcreate用下書きのみ受け付け、編集確定はedit用のみ受け付ける。既存の公開済みcreate下書きの再送契約は保つ。
- prepareは対象投稿をロックし、所有者・本文・画像・revisionを同じスナップショットで読む。新しいedit下書きに `target_tweet_id` と `base_revision` を保存する。画面表示・添付解除の時点では元投稿を更新しない。
- `target_tweet_id` は対象削除でNULLを許可する。NOT NULLを付けたり、edit時のtarget非NULLをCHECKに入れてアカウント削除を妨げたりしない。

確定は `sql.begin` で次の順序にする。

1. 編集用下書きを `FOR UPDATE`。purpose・ownerを確認し、保存済みtargetを解決する。クライアントのtweetIdで対象を差し替えない。
2. 対象投稿を `FOR UPDATE` し、現在のownerを再確認する。対象なしはnot-found。
3. 下書きがpublishedなら、fingerprint一致だけ再送成功。現在の投稿や画像には触らない。異なる入力はconflict。
4. open・期限内であること、投稿の `revision = base_revision` を確認する。不一致は書き込まずconflict。BIGINTは文字列またはbigintで扱い、JSのDateやNumberへ丸めない。
5. 対象投稿の既存画像、新規upload行を一貫した順でロックする。keepImageIdsが対象投稿の画像だけで、元の相対順を保っていることを確認する。他人・別投稿の画像や並べ替え要求はinvalid-images。
6. uploadIdsはowner一致・このedit下書き所属・verifiedだけを受け付ける。保持＋新規で4枚以下、本文か画像ありをDBでの確定前にも確認する。
7. `SET CONSTRAINTS twitter.images_tweet_position_unique DEFERRED`。解除分だけimages行をDELETEし、既存トリガーで削除予約を積む。**保持分はDELETE/再INSERTしない**。同じ画像ID・URLを維持し、位置だけ0から詰める。新規分を末尾にINSERT、uploadをattachedへ更新する。
8. 正規化本文と画像の構成が変わった場合だけtweetsをUPDATE。`revision = revision + 1`、`updated_at = GREATEST(サーバー時刻, updated_at + interval '1 microsecond')` とし、created_atは変更しない。
9. `discardOpenUploads` でこの下書きの未使用reserved/verifiedを破棄・削除予約。下書きをpublishedとし、fingerprint・published_tweet_idを保存する。コミット時に既存「本文か画像」の遅延制約を確認する。

位置の一意制約を遅延させる理由は、複数の保持画像を一括で詰める際の一時的な衝突を避けるため。0〜3のCHECK・確定時の一意性は維持する。

Blob削除はこのトランザクションで実行しない。画像を解除すると `/media/{oldImageId}` は直ちに404となり、実体は既存Cron/CLIで回収する。保持画像は回収対象に入れない。

同じmigrationで `twitter.schedule_image_delete` を置き換え、削除予約時刻を `GREATEST(now(), 対応upload.token_valid_until)` にする。トークン有効中の画像を即削除し、有効なトークンで同じパスが再生成される隙間を作らない。トリガーのupsertは既存の早い予約時刻も必要に応じて延長する。アカウント削除経由でもこの扱いを統一する。

## 5. 変更ファイル

| 境界 | ファイルと役割 |
| --- | --- |
| domain | 新規 `domain/tweets/edit-tweet-validation.ts`：保持画像と新規画像を分けた入力検証。既存 `tweet-validation.ts` の本文・添付制約を再利用 |
| application | 新規 `application/tweets/begin-tweet-edit.ts`、`update-tweet.ts`、`ports/tweet-editor.ts`、`tweet-edit.ts`：準備・確定・結果型 |
| infra | 新規 `infra/db/migrations/004-edit-tweet.sql`、`infra/repositories/postgres-tweet-editor.ts`。既存 `postgres-tweet-writer.ts` にpurposeチェック。`media-sql.ts` の破棄を再利用 |
| composition | `app/_composition/tweet.ts` に `editor: new PostgresTweetEditor(sql)` を追加。実行時に依存を組み立てる方式を維持 |
| actions | 新規 `app/tweets/edit-actions.ts`、`edit-form-state.ts`。既存 `flash.ts`、`tweet-flash.tsx` に編集時の未認証通知を追加 |
| dialog | 新規 `app/ui/tweets/edit-tweet-dialog.tsx`、`edit-tweet-images.tsx`。`tweet-composer.tsx` にcreate/editの排他的な状態と更新成功通知を追加 |
| image picker | `tweet-image-picker.tsx` に `maxImages`（既存呼出しは既定4）を追加。保持画像数を引いた枠数を渡し、新規画像だけをアップロード・破棄する |
| menu/list | 新規 `app/ui/tweets/tweet-actions-menu.tsx`。既存 `tweet-card.tsx`、`timeline-list.tsx`、`profile-activity-list.tsx` とそれらを組み立てるhome/profileページから確認済みviewerIdを渡す |
| tests | 新規 `test/unit/domain/edit-tweet-validation.test.ts`、`test/unit/application/update-tweet.test.ts`、`test/unit/app/edit-tweet-actions.test.ts`、`test/unit/ui/edit-tweet-dialog.test.tsx`、`test/unit/ui/tweet-actions-menu.test.tsx`、`test/integration/postgres-tweet-editor.test.ts`、`test/e2e/edit-tweet-dialog.spec.ts` |
| fixtures/docs | 新規 `test/support/in-memory-tweet-editor.ts`、既存 `media-fixtures.ts` の編集用fixture。README、front_design、必要ならER図へ004と補完仕様を記録 |

`TweetCard` 全体をClient Componentにせず、メニューのみをClientにする。viewerIdは表示制御用であり、認可はActionとDBで再確認する。

## 6. TDDタスク

### Task 1: 編集の入力・ユースケース・ポート

**Files:** 上記domain/application、`test/unit/domain/edit-tweet-validation.test.ts`、`test/unit/application/update-tweet.test.ts`、`test/support/in-memory-tweet-editor.ts`。

- [x] 最初に失敗するテストを書く。本文0/280/281、絵文字、LF/CRLF、空白だけ、保持画像のみ、新規のみ、合計4/5、UUID不正・大小文字違いの重複を網羅する。
- [x] `pnpm exec vitest run --project unit test/unit/domain/edit-tweet-validation.test.ts test/unit/application/update-tweet.test.ts` を実行し、新規機能がないことによるFAILを確認する。
- [x] `EditTweetInput` の契約どおり検証・準備・更新を実装する。domainにDB/Next/Blobをimportしない。inputにactorId・revisionを含めない。
- [x] applicationテストでは、未認証・入力違反でcommitを呼ばないこと、結果の各status変換、例外時UNAVAILABLE、保持と新規を分けたfingerprintを検証する。

```ts
expect(validateEditTweetInput({ content: '', keepImageIds: [imageId], uploadIds: [] }).ok).toBe(true);
expect(validateEditTweetInput({ content: ' \r\n', keepImageIds: [], uploadIds: [] }).ok).toBe(false);
expect(await updateTweet(deps, { actorId: null, draftId, input })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
expect(deps.editor.commit).not.toHaveBeenCalled();
```

- [x] 同じコマンドでPASS、`pnpm typecheck`、必要な重複だけ整理する。
- [x] コミット：`feat: ツイート編集の入力検証とユースケースを追加`。

### Task 2: 編集用下書きと原子的な更新

**Files:** migration004、PostgresTweetEditor、PostgresTweetWriter、`test/integration/postgres-tweet-editor.test.ts`、MediaFixtures。

- [x] 結合テストを先に書く。本文更新、画像のみ、保持＋追加、先頭・中間の画像解除と位置の詰め直し、全解除＋本文、変更なし、キャンセルを確認する。
- [x] 所有者・purpose違い、改ざんした画像ID、別下書きupload、未verified、期限切れ、アカウント切替、対象削除、同一入力再送／別内容再送を追加する。
- [x] `pnpm exec vitest run --project integration test/integration/postgres-tweet-editor.test.ts` でFAILを確認する。接続は既存の専用DBチェック経由のみ。
- [x] migration004を作り `pnpm db:migrate --test` で専用DBへ適用する。section4のロック・更新手順を実装する。
- [x] 同じbase_revisionを持つ二つの下書きを `Promise.all` で確定し、**成功1件・conflict1件**、成功分だけ本文・画像・削除予約が変わることを確認する。
- [x] SQLで作成日時・UUID・owner・retweets、保持画像のID/URL/metadataが変わらないこと、変更なしでrevision/updated_at不変、失敗時の全列・画像・削除予約不変を確認する。
- [x] 保持画像の削除予約がないこと、解除画像の予約がトークン期限以降であること、未使用新規画像の削除予約を確認する。既存投稿作成とアカウント削除の結合テストも通す。
- [x] コミット：`feat: 本文と添付画像を競合検出付きで一括更新する`。

### Task 3: UI実装より先にE2Eを追加

**Files:** `test/e2e/edit-tweet-dialog.spec.ts`、既存テスト専用fixture。

- [x] 以下のE2Eを書き、Task4〜5の前に実行して編集導線・更新がないため失敗することを確認する。既存テストは無関係な理由で壊さない。
- [x] `pnpm exec playwright test test/e2e/edit-tweet-dialog.spec.ts` を実行し、失敗理由を記録する。

| ケース | 確認 |
| --- | --- |
| 自分の本文編集 | 初期値・更新・3秒通知・再読込後の保存内容、日時順が動かない |
| プロフィール・リツイート | 適切な本人のカードから編集でき、他人の元投稿は編集不可。元投稿を参照するカードへ反映 |
| 添付編集 | 保持＋解除＋新規追加。保持URLは同じ、解除URLは404、新規は配信可能。合計4枚を守る |
| キャンセル | 本文と画像を変更後、閉じる／Escで元投稿不変。新規だけ回収対象 |
| 入力違反・障害 | 欄エラー・通知、入力を保持、二重保存なし、失敗後の再試行 |
| 競合 | 二つのタブで開き先行保存、後続は上書きせず競合表示 |
| アカウント切替 | Aで開きBへログインして保存、誰も変更されない |
| ページ位置 | follow/cursor、プロフィールtab/cursor、戻る・進むで同じ条件と更新内容 |
| 375px・操作 | 横スクロールなし、フォーカス循環・復帰、Enter改行、保存中閉じられない |

- [x] テストデータは専用DB・専用Blobのみ。既存の隔離チェックを外さず、fixtureの下書き・削除予約も後片付けする。
- [x] コミット：`test: ツイート編集ダイアログのE2Eを先に追加`。この時点のE2E未実装FAILは計画上のものと明記する。

### Task 4: Server Action・認証・通知・キャッシュ

**Files:** edit-actions、edit-form-state、composition、flash、tweet-flash、`test/unit/app/edit-tweet-actions.test.ts`。

- [x] 開始／確定それぞれの未認証、viewer障害、他人、削除済み、入力違反、未準備画像、競合、期限切れ、DB障害、成功のテストを先に書く。
- [x] `pnpm exec vitest run --project unit test/unit/app/edit-tweet-actions.test.ts` でFAIL確認後、毎回resolveViewerを呼びユースケースへactor UUIDを渡すActionを実装する。
- [x] FormDataは単一draftId・単一content・複数keepImageIds/uploadIdsだけを厳密にparseする。File、重複single値、UUID不正、previousStateの改ざんで本人確認を回避できないことを確認する。
- [x] 成功はredirectせず `{ status: 'success', tweetId }` を返す。失敗はattemptとfieldErrors/messageを返す。未認証だけログイン通知をセットしてredirectする。

```ts
// DB確定成功後だけ呼ぶ。導入版のnode_modules/next/dist/docsで仕様を確認する。
revalidatePath('/');
revalidatePath('/profile/[displayId]', 'page');
return { status: 'success' as const, tweetId: result.tweetId };
```

- [x] Actionによる再取得でもroot composer内の入力を維持する。未認証redirect後は残った編集モーダルを閉じ、ログイン画面を操作できることを確認する。
- [x] 同じ単体テストをPASSにし、型チェック。コミット：`feat: ツイート編集のServer Actionと更新結果を追加`。

### Task 5: メニュー・編集ダイアログ・一覧への連携

**Files:** tweet-actions-menu、edit-tweet-dialog、edit-tweet-images、tweet-composer、tweet-image-picker、card/listとhome/profileページ、対応UIテスト。

- [x] 先にメニューと編集ダイアログのUIテストを書く。既存初期値、画像保持／解除、残り枠、追加、送信FormData、失敗保持、成功閉鎖、保存中ロックを検証する。
- [x] `pnpm exec vitest run --project ui test/unit/ui/edit-tweet-dialog.test.tsx test/unit/ui/tweet-actions-menu.test.tsx` でFAIL確認。
- [x] composerの状態を `null | { mode: 'create'; draftId } | { mode: 'edit'; value: EditableTweet }` として排他的に管理する。既存create APIを保ち、`openEdit(tweetId, 起動元要素)` を追加する。起動元が再作成されても同じカードのボタンへフォーカスを戻せる識別子を持たせる。
- [x] 既存画像はkeepImageIdsの状態で扱う。新規pickerには `maxImages={4 - keepImageIds.length}` を渡す。既存画像と予約画像を同じdiscardUploadへ渡さない。
- [x] pickerの `maxImages` はUIの早期制約。サーバーの最終的な合計枚数チェックを残す。既存の作成ダイアログはmaxImages既定4で同じ動作を維持する。
- [x] StrictModeのsetup/cleanup/setup、初期化前クリック、アップロード中の解除、破棄失敗→再試行、4枠使用時の再試行をUIテストに含める。mountedフラグはsetupで毎回trueへ戻す。
- [x] 成功時はcomposerに一回限りの更新通知を出してダイアログを閉じる。URLへ戻り先をクライアントから送らず、revalidate済みの現在の一覧を表示する。必要なrefreshは現在URLで行い、`push('/')` や `scrollTo(0, 0)` は使わない。
- [x] Task3のE2EをPASSにする。戻る・進む、同じ元投稿が複数カードにある場合の更新、focusとスクロール位置も実ブラウザで確認する。
- [x] コミット：`feat: 自分の投稿から本文と画像を編集できるダイアログを追加`。

### Task 6: 回帰確認・運用資料・完了判定

**Files:** README、front_design、計画書、関連する既存テスト。必要ならER図。

- [x] `pnpm test:unit` と `pnpm typecheck`：全件PASS／型エラーなし。
- [x] `pnpm test:integration`：作成・編集・画像回収・タイムライン・プロフィール・アカウント削除の全件PASS。データの原子性、同時更新、位置の制約、再送、本人確認を含む。
- [x] `pnpm test:e2e`：既存＋編集を全件PASS。編集E2Eは連続2回通し、不安定な待機を隠す固定sleepを入れない。
- [x] `pnpm build`：成功、ビルド時に実DB・Blobへ接続しない。
- [x] テスト用の古い編集下書き・解除画像を用意し、`pnpm media:cleanup --test` で回収を確認する。保持画像と確定した新規画像が残り、再実行が成功することも確認する。cleanupの分離チェックを維持する。
- [x] READMEとfront_designに補完仕様・004・適用順を記載し、計画の完了欄を実際の結果だけ更新する。
- [x] 開発DBへ適用する場合は開発用ブランチであることを秘密を表示せず確認する。本番004適用・merge・push・デプロイはこの計画の実装と分け、勝手に実行しない。
- [ ] 作成機能で残っている「デプロイ環境で5MiB画像をアップロード／配信」の確認は、ローカル編集テストの成功で完了にしない。デプロイ時は編集の画像追加・解除・保持も合わせて確認する。
- [x] コミット：`docs: ツイート編集の補完仕様と確認結果を記載`。

## 7. 完了条件

- [x] 自分の本文・既存画像・新規画像を編集でき、他人や別アカウントへの切替で更新できない。
- [x] 本文と画像が原子的に変わり、失敗・キャンセル・競合で元投稿が変わらない。
- [x] 版による競合検出、同じ操作の再送、変更なし保存が区別され、投稿日・UUID・リツイート関係を維持する。
- [x] 保持画像を消さず、解除・未使用・キャンセルの新規画像を回収できる。
- [x] メイン・プロフィール・リツイートの本文／画像が更新され、URL・一覧の位置・戻る進むが保たれる。
- [x] StrictMode、画像の失敗と解除、375px、キーボード、送信中の操作制御を確認した。
- [x] 単体・UI・結合・全E2E・型チェック・本番ビルドの結果が記録されている。

## 8. 実装前に読むローカルガイド

- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md`

導入版の挙動を優先する。特にServer Action後の再取得とroot layoutの状態保持、revalidatePathの訪問済みページへの影響を確認し、実ブラウザで保存後の一覧・スクロール・戻る進むを検証する。
