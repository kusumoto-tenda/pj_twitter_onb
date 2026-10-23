import type {
  CreateUserOutcome,
  UserRepository,
} from '@/application/users/ports/user-repository';
import { normalizeDisplayId } from '@/domain/users/account-validation';
import type { StoredAccount } from '@/domain/users/user';

export class InMemoryUserRepository implements UserRepository {
  readonly accounts: StoredAccount[] = [];

  async findByDisplayId(displayId: string): Promise<StoredAccount | null> {
    const key = normalizeDisplayId(displayId);
    return this.accounts.find((a) => normalizeDisplayId(a.displayId) === key) ?? null;
  }

  async findById(id: string): Promise<StoredAccount | null> {
    return this.accounts.find((a) => a.id === id) ?? null;
  }

  async create(account: StoredAccount): Promise<CreateUserOutcome> {
    if (await this.findByDisplayId(account.displayId)) return 'display-id-taken';
    this.accounts.push({ ...account });
    return 'created';
  }
}
