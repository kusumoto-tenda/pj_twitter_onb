# ツイート作成ダイアログ Implementation Plan

> **For agentic workers:** 実装時は `executing-plans` スキルを使い、下記タスクを1挙動ずつRed → Green → Refactorで進める。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ダイアログから本文・JPEG/PNG画像を投稿でき、成功後はメイン画面に投稿と3秒通知を表示する。画像のみの投稿、最大4枚・各5MBに対応する。

**Architecture:** domainが本文・添付制約、applicationが本人確認・画像準備・投稿確定・削除予約を扱う。infraがPostgreSQLトランザクションとVercel Blobを実装する。画像はブラウザから非公開Blobへ直接アップロードし、サーバーで実体を検証してから投稿へ紐付ける。appはダイアログ・アップロード入口・画像配信・通知を担当する。

**Tech Stack:** 既存Next.js / React / TypeScript / Auth.js / postgres / Vitest / Playwrightに `@vercel/blob` と画像実体検証用の `sharp` を直接依存として追加する。画像保存先はユーザー選択によりVercel Blob。

**Status:** 実装前の計画。画像添付込み・Vercel Blob採用はユーザー回答で確定済み。今回行うのは文書作成まで。Blobストアの作成、認証情報の変更、migration適用、アプリ実装は行わない。

---

## 1. 対象と段階分け

参照：`docs/functions.md`、`docs/front_design.md`、`docs/front/ツイート作成画面.png`、`docs/ER_diagram.drawio`。

今回の対象：

- メイン／プロフィール等の共通ナビから開く投稿ダイアログ。
- 本文0〜280コードポイントと、JPEG/PNG画像0〜4枚（各5MB）。本文・画像の少なくとも一方を必須とする。
- 画像の選択、プレビュー、添付解除、送信状態、サーバーでの検証。
- 投稿のUUID・投稿日時・編集日時の自動設定。
- メイン画面への遷移と「ツイートしました」の3秒通知。
- 未ログイン時のログイン誘導と「ツイートするにはログインしてください」の3秒通知。
- 失敗時のダイアログ維持、欄エラーと「ツイートに失敗しました」の3秒通知。
- メイン／プロフィール／リツイートカードでの添付画像表示。
- キャンセル・未投稿画像・削除済みアカウントの画像回収。

対象外：動画、投稿編集・削除のUI、いいね・リツイート・フォロー操作、プロフィール画像、URL等の自動リンク化、画像編集・並べ替え・拡大表示。

画像込みでは本文フォームだけで完結しないため、同じ計画を2段階に分ける。

1. **画像基盤（Task 1〜4）**：非公開Blob、画像検証、配信、DB、回収処理を独立して検証する。
2. **投稿と画面連携（Task 5〜8）**：投稿確定、ダイアログ、既存一覧、通知、E2Eを接続する。

画像基盤だけの段階ではユーザー向けの投稿ボタンを公開しない。作業途中の未検証画像を一覧へ出さない。

## 2. 投稿・画面の仕様

### 本文と画像

- 本文は既存と同じUnicodeコードポイント数で数える。改行はサーバー側でもCRLF/CRからLFへ正規化する。
- 本文の改行・前後空白は保存時に保持する。ただし空白・改行だけの本文は「内容なし」と判定し、画像もなければ拒否する。
- 280文字ちょうどは許可し281文字は拒否する。画像を付けても本文の上限は変えない。
- 本計画の5MBは `5 * 1024 * 1024 = 5,242,880 bytes` とする。上限ちょうどは許可、1byte超過は拒否。
- JPEG・PNGのみ。GIF・SVG・WebP・動画は受け付けない。拡張子やブラウザ提供MIMEだけで判断せず、サーバーでサイズ・実形式・画像として読めることを検証する。
- サーバーのデコードには画素数上限40,000,000を設け、超過は画像欄エラーにする。これはデコード時の資源使用量を制限するための補完仕様。
- 選択順を表示順として保存する。複数回の選択を合算して4枚まで。重複するuploadId、他人の画像、別下書きの画像、未検証・期限切れ画像は投稿できない。
- プレビューはローカルobject URLを使い、解除・閉じる・アンマウント時にrevokeする。画像読取に失敗した場合はその画像を特定して再選択できるようにする。
- 一部の画像がアップロード／検証に失敗したら投稿を確定しない。本文と成功済み添付は残し、失敗画像を解除または再試行できる。

