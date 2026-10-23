import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/domain/users/user';
import { PostgresUserRepository } from '@/infra/repositories/postgres-user-repository';
import {
  connectTestDatabase,
  deleteUsersByDisplayIds,
  uniqueDisplayId,
} from '@/test/support/test-db';

let sql: postgres.Sql;
let repository: PostgresUserRepository;
const created: string[] = [];

function account(overrides: Partial<StoredAccount> = {}): StoredAccount {
  const displayId = overrides.displayId ?? uniqueDisplayId();
  created.push(displayId);
  return {
    id: randomUUID(),
    name: 'アリス',
    displayId,
    bio: '',
    passwordHash: 'scrypt$test-hash',
    createdAt: new Date('2026-10-23T03:04:05.678Z'),
    ...overrides,
  };
}

beforeAll(async () => {
  sql = await connectTestDatabase();
  repository = new PostgresUserRepository(sql);
});

afterEach(async () => {
  await deleteUsersByDisplayIds(sql, created.splice(0));
});

afterAll(async () => {
  await sql.end();
});

describe('PostgresUserRepository', () => {
  it('保存後に大文字小文字違いのIDで検索でき、登録時の表記を保つ', async () => {
    const base = uniqueDisplayId('A');
    const alice = account({ displayId: `${base.slice(0, 10)}_Ab` });

    expect(await repository.create(alice)).toBe('created');
    const found = await repository.findByDisplayId(alice.displayId.toUpperCase());

    expect(found?.id).toBe(alice.id);
    expect(found?.displayId).toBe(alice.displayId);
  });

  it('UUID・作成日時・空のbio・password_hashを往復できる', async () => {
    const alice = account();

    await repository.create(alice);

    expect(await repository.findById(alice.id)).toEqual(alice);
  });

  it('未登録なら null を返す', async () => {
    expect(await repository.findByDisplayId(uniqueDisplayId())).toBeNull();
    expect(await repository.findById(randomUUID())).toBeNull();
  });

  it('大文字小文字違いの同時登録は1件だけ成功し、DB行も1件になる', async () => {
    const base = uniqueDisplayId('C');
    const upper = account({ displayId: base.toUpperCase() });
    const lower = account({ displayId: base.toLowerCase() });

    const outcomes = await Promise.all([repository.create(upper), repository.create(lower)]);

    expect(outcomes.sort()).toEqual(['created', 'display-id-taken']);
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM twitter.users WHERE lower(display_id) = ${base.toLowerCase()}
    `;
    expect(count).toBe(1);
  });

  it('一意性以外のCHECK違反は重複扱いにせずthrowする', async () => {
    await expect(repository.create(account({ name: '' }))).rejects.toThrow();
    await expect(repository.create(account({ bio: 'あ'.repeat(161) }))).rejects.toThrow();
    await expect(repository.create(account({ displayId: 'bad-id' }))).rejects.toThrow();
  });

  it('接続できない場合は重複扱いにせずthrowする', async () => {
    const broken = postgres('postgres://nobody:nothing@127.0.0.1:1/none', {
      connect_timeout: 1,
      max: 1,
    });
    try {
      await expect(new PostgresUserRepository(broken).create(account())).rejects.toThrow();
    } finally {
      await broken.end({ timeout: 0 });
    }
  });
});
