import type { AccountDependencies } from '@/application/users/create-account';
import type { CreateAccountInput } from '@/domain/users/user';
import { FakePasswordHasher } from './fake-password-hasher';
import { InMemoryUserRepository } from './in-memory-user-repository';

export const FIXED_ID = '00000000-0000-4000-8000-000000000001';
export const FIXED_NOW = new Date('2026-10-23T03:04:05.000Z');

export const validInput: CreateAccountInput = {
  name: 'アリス',
  displayId: 'Alice_1',
  bio: 'こんにちは',
  password: 'password123',
};

export function createTestDependencies(overrides: Partial<AccountDependencies> = {}) {
  const users = new InMemoryUserRepository();
  const passwords = new FakePasswordHasher();
  let seq = 0;
  const deps: AccountDependencies = {
    users,
    passwords,
    newId: () => (seq++ === 0 ? FIXED_ID : `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`),
    now: () => FIXED_NOW,
    ...overrides,
  };
  return { deps, users, passwords };
}
