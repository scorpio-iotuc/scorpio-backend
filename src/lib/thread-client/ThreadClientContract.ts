/** Provider-independent task execution. Payloads/results must be structured-cloneable. */
export interface ThreadClientContract<TTask, TResult> {
  run(task: TTask): Promise<TResult>;
  /** Stop the pool and reject pending tasks. Safe to call repeatedly. */
  destroy(): Promise<void>;
}
