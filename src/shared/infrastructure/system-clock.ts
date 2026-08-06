import type { Clock } from '@/shared/domain';

/** Unica implementacao que pode chamar `new Date()`. Ver shared/domain/clock.ts. */
export const systemClock: Clock = {
  now: () => new Date(),
};
