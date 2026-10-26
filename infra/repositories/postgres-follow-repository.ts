import type postgres from 'postgres';
import type { FollowRepository } from '@/application/follows/ports/follow-repository';

type SetOutcome = Awaited<ReturnType<FollowRepository['set']>>;

export class PostgresFollowRepository implements FollowRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async set({ actorId, targetId, active, id, now }: Parameters<FollowRepository['set']>[0]): Promise<SetOutcome> {
    try {
      return await this.sql.begin(async (tx): Promise<SetOutcome> => {
        // 相互フォローでも常にUUID順で両者をロックし、逆順取得によるデッドロックを避ける。
        // 退会と直列化してから、登録済み・解除済みの場合も両者の実在を確認する。
        const users = await tx<{ id: string }[]>`
          SELECT id FROM twitter.users
          WHERE id = ${actorId} OR id = ${targetId}
          ORDER BY id FOR UPDATE
        `;
        if (!users.some((user) => user.id === actorId)) return { status: 'actor-not-found' };
        if (!users.some((user) => user.id === targetId)) return { status: 'target-not-found' };

        if (active) {
          // 再送で関係のUUID・日時や一覧の順番を変えない。
          await tx`
            INSERT INTO twitter.follows (id, follower_id, follow_id, created_at)
            VALUES (${id}, ${actorId}, ${targetId}, ${now})
            ON CONFLICT (follower_id, follow_id) DO NOTHING
          `;
        } else {
          // 逆方向と他人同士の関係には触れない。
          await tx`DELETE FROM twitter.follows WHERE follower_id = ${actorId} AND follow_id = ${targetId}`;
        }
        return { status: 'set', active };
      });
    } catch (error) {
      // 対応する外部キーだけ分類し、CHECK違反や無関係なSQLエラーは呼び出し元に返す。
      const fk = error as { code?: string; constraint_name?: string };
      if (fk.code === '23503') {
        if (fk.constraint_name === 'follows_follower_id_fkey') return { status: 'actor-not-found' };
        if (fk.constraint_name === 'follows_follow_id_fkey') return { status: 'target-not-found' };
      }
      throw error;
    }
  }
}
