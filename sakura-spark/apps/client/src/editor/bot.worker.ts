// Бот-тест уровня в фоне: казуальный бот, как у тюнера и автотеста.
import { parseLevel } from '@sakura/core';
import { autotestLevel } from '../../../../packages/sim/src/autotest.ts';

self.onmessage = (e: MessageEvent<{ raw: unknown; runs: number }>) => {
  const level = parseLevel(e.data.raw);
  self.postMessage(autotestLevel(level, { runs: e.data.runs, bot: 'casual', seedBase: 90_000 }));
};
