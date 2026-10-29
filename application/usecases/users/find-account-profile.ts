import { toAccountProfile, type AccountProfile } from '@/domain/entities/users/user';
import type { UserRepository } from '@/domain/repository_ifs/user-repository';

export async function findAccountProfile(
  deps: { users: UserRepository },
  id: string,
): Promise<AccountProfile | null> {
  const account = await deps.users.findById(id);
  return account ? toAccountProfile(account) : null;
}
