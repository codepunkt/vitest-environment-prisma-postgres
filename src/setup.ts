/* v8 ignore file */
import { afterEach, beforeEach } from 'vitest';

beforeEach(globalThis.prismaPostgresTestContext.beginTestTransaction);
afterEach(globalThis.prismaPostgresTestContext.endTestTransaction);
