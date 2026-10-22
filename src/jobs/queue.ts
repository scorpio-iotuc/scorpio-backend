import { Logger } from "../lib/Logger";
import type { PrismaClient } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import type { ClaimedJob, JobInterface, QueuedJob } from "./JobInterface";

const logger = new Logger("JobQueue");

export class JobQueue {
  private waiting = new Set<string>();
  private readonly jobs: readonly JobInterface[];

  constructor(
    jobs: readonly JobInterface[],
    private readonly db: PrismaClient = prisma,
  ) {
    if (new Set(jobs.map((job) => job.kind)).size !== jobs.length) {
      throw new Error("Each registered job must have a unique kind");
    }
    this.jobs = [...jobs];
  }

  async schedule(now: Date) {
    // Schedule even while another job is running: queued jobs wait for the shared worker.
    return this.enqueue(now, false);
  }

  async onStartup(now: Date) {
    return this.enqueue(now, true);
  }

  private async enqueue(now: Date, startup: boolean) {
    const queued: { id: string; name: string }[] = [];
    for (const job of this.jobs) {
      const record = startup
        ? await job.onStartup?.(this.db, now)
        : await job.schedule(this.db, now);
      if (!record) continue;
      queued.push({ id: record.id, name: job.name });
      logger.info(startup ? "Job queued on startup" : "Job queued", {
        jobId: record.id,
        jobType: job.kind,
        status: "queued",
      });
    }
    return queued;
  }

  async recover(now = new Date()): Promise<number> {
    // Called only after acquiring the shared worker ownership lock.
    const recovered = await this.db.$transaction(async (tx) => {
      let count = 0;
      for (const job of this.jobs) count += await job.recover(tx, now);
      return count;
    });
    if (recovered)
      logger.warn("Interrupted jobs recovered", { failed: recovered });
    return recovered;
  }

  async reportWaiting(
    active: { id: string; kind: string } | null,
  ): Promise<void> {
    if (!active) {
      this.waiting.clear();
      return;
    }
    // Report the head of each queue only when it or the blocking job changes.
    const current = new Set<string>();
    for (const job of this.jobs) {
      const candidate = await job.peekQueued(this.db);
      if (!candidate) continue;
      const key = `${job.kind}:${candidate.id}:${active.kind}:${active.id}`;
      current.add(key);
      if (!this.waiting.has(key))
        logger.info("Job waiting for running job", {
          jobId: candidate.id,
          jobType: job.kind,
          status: "queued",
          runningJobId: active.id,
          runningJobType: active.kind,
        });
    }
    this.waiting = current;
  }

  async claimNext(now: Date): Promise<ClaimedJob | null> {
    // The process owns advisory lock (8432, 1). Every registered job uses this claim path.
    const next = await this.db.$transaction(async (tx) => {
      for (const job of this.jobs) {
        if (await job.hasRunning(tx)) return null;
      }
      let oldest: { job: JobInterface; candidate: QueuedJob } | null = null;
      for (const job of this.jobs) {
        const candidate = await job.peekQueued(tx);
        // Oldest queued job wins; registration order breaks ties deterministically.
        if (
          candidate &&
          (!oldest || candidate.createdAt < oldest.candidate.createdAt)
        ) {
          oldest = { job, candidate };
        }
      }
      if (!oldest) return null;
      const { job, candidate } = oldest;
      if (!(await job.claim(tx, candidate.id, now))) return null;
      return { job, id: candidate.id };
    });
    if (!next) return null;
    logger.info("Job claimed", {
      jobId: next.id,
      jobType: next.job.kind,
      status: "running",
    });
    return {
      id: next.id,
      kind: next.job.kind,
      name: next.job.name,
      // Never capture the transaction client: long-running work starts after commit.
      execute: () => next.job.execute(this.db, next.id),
    };
  }
}