### ダイアログ

- ネイティブ `<dialog>` のshowModalを使い、アクセシブル名「ツイートを作成」、本文ラベル、閉じるボタン、画像選択、投稿ボタンを用意する。
- 開いたら本文へフォーカス。Tab移動はダイアログ内、閉じたら起動ボタンへ戻す。Esc・閉じるでキャンセルし、背景クリックだけでは閉じない。
- 本文のEnterは改行。投稿は「ツイートする」ボタンで行い、日本語変換確定で誤送信しない。
- キャンセルは未投稿の本文・添付を破棄する。確認モーダルや下書き保存機能は今回追加しない。
- 投稿確定処理中は閉じる・Esc・投稿の二重操作を抑止する。アップロード中のキャンセルは可能とし、クライアント処理を中断してサーバー側にも破棄を通知する。
- 開く直前にサーバーで認証・利用者の実在を確認し、下書きを作る。未ログインならダイアログを開かずログインへ遷移する。
- フォーム表示後に別アカウントへ変わっても、元の下書きや画像を新しい利用者の投稿にしない。保存の各入口で現在のUUIDと下書き所有者を照合する。
- 成功後はダイアログを閉じ `/` の先頭へ移動する。フォロー条件・ページ送り位置は引き継がない。メイン画面に自分の新規投稿を表示する。
- 入力ミス・画像不正・保存障害では現在の画面とダイアログを維持し、欄エラーと失敗Toastを表示する。本文の再入力を要求しない。
- PCでは画面案に沿った中央ダイアログ、375pxでは画面内に収まる幅・高さと内部スクロールを使う。既存ナビにも投稿ボタンが収まるよう折り返す。

## 3. Blobの方式と環境

**非公開Vercel Blob＋直接アップロード＋投稿済み画像のみアプリ経由で配信**を採用する。

