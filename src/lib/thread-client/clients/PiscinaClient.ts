import Piscina from "piscina";
import type { ThreadClientContract } from "../ThreadClientContract";
import type { ThreadClientOptions } from "../types/ThreadClientTypes";

/** Only this adapter knows Piscina's constructor, configuration and lifecycle API. */
export class PiscinaClient<TTask, TResult> implements ThreadClientContract<
  TTask,
  TResult
> {
  private pool?: Piscina<TTask, TResult>;
  private shutdown?: Promise<void>;
  private readonly options: ThreadClientOptions;

  constructor(options: ThreadClientOptions) {
    this.options = {
      ...options,
      execArgv: options.execArgv ? [...options.execArgv] : [],
    };
  }

  async run(task: TTask): Promise<TResult> {
    if (this.shutdown) throw new Error("Thread client has been destroyed");
    if (!this.pool) {
      this.pool = new Piscina({
        filename: this.options.workerFile,
        execArgv: this.options.execArgv,
        minThreads: this.options.threads,
        maxThreads: this.options.threads,
        concurrentTasksPerWorker: 1,
        maxQueue: this.options.maxQueuedTasks,
        resourceLimits:
          this.options.heapLimitMb === undefined
            ? undefined
            : {
                maxOldGenerationSizeMb: this.options.heapLimitMb,
              },
      });
    }
    return this.pool.run(task);
  }

  destroy(): Promise<void> {
    // Share the shutdown promise so repeated calls also wait for existing cleanup.
    if (!this.shutdown) {
      const pool = this.pool;
      this.pool = undefined;
      this.shutdown = pool ? pool.destroy() : Promise.resolve();
    }
    return this.shutdown;
  }
}
