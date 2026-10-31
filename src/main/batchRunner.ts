import { randomUUID } from 'node:crypto';
import type { ScanJobState } from '@shared/types';
import type { ScanRunner, RunJobInput } from './scanRunner';

/**
 * Runs multiple scan jobs with bounded concurrency. Shared options are applied
 * to every folder; per-folder overrides are merged in.
 */
export class BatchRunner {
  private running = false;
  private jobs: ScanJobState[] = [];

  constructor(
    private readonly scanRunner: ScanRunner,
    private readonly onJobsUpdated: (jobs: ScanJobState[]) => void,
    private readonly onPrepared: (jobs: ScanJobState[]) => void = () => undefined
  ) {}

  async runAll(inputs: RunJobInput[], concurrency: number): Promise<ScanJobState[]> {
    return this.startAll(inputs, concurrency).completion;
  }

  startAll(inputs: RunJobInput[], concurrency: number): { jobs: ScanJobState[]; completion: Promise<ScanJobState[]> } {
    if (this.running) throw new Error('A batch is already running.');
    this.running = true;
    const batchId = randomUUID();
    this.jobs = inputs.map((i) => Object.assign(this.scanRunner.newJob(i), { batchId }));
    try {
      this.onPrepared([...this.jobs]);
      this.onJobsUpdated([...this.jobs]);
    } catch (error) { this.running = false; throw error; }
    return { jobs: [...this.jobs], completion: this.execute(concurrency) };
  }

  private async execute(concurrency: number): Promise<ScanJobState[]> {
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(8, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1, this.jobs.length)) }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= this.jobs.length) return;
        await this.scanRunner.run(this.jobs[idx]);
        this.onJobsUpdated([...this.jobs]);
      }
    });
    try { await Promise.all(workers); } finally { this.running = false; }
    this.onJobsUpdated([...this.jobs]);
    return this.jobs;
  }

  isRunning(): boolean { return this.running; }

  getJobs(): ScanJobState[] {
    return this.jobs;
  }

  async cancelAll(): Promise<void> {
    await Promise.all(
      this.jobs
        .filter((j) => !j.finishedAt)
        .map((j) => this.scanRunner.cancelJob(j))
    );
  }
}
