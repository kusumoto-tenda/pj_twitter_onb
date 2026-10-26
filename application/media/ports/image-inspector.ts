/** 画像の実体をデコードして形式と寸法を調べる。画像として読めなければnull。 */
export interface ImageInspector {
  inspect(bytes: Uint8Array): Promise<{ format: string; width: number; height: number } | null>;
}
