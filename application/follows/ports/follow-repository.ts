/**
 * 自分から対象者へのフォローを登録・解除する。逆方向の関係には触れない。
 * 同じ登録の再送では関係のUUID・日時を維持し、解除済みの解除も成功とする。
 */
export interface FollowRepository {
  set(input: {
    actorId: string;
    targetId: string;
    /** trueで登録、falseで解除。トグルにはしない。 */
    active: boolean;
    /** 新しく関係を登録するときだけ使うUUID・日時。 */
    id: string;
    now: Date;
  }): Promise<{ status: 'set'; active: boolean } | { status: 'actor-not-found' | 'target-not-found' }>;
}
