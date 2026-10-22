import { Prisma } from "../../generated/prisma/client";
import type { JobContext, JobInterface, QueuedJob } from "../JobInterface";
import { scheduleKey } from "../schedule";

export class SatelliteUpsertJob implements JobInterface {
  readonly kind = "satellite";
  readonly name = "Satellite upsert";

  constructor(
    private readonly run: (id: string) => Promise<void>,
    private readonly trigger = "00:00",
    private readonly runOnStart = false,
  ) {
    scheduleKey(new Date(), trigger);
  }

  async schedule(db: JobContext, now: Date) {
    const key = scheduleKey(now, this.trigger);
    if (
      !key ||
      (await db.satelliteUpsertJob.findUnique({ where: { schedule_key: key } }))
    )
      return null;
    return this.enqueue(db, key);
  }

  async onStartup(db: JobContext, now: Date) {
    if (!this.runOnStart) return null;
    const latest = await db.satelliteUpsertJob.findFirst({
      orderBy: [{ created: "desc" }, { id: "desc" }],
    });
    if (
      latest?.finished_at &&
      now.getTime() - latest.finished_at.getTime() < 3_600_000
    )
      return null;
    return this.enqueue(db);
  }

  private async enqueue(db: JobContext, key?: string) {
    try {
      return await db.satelliteUpsertJob.create({
        data: { schedule_key: key, status: "queued" },
      });
    } catch (error) {
      // Daily schedule keys and the one-active-upsert index prevent duplicate jobs.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return null;
      throw error;
    }
  }

  async recover(db: JobContext, now: Date): Promise<number> {
    const result = await db.satelliteUpsertJob.updateMany({
      where: { status: "running" },
      data: {
        status: "failed",
        finished_at: now,
        error_message: "Job interrupted by worker restart.",
      },
    });
    return result.count;
  }

  async hasRunning(db: JobContext): Promise<boolean> {
    return !!(await db.satelliteUpsertJob.findFirst({
      where: { status: "running" },
    }));
  }

  async peekQueued(db: JobContext): Promise<QueuedJob | null> {
    const job = await db.satelliteUpsertJob.findFirst({
      where: { status: "queued" },
      orderBy: [{ created: "asc" }, { id: "asc" }],
    });
    return job ? { id: job.id, createdAt: job.created } : null;
  }

  async claim(db: JobContext, id: string, now: Date): Promise<boolean> {
    const result = await db.satelliteUpsertJob.updateMany({
      where: { id, status: "queued" },
      data: { status: "running", started_at: now },
    });
    return result.count > 0;
  }

  async execute(_db: JobContext, id: string): Promise<void> {
    await this.run(id);
  }
}
