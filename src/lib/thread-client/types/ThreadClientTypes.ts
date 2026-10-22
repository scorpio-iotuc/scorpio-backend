export type ThreadProvider = "piscina";

/** Library-neutral configuration; provider adapters translate these settings. */
export interface ThreadClientOptions {
  workerFile: string;
  threads: number;
  maxQueuedTasks: number;
  heapLimitMb?: number;
  /** Node runtime arguments, e.g. a loader for TypeScript source workers. */
  execArgv?: string[];
}

/** Consumer options. Pool limits and TS/JS loading have shared defaults in ThreadClient. */
export interface ThreadClientArgs extends Omit<
  ThreadClientOptions,
  "threads" | "maxQueuedTasks"
> {
  threads?: number;
  maxQueuedTasks?: number;
  provider: ThreadProvider;
}
