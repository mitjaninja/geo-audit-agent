import { parentPort } from 'node:worker_threads';
import { autotestLevel } from './autotest.ts';
import type { Job } from './pool.ts';
import { tuneLevel } from './tune.ts';

parentPort!.on('message', (job: Job) => {
  parentPort!.postMessage(job.kind === 'autotest' ? autotestLevel(job.level, job.options) : tuneLevel(job.level, job.options));
});
