import type { Prisma } from "../generated/prisma/client";

/** Both the Prisma client and a transaction expose the persistence used by jobs. */
export type JobContext = Prisma.TransactionClient;

export interface QueuedJob {
  id: string;
  createdAt: Date;
}

/** The queue coordinates lifecycle operations; each job owns its data and rules. */
export interface JobInterface {
  readonly kind: string;
  readonly name: string;
  /** Return a queued job if one should be scheduled now, or null if not. */
  schedule(db: JobContext, now: Date): Promise<{ id: string } | null>;
  /** Return the number of jobs that were recovered and re-queued. */
  onStartup?(db: JobContext, now: Date): Promise<{ id: string } | null>;
  /** Return the number of jobs that were recovered and re-queued. */
  recover(db: JobContext, now: Date): Promise<number>;
  /** Return true if a job of this kind is currently running. */
  hasRunning(db: JobContext): Promise<boolean>;
  /** Return the next queued job of this kind, or null if none. */
  peekQueued(db: JobContext): Promise<QueuedJob | null>;
  /** Atomically transition queued -> running, initializing any execution metadata. */
  claim(db: JobContext, id: string, now: Date): Promise<boolean>;
  /** Persist completion/failure before resolving. Runs outside the claim transaction. */
  execute(db: JobContext, id: string): Promise<void>;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  name: string;
  execute(): Promise<void>;
}
