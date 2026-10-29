/** 画像の実体の保存先。パスはサーバーで生成・保存した値だけを渡す。 */
export interface MediaStorage {
  /** 指定パスだけに書き込める短命のクライアント用トークンを発行する。 */
  createUploadToken(input: {
    pathname: string;
    maximumSizeInBytes: number;
    allowedContentTypes: readonly string[];
    validUntil: Date;
  }): Promise<string>;
  /** メタデータを返す。存在しなければnull。 */
  inspect(pathname: string): Promise<{ size: number; contentType: string } | null>;
  /** 実体をストリームで返す。存在しなければnull。 */
  open(pathname: string): Promise<ReadableStream<Uint8Array> | null>;
  /** 削除する。存在しないパスはエラーにしない。 */
  remove(pathnames: string[]): Promise<void>;
  /** prefix配下で、指定時刻より前にアップロードされたもののパス。 */
  listOlderThan(prefix: string, before: Date): Promise<string[]>;
}
