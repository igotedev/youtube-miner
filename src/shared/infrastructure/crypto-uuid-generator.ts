import { randomUUID } from 'node:crypto';

import type { UuidGenerator } from '@/shared/domain';

/** Unica implementacao autorizada a gerar identificadores. Ver shared/domain/uuid-generator.ts. */
export const cryptoUuidGenerator: UuidGenerator = {
  next: () => randomUUID(),
};