- Vercel Functionsの4.5MBリクエスト上限を避け、画像の本体をServer Actionやアプリのmultipart POSTへ送らない。ブラウザはBlob SDKのclient uploadを使う。[公式資料](https://vercel.com/docs/vercel-blob/server-upload)
- アプリのアップロード入口で認証し、対象下書き・予約済みパスに限った短命のトークンを発行する。サーバー側のBlob資格情報をクライアントへ渡さない。[client upload](https://vercel.com/docs/vercel-blob/client-upload)
- ストアはPrivate。未投稿の実体に公開URLを与えない。投稿済み画像はRoute HandlerからSDKのストリームで返す。[private storage](https://vercel.com/docs/vercel-blob/private-storage)
- UIでの表示URLは `/media/{imageId}`。ストレージキーやBlobの任意URLをGETパラメータとして受け付けず、DBの公開済み画像行から解決する。
- `/media` は公開投稿なので閲覧者のログインは不要だが、毎回画像と元投稿の存在を確認する。未投稿・破棄済み・削除済み画像は404。外部の任意URLをfetchしない。
- 配信は `Cache-Control: private, no-store`、検証済みのContent-Type、`X-Content-Type-Options: nosniff`。バッファ化せずストリームで返し、5MBのファイルも配信できるようにする。
- 初回は通常のimgで `/media` を表示し、画像最適化キャッシュを経由させない。width/height、alt、lazy loadingを指定する。削除後の再取得がキャッシュ済み最適化画像を返さない設計とする。
- Privateの配信はFunctions経由の転送・実行が発生する。公開Blob直結より処理が増える一方、未投稿・削除済みの公開制御をDBに合わせられる。

実装時の環境設定：

- アプリ用の非公開Blobストアと、自動テスト用の別の非公開Blobストアを用意する。開発と本番のアプリ用ストアも分け、DBの接続先と対応を記録する。
- アプリ：`BLOB_READ_WRITE_TOKEN`、`BLOB_STORE_ID`。テスト：`TEST_BLOB_READ_WRITE_TOKEN`、`TEST_BLOB_STORE_ID`。トークンはサーバーだけで使い、NEXT_PUBLICを付けない。
- 導入SDKが提供するストア識別方法と照合し、テストの資格情報がアプリ用ストアを指していないことを、実体の作成・削除前に検証する。キー形式の独自推測だけに依存しない。
- Playwrightサーバーにはテスト用Blob設定を渡す。テストDBの既存分離チェックも維持する。結合/E2Eで必要な資格情報がなければ、成功扱いでskipせずセットアップ不足を明示して失敗する。
- ローカルで完了webhookが届かなくても動くよう、最終検証は認証済みクライアントの明示的なverifyリクエストで行う。webhook到達を投稿成功の必須条件にしない。

## 4. アップロードから投稿確定まで

```text
起動 → サーバーで現在の利用者確認・下書きUUID発行
  → 画像ごとに所有者付き予約レコード作成
  → 予約パス限定のclient uploadトークン発行
  → ブラウザからPrivate Blobへ直接アップロード
  → サーバーでBlob実体を検証しverifiedへ
  → 本文・順序付きuploadIdだけを送信
  → 下書きと画像をロックし、投稿＋画像参照をDBトランザクションで確定
  → キャッシュ無効化・成功通知・メイン画面へ
```

- 下書きは24時間有効。トークンは15分以内とし、導入SDKの実際のオプション・型に従って期限を固定する。
- パスはサーバーが `tweet-uploads/{draftId}/{uploadId}` のように生成する。元ファイル名は識別子にしない。許可したJPEG/PNG、最大5,242,880bytes、上書き不可をトークンにも設定する。
- 下書き行をロックして同時予約を調整し、現在使用中の画像が合計4枚を超えるトークン発行を防ぐ。取り外した予約は再利用せず、新しいUUID・パスにする。
- verifyは現在の利用者・下書き所有者・予約レコードを確認する。信頼する取得先はサーバー保存のパスのみ。クライアント申告のサイズ・MIME・verifiedフラグ・Blob URLを信じない。
- Blobのメタデータだけで終わらず、上限付きで読み取り実体を検証する。取得バイト数が上限を超えたら中断する。sharpでJPEG/PNGとしてデコードできることと画素数を確認する。
- verifiedになったオブジェクトは、トークン再発行等で上書きできないことをSDKの実挙動でも確認する。未検証内容への差し替えを許さない。
- SDKの完了callbackを利用する場合はSDKの署名検証を通し、通常のトークン発行と区別する。callbackだけで投稿を作成せず、破棄・削除後のレコードを復活させない。
- 本文だけの投稿も同じ下書き確定処理を使う。画像がある場合だけストレージに依存し、本文投稿に不要なBlobアクセスをしない。
- draftIdを投稿UUIDとして使い、確定済みの同じ下書き・同じ内容への再送は既存の成功結果を返す。同じ下書きで異なる内容の再送は競合として拒否する。ネットワークの再送で投稿を増やさない。
- confirmed内容の比較用に正規化本文＋順序付きuploadIdのfingerprintを下書きへ保存する。本人確認なしで既存結果を返さない。
- 投稿日と最終編集日は注入した時計から同じ時刻を設定する。日時・所有者はクライアントから受け取らない。
- 投稿確定中にアカウントが削除された場合はFK/所有者確認で失敗し、投稿だけが残らない。

## 5. DB設計と既存機能への影響

`003-create-tweet-media.sql` を追加する。既存002を書き換えない。

| 対象 | 変更 |
| --- | --- |
| tweets | contentの長さ制約を0〜280へ変更。画像なしの空投稿を防ぐ遅延制約を追加 |
| tweet_drafts | id(UUID)、owner_id、status(open/published/discarded)、expires_at、fingerprint、published_tweet_id。所有者削除はSET NULL |
| media_uploads | id、draft_id、owner_id、storage_key、status(reserved/verified/attached/discarded/deleting)、size/content_type/width/height、token_valid_until、created_at。owner削除はSET NULL |
| images | id、tweet_id(FK CASCADE)、upload_id(UNIQUE)、storage_key、position(0〜3)、検証済みサイズ・形式・寸法。UNIQUE(tweet_id,position) |
| media_delete_jobs | storage_keyを一意キーに、not_before、attempts、next_attempt_at、last_error_code。利用者削除でも消えない |

- 公開投稿は「空白のみでない本文」または「1枚以上のimages」を必須とする。tweets/imagesへの変更を監視するDEFERRABLE INITIALLY DEFERREDなconstraint triggerで、トランザクションの最後に検証する。
- トリガーは削除済みtweetに対してエラーにせず、アカウント削除のCASCADEを妨げない。imagesのposition制約で最大4枚を保証する。
- 投稿確定はdraft→uploadの順で行ロックし、所有者・有効期限・verified・未使用を再確認してtweets/imagesをINSERT、uploadをattached、draftをpublishedにする。同じ順序でロックしデッドロックを避ける。
- imagesのDELETE時に、storage_keyをmedia_delete_jobsへ登録するトリガーを置く。CASCADEによるアカウント削除でも、実体の削除予約が同じDBトランザクションで残る。
- 画像キーを保存したままのmedia_uploadsは、アカウント削除でowner_idがNULLになっても残し、未投稿オブジェクトの回収対象にする。未完了下書きの管理情報を無条件にCASCADEで消さない。
- `images(tweet_id,position)` と、未使用upload/削除jobの状態・期限に適切な索引を置く。
- メインとプロフィールの読み取りに `images: { id, position, width, height }[]` を追加する。ページの20件を選ぶ前に画像を多重JOINしない。イベントをページングしてから画像配列を集約し、カード単位の追加SQLをしない。
- 画像だけの投稿では空の本文段落を省略し、画像を表示する。リツイートも元投稿の画像を同じ順で表示する。

## 6. キャンセル・失敗・削除時の画像回収

- DBとBlobの変更は単一トランザクションにはならない。Blob削除の失敗で投稿や利用者のDB削除を巻き戻したり、削除済みの行を復活させたりしない。
- 画像解除・ダイアログのキャンセルは、所有者確認後に対象をdiscardedとして回収予約する。投稿済み画像をこのAPIで解除させない。
- 投稿のDB保存に失敗した場合、下書きがopenで有効な間はverified画像を保持し、再アップロードなしで再試行できる。キャンセルまたは期限切れで回収する。
- クライアントが閉じる通知を送れなかった場合も、24時間経過した未投稿下書きを回収対象にする。
- アカウント削除でimagesが消えた時点から `/media/{id}` は404。Blobの物理削除完了を待って公開を止める設計にしない。
- 削除jobは、Blob削除成功または対象なしで完了する。失敗は予約を残し、再試行する。同じjobの重複実行でも正常に終わるようにする。
- トークンがまだ有効な時点でBlobを消すと、その後のアップロード完了で実体が再生成され得る。token期限までは破棄情報を保持し、期限後にも再確認する。遅着callbackでverified/attachedへ戻さない。
- 管理パス配下の24時間以上古い孤立Blobも定期照合する。DB上で公開・有効下書きへ参照中のものは削除しない。回収と投稿確定は行ロック・deleting状態で排他する。
- 回収は `pnpm media:cleanup` と認証付きCron Routeから同じユースケースを使う。Cronは1日1回を初期設定とし、GET入口にはCRON_SECRETの認証を必須にする。利用者向けGETから削除処理は呼ばない。
- Vercel Hobbyでは日次スケジュールに制約があるため、毎時実行を前提にしない。[公式資料](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## 7. 層と主要契約

```ts
type TweetInput = { content: string; uploadIds: string[] };
type ValidTweetInput = { content: string; uploadIds: string[] };
type CreateTweetResult =
  | { ok: true; tweetId: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'DRAFT_EXPIRED' | 'UPLOAD_NOT_READY' | 'CONFLICT' | 'UNAVAILABLE' }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: { content?: string[]; images?: string[] } };

interface TweetWriter {
  // トランザクション内で下書き・画像の状態と所有者を再確認して確定する。
  publish(input: {
    actorId: string;
    draftId: string;
    value: ValidTweetInput;
    now: Date;
  }): Promise<CreateTweetResult>;
}
interface MediaStorage {
  // パスはサーバーで生成・保存した値のみ。
  inspect(pathname: string): Promise<{ size: number; contentType: string }>;
  open(pathname: string): Promise<ReadableStream<Uint8Array>>;
  remove(pathnames: string[]): Promise<void>;
}
```

- domainはNext.js、File、Blob SDK、SQLへ依存しない。本文・画像数・サイズ・形式の業務上限を純粋な値で検証する。
- applicationには `beginTweetDraft / reserveImageUpload / verifyImageUpload / discardTweetDraft / createTweet / cleanupMedia` を置き、ポート越しにDB・画像実体検証・ストレージを利用する。
- SDKの署名トークン生成・callback処理はapp/infra境界に隔離する。SQLのエラーやBlobの生レスポンスをクライアントへ返さない。
- `createTweet` はサーバー由来のactorIdと本文・uploadIdだけを受け取る。申告されたownerId、日時、URL、サイズ、MIME、verified状態を採用しない。
- Route Handlerの予約・検証・破棄入口は認証と同一Origin確認を行う。通常のServer Actionと異なり、Route HandlerにServer ActionのCSRF保護が自動適用されると思い込まない。
- Server Actionの投稿データは本文・UUID等の小さなものに限定し、bodySizeLimitを20MB等へ広げて画像を通す対応はしない。

## 8. ファイル配置

```text
Create:
  domain/tweets/tweet-validation.ts
  application/tweets/{tweet.ts,begin-tweet-draft.ts,create-tweet.ts,discard-tweet-draft.ts}
  application/tweets/ports/tweet-writer.ts
  application/media/{media.ts,reserve-image-upload.ts,verify-image-upload.ts,cleanup-media.ts}
  application/media/ports/{media-repository.ts,media-storage.ts,image-inspector.ts}
  infra/db/migrations/003-create-tweet-media.sql
  infra/repositories/{postgres-tweet-writer.ts,postgres-media-repository.ts}
  infra/media/{vercel-blob-storage.ts,sharp-image-inspector.ts}
  app/_composition/tweet.ts
  app/tweets/actions.ts
  app/tweets/form-state.ts
  app/api/tweet-images/upload/route.ts
  app/api/tweet-images/verify/route.ts
  app/api/tweet-images/discard/route.ts
  app/api/cron/media-cleanup/route.ts
  app/media/[imageId]/route.ts
  app/ui/tweets/{create-tweet-launcher.tsx,create-tweet-dialog.tsx,tweet-image-picker.tsx}
  app/ui/notifications/tweet-flash.tsx
  scripts/cleanup-media.mts
  test/support/{in-memory-tweet-writer.ts,fake-media-storage.ts,media-fixtures.ts,blob-environment.ts}
  test/unit/domain/tweet-validation.test.ts
  test/unit/application/{create-tweet.test.ts,media.test.ts}
  test/unit/app/{tweet-actions.test.ts,media-routes.test.ts}
  test/unit/ui/{create-tweet-dialog.test.tsx,tweet-image-picker.test.tsx,tweet-flash.test.tsx}
  test/integration/{postgres-tweet-writer.test.ts,postgres-media-cleanup.test.ts,vercel-blob.test.ts}
  test/e2e/create-tweet-dialog.spec.ts
  vercel.json

Modify:
  application/timeline/timeline.ts
  infra/queries/{timeline-rows.ts,postgres-timeline-query.ts,postgres-profile-query.ts}
  app/ui/timeline/{main-navigation.tsx,tweet-card.tsx}
  app/(home)/page.tsx
  app/login/page.tsx
  app/ui/notifications/flash.ts
  app/profile/[displayId]/delete/actions.ts
  test/support/timeline-fixtures.ts
  test/unit/ui/timeline.test.tsx
  test/integration/postgres-account-delete.test.ts
  playwright.config.ts
  vitest.config.ts
  package.json
  pnpm-lock.yaml
  .env.example
  README.md
  docs/front_design.md
```

中括弧表記は列挙した個々のファイルを指す。既存のPageShell・FormField・Toast・通知Cookie消費を再利用する。beginTweetDraftを起動時に呼ぶことで、各ページから大量の認証情報をpropsで渡す構造にしない。

## 9. TDDタスク

### Task 1: 入力と状態遷移の契約

- [x] 本文のみ・画像のみ・両方・両方なしのテストを書く。空白だけ、280/281文字、絵文字、改行正規化を境界として検証する。
- [x] 画像の0/4/5枚、サイズ上限ちょうど/1byte超過、JPEG/PNG/GIF/SVG、重複uploadIdを検証する。
- [x] 下書き所有者・有効期限・公開済み再送・異なる内容再送のユースケースをin-memoryポートでTDDする。
- [x] 別アカウント・削除済み利用者・他人のupload・別下書きのuploadでは保存しないテストを書く。
- [x] begin/reserve/verify/discard/cleanupの状態遷移、失敗時に公開済みへ進まないことをテストする。

代表ケース：

```ts
it('本文がなくても画像1枚があれば入力として有効', () => {
  expect(validateTweetInput({
    content: '', uploadIds: ['00000000-0000-4000-8000-000000000001'],
  })).toEqual({ ok: true, value: {
    content: '', uploadIds: ['00000000-0000-4000-8000-000000000001'],
  } });
});
```

Run: `pnpm exec vitest run --project unit test/unit/domain/tweet-validation.test.ts test/unit/application/create-tweet.test.ts test/unit/application/media.test.ts`。

### Task 2: migrationと投稿確定のDB処理

- [x] 003を専用テストDBへ適用し、本文のみ／画像のみ／両方の原子的な保存からTDDする。
- [x] 本文空＋画像なしをDBのcommit時にも拒否し、5枚・position重複・upload再利用を拒否する。
- [x] 同じ下書きの同時確定は1投稿だけ。同じ再送は同じ成功結果、別内容の再送は競合になることを検証する。
- [x] 未検証・他人・別下書き・期限切れ・deletingの画像を確定できないことを検証する。
- [x] 下書きと画像のロック中に利用者削除や回収が競合しても、不完全な公開投稿が残らないことを確認する。
- [x] 投稿日・最終編集日は同一。既存のアカウント削除CASCADEで画像行が消え、削除jobが残ることを確認する。
- [x] 本人と無関係な利用者の画像・投稿を消さないことを実DBで確認する。

Run: `pnpm exec vitest run --project integration test/integration/postgres-tweet-writer.test.ts test/integration/postgres-media-cleanup.test.ts`。

### Task 3: Vercel Blob直接アップロードと検証

- [x] SDKとsharpの対応バージョンを確認して依存へ追加し、lockfileへ固定する。トークンの最大サイズ・期限・パス・上書き制御を実SDKの型で確認する。
- [x] 予約・トークン発行・verify・discardで、現在の認証／所有者／Originが必要なことをRoute境界テストで検証する。
- [x] Content-Type偽装、拡張子偽装、壊れたJPEG/PNG、サイズ超過、画素数超過、任意URL、他人のキーを拒否する。
- [x] 実テスト用BlobへJPEG/PNGをアップロードし、実体検証・ストリーム取得・削除を確認する。通常テストはfake Storageで外部障害も再現する。
- [x] 5MBの画像がアプリのリクエストボディを通らずアップロードできることを確認する。
- [x] 完了webhookなしでもverify→投稿へ進め、遅れて到達するcallbackで破棄状態が復活しないことを検証する。
- [x] テストのBlob分離チェックを先に実行し、実体・予約レコードを自身のUUIDで後片付けする。

Run: `pnpm exec vitest run --project unit test/unit/app/media-routes.test.ts`、`pnpm exec vitest run --project integration test/integration/vercel-blob.test.ts`。

### Task 4: 画像配信・回収・アカウント削除の回帰

- [x] 投稿済み画像だけ200、未投稿・破棄・削除済みは404となる配信RouteをTDDする。外部URLやBlobトークンを返さない。
- [x] 配信サイズ・Content-Type・nosniff・no-storeとストリーム応答を検証する。
- [x] discard／期限切れ／アカウント削除で回収予約が残ること、Blob障害でもjobを失わず再実行できることをテストする。
- [x] トークン有効中の遅着アップロード、遅着callback、回収と公開の競合をテストする。
- [x] Cronの未認証呼び出しを拒否し、CLIとCronが同じcleanupユースケースを呼ぶことを確認する。
- [x] 削除済みアカウントの画像URLが直ちに404になり、物理Blobは回収で消えることを実テスト用ストアで確認する。

Run: `pnpm exec vitest run --project unit test/unit/app/media-routes.test.ts test/unit/application/media.test.ts`、`pnpm exec vitest run --project integration test/integration/postgres-account-delete.test.ts test/integration/postgres-media-cleanup.test.ts`。

### Task 5: 投稿Action・既存一覧・通知

- [x] beginTweetDraftで未ログインなら専用通知を設定してloginへ、ログイン中なら所有者付き下書きを返すテストを書く。
- [x] createTweetActionは現在の利用者を取り直し、ownerId・日時・URL等の改変入力を採用しないことを検証する。
- [x] DB／画像検証／ストレージの失敗ではダイアログの本文・添付参照を保持し、失敗通知と欄エラーを返す。
- [x] 成功はrevalidatePath→専用通知→ `/` へredirectし、try/catchで遷移を握り潰さない。
- [x] TimelineItemへimagesを追加し、既存fixtureはimages=[]で更新する。通常投稿・リツイート・プロフィールのQueryが順序付き画像を返すことをテストする。
- [x] 画像JOINで20件が減ったり、投稿カードが重複したり、SQLがカード件数に比例して増えたりしないことを検証する。
- [x] 投稿成功・未ログイン通知が3秒で消え、登録・編集・削除の通知と干渉しないことを確認する。

Run: `pnpm exec vitest run --project unit test/unit/app/tweet-actions.test.ts`、`pnpm test:unit`、`pnpm test:integration`。

### Task 6: ダイアログ・画像選択・アクセシビリティ

- [x] 起動、showModal、本文フォーカス、Tab移動、Esc、閉じる、起動ボタンへのフォーカス復帰をUIテストで確認する。showModalの実挙動はE2Eで確認する。
- [x] 文字数表示、改行・IME入力、4枚選択、複数回選択、解除、再試行、プレビューURLの解放をテストする。
- [x] アップロードと検証中は状態を表示し、投稿確定中は二重投稿・閉じるを抑止する。キャンセルでDBに投稿を作らない。
- [x] 別アカウントに切り替わった古い下書きからのアップロード／投稿を拒否する。
- [x] 失敗時はダイアログ・本文・成功済み添付を維持し、失敗Toastの3秒表示と同じエラーの再表示をテストする。
- [x] PC/375pxで本文・プレビュー・閉じる・投稿が操作できるようにする。

Run: `pnpm exec vitest run --project ui test/unit/ui/create-tweet-dialog.test.tsx test/unit/ui/tweet-image-picker.test.tsx test/unit/ui/tweet-flash.test.tsx`。

### Task 7: 作成ダイアログE2E

- [x] Task 5〜6の実装前に代表E2Eを書いてRedを確認する。本文投稿、画像のみ、本文＋4枚、キャンセル、未ログインを最低限のシナリオとする。
- [x] 実テスト用BlobでJPEG/PNG、5MB境界、画像解除、失敗後の再送を確認し、投稿後の画像がブラウザで読み込めることを確認する。
- [x] 本文281文字、5枚、GIF、空投稿は欄エラーと失敗通知で、公開投稿が増えないことを確認する。
- [x] メイン・本人プロフィール・元投稿を参照するリツイートで画像の順序と内容を確認する。
- [x] ログイン中に別アカウントへ切り替えた下書きでは投稿が増えないことを確認する。
- [x] 通信再送で1投稿だけになること、成功後は `/` の先頭と3秒通知、再読込後は通知なしを確認する。
- [x] アカウント削除後は関連画像URLが404となり、回収で実体が消え、他人の画像は残ることを確認する。
- [x] PC/375px、フォーカス・キーボード操作を確認し、既存E2E32件も通す。
- [x] 作成したUUID・管理パスの画像だけを後片付けし、ストア全体の削除やDB全体の初期化をしない。

Run: `pnpm exec playwright test test/e2e/create-tweet-dialog.spec.ts`、その後 `pnpm test:e2e`。

### Task 8: セットアップ・全体検証・運用手順

- [x] README/.env.exampleにアプリとテストのBlobストア、直接アップロード、日次回収と手動cleanup、ローカルverify方式を記録する。秘密の値は文書やGitへ入れない。
- [x] 003の開発／テスト適用手順を記載する。既存データを移す必要はないが、空本文を許す制約・画像制約・削除トリガーの動作を確認する。
- [x] `pnpm test:unit`、`pnpm test:integration`、`pnpm typecheck`、`pnpm build`、`pnpm test:e2e` を実行し結果を記録する。
- [x] `pnpm media:cleanup` をテスト用ストアで実行し、期限切れ・削除jobの回収と再実行を確認する。
- [x] ビルド時にBlobやDBへ接続しない。SDK資格情報は実行時のserver-only設定として扱う。
- [ ] Vercelへデプロイした環境でも実際の5MB uploadとstream配信を確認し、ローカル成功だけでサイズ上限の検証完了としない。
- [x] 開発用Blobの作成・接続、003の開発DB適用は実装後に接続先を確認して行う。本番の適用・デプロイは別の指示に従う。
- [x] Task単位でコミットし、既存ブランチの状態を確認する。勝手にmerge/pushしない。

## 10. 実装前の参照資料と完了条件

AGENTS.mdに従い、導入済みNext.jsの以下を読む。

- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`

Blob SDKの導入時に、client upload・Private get・del・list・トークン制限を公式資料と型で照合する。[SDK reference](https://vercel.com/docs/vercel-blob/using-blob-sdk)

完了とは、本文のみ／画像のみ／両方をダイアログから投稿でき、正しい本人と画像に紐付き、一覧で表示され、失敗・キャンセル・アカウント削除後の画像も管理できる状態をいう。本文フォームだけが成功した段階や、画像URLを保存できたが配信・削除を確認していない段階では完了としない。
