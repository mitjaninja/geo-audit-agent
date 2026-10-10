/**
 * Автотест и тюнер в несколько потоков (worker_threads): партия ~40 мс, 200 уровней × 1000 прогонов
 * в один поток — около двух часов. Уровни раздаются потокам по одному; результат — в исходном порядке.
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { LevelDef } from '@sakura/core';
import type { AutotestOptions, LevelReport } from './autotest.ts';
import type { TuneOptions, TuneResult } from './tune.ts';

export type Job =
  | { readonly kind: 'autotest'; readonly level: LevelDef; readonly options: AutotestOptions }
  | { readonly kind: 'tune'; readonly level: LevelDef; readonly options: TuneOptions };

export type JobResult<J extends Job> = J extends { kind: 'autotest' } ? LevelReport : TuneResult;

export const defaultWorkers = () => Math.max(1, availableParallelism());

/** Выполнить задания в workers потоках; onDone — по мере готовности (для прогресса в консоли). */
export async function runJobs<J extends Job>(jobs: readonly J[], workers = defaultWorkers(), onDone?: (i: number, r: JobResult<J>) => void): Promise<JobResult<J>[]> {
  const results = new Array<JobResult<J>>(jobs.length);
  let next = 0;
  const n = Math.min(workers, jobs.length);
  const spawn = () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL('./worker-entry.mjs', import.meta.url));
    const feed = () => {
      if (next >= jobs.length) {
        void w.terminate().then(() => resolve());
        return;
      }
      const i = next++;
      w.once('message', (r: JobResult<J>) => {
        results[i] = r;
        onDone?.(i, r);
        feed();
      });
      w.postMessage(jobs[i]);
    };
    w.once('error', reject);
    feed();
  });
  await Promise.all(Array.from({ length: n }, spawn));
  return results;
}
