import path from "node:path";
import { PiscinaClient } from "./clients/PiscinaClient";
import type { ThreadClientContract } from "./ThreadClientContract";
import type {
  ThreadClientArgs,
  ThreadClientOptions,
  ThreadProvider,
} from "./types/ThreadClientTypes";

// Register new adapters here; consumers only depend on ThreadClientContract.
type ThreadClientConstructor = new <TTask, TResult>(
  options: ThreadClientOptions,
) => ThreadClientContract<TTask, TResult>;
const providers: Record<ThreadProvider, ThreadClientConstructor> = {
  piscina: PiscinaClient,
};

const DEFAULT_THREADS_COUNT = 4;
const DEFAULT_MAX_QUEUED_TASKS = 100;
const DEFAULT_HEAP_LIMIT_MB = 128;

export class ThreadClient<TTask, TResult> implements ThreadClientContract<
  TTask,
  TResult
> {
  private readonly client: ThreadClientContract<TTask, TResult>;

  constructor(args: ThreadClientArgs) {
    const Provider = Object.prototype.hasOwnProperty.call(
      providers,
      args.provider,
    )
      ? providers[args.provider]
      : undefined;
    if (!Provider)
      throw new Error(`Unsupported thread provider: ${args.provider}`);
    if (typeof args.workerFile !== "string" || !args.workerFile.trim()) {
      throw new Error("Invalid thread client configuration");
    }
    // Extensionless paths follow the running application: TS locally, compiled JS in Docker.
    const workerFile = path.extname(args.workerFile)
      ? args.workerFile
      : `${args.workerFile}.${__filename.endsWith(".ts") ? "ts" : "js"}`;
    const options: ThreadClientOptions = {
      workerFile,
      threads: args.threads ?? DEFAULT_THREADS_COUNT,
      maxQueuedTasks: args.maxQueuedTasks ?? DEFAULT_MAX_QUEUED_TASKS,
      heapLimitMb: args.heapLimitMb ?? DEFAULT_HEAP_LIMIT_MB,
      // Compiled workers do not load ts-node, which is absent from production dependencies.
      execArgv:
        args.execArgv ??
        (workerFile.endsWith(".ts")
          ? ["-r", require.resolve("ts-node/register/transpile-only")]
          : []),
    };
    if (
      !Number.isInteger(options.threads) ||
      options.threads < 1 ||
      !Number.isInteger(options.maxQueuedTasks) ||
      options.maxQueuedTasks < 0 ||
      !Number.isInteger(options.heapLimitMb) ||
      options.heapLimitMb! < 1
    ) {
      throw new Error("Invalid thread client configuration");
    }
    this.client = new Provider<TTask, TResult>(options);
  }

  run(task: TTask): Promise<TResult> {
    return this.client.run(task);
  }
  destroy(): Promise<void> {
    return this.client.destroy();
  }
}
