import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSql } from '@/infra/persistence/postgres/db/client';
import { SharpImageInspector } from '@/infra/external_services/media/sharp-image-inspector';
import { VercelBlobStorage } from '@/infra/external_services/media/vercel-blob-storage';
import { PostgresMediaRepository } from '@/infra/persistence/postgres/repositories/postgres-media-repository';
import { PostgresTweetDeleter } from '@/infra/persistence/postgres/repositories/postgres-tweet-deleter';
import { PostgresTweetEditor } from '@/infra/persistence/postgres/repositories/postgres-tweet-editor';
import { PostgresTweetWriter } from '@/infra/persistence/postgres/repositories/postgres-tweet-writer';

function build() {
  const sql = getSql();
  return {
    tweets: new PostgresTweetWriter(sql),
    editor: new PostgresTweetEditor(sql),
    deleter: new PostgresTweetDeleter(sql),
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
