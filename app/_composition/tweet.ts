import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSql } from '@/infra/db/client';
import { SharpImageInspector } from '@/infra/media/sharp-image-inspector';
import { VercelBlobStorage } from '@/infra/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/repositories/postgres-media-repository';
import { PostgresTweetEditor } from '@/infra/repositories/postgres-tweet-editor';
import { PostgresTweetWriter } from '@/infra/repositories/postgres-tweet-writer';

function build() {
  const sql = getSql();
  return {
    tweets: new PostgresTweetWriter(sql),
    editor: new PostgresTweetEditor(sql),
    media: new PostgresMediaRepository(sql),
    // 資格情報はサーバーの実行時設定だけから読む（ビルド時には接続しない）。
    storage: new VercelBlobStorage(process.env.BLOB_READ_WRITE_TOKEN),
    inspector: new SharpImageInspector(),
    newId: randomUUID,
    now: () => new Date(),
  };
}

let dependencies: ReturnType<typeof build> | undefined;

/** 投稿・画像の具体実装を組み立てる唯一の場所。 */
export function getTweetDependencies() {
  dependencies ??= build();
  return dependencies;
}
