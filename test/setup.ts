import { vi } from 'vitest';

// server-only はNext.jsのバンドル時だけ意味を持つため、テストでは空にする。
vi.mock('server-only', () => ({}));
