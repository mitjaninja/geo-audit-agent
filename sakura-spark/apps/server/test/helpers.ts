import { DEFAULT_ECONOMY } from '../src/economy.ts';
import type { Economy } from '../src/economy.ts';

/**
 * Экономика без серии побед: в тестах других функций партия собирается без бустеров старта,
 * а серия после победы добавила бы их бесплатно. Сама серия проверяется в events.test.ts.
 */
export const NO_STREAK: Economy = { ...DEFAULT_ECONOMY, events: { ...DEFAULT_ECONOMY.events, winStreak: 0 } };
