import { Prisma } from "../../generated/prisma/client";
import type { StationPassJob } from "../../modules/passes/repositories/StationPassJobRepository";
import type { JobContext, JobInterface, QueuedJob } from "../JobInterface";
import { scheduleKey } from "../schedule";

export class CreateStationPassesJob implements JobInterface {
  readonly kind = "passes";
  readonly name = "Create Station Passes";

  constructor(
    private readonly run: (job: StationPassJob) => Promise<void>,
    private readonly windowHours = 72,
  ) {
    if (
      !Number.isInteger(windowHours) ||
      windowHours < 48 ||
      windowHours > 240
    ) {
      throw new Error(
        "STATION_PASSES_WINDOW_HOURS must be an integer between 48 and 240",
      );
    }
  }

  async schedule(db: JobContext, now: Date) {
    const key = scheduleKey(now, "12:00");
    if (
      !key ||
      (await db.stationPassJob.findUnique({ where: { schedule_key: key } }))
    )
      return null;
    try {
      // Unique schedule keys make this safe after restarts and repeated scheduler ticks.
      return await db.stationPassJob.create({
        data: {
          schedule_key: key,
          status: "queued",
          window_hours: this.windowHours,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return null;
      throw error;
    }
  }

  async recover(db: JobContext, now: Date): Promise<number> {
    const result = await db.stationPassJob.updateMany({
      where: { status: "running" },
      data: {
        status: "failed",
        finished_at: now,
        error_message: "Job interrupted by worker restart.",
      },
    });
    await db.stationPassGeneration.deleteMany({
      where: { job: { status: "failed" } },
    });
    return result.count;
  }

  async hasRunning(db: JobContext): Promise<boolean> {
    return !!(await db.stationPassJob.findFirst({
      where: { status: "running" },
    }));
  }

  async peekQueued(db: JobContext): Promise<QueuedJob | null> {
    const job = await db.stationPassJob.findFirst({
      where: { status: "queued" },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    return job ? { id: job.id, createdAt: job.created_at } : null;
  }

  async claim(db: JobContext, id: string, now: Date): Promise<boolean> {
    const job = await db.stationPassJob.findUnique({ where: { id } });
    if (!job || job.status !== "queued") return false;
    // Waiting in the queue must not consume the prediction window.
    const result = await db.stationPassJob.updateMany({
      where: { id, status: "queued" },
      data: {
        status: "running",
        started_at: now,
        window_start: now,
        window_end: new Date(now.getTime() + job.window_hours * 3_600_000),
      },
    });
    return result.count > 0;
  }

  async execute(db: JobContext, id: string): Promise<void> {
    const job = await db.stationPassJob.findUnique({ where: { id } });
    if (
      !job ||
      job.status !== "running" ||
      !job.window_start ||
      !job.window_end
    ) {
      throw new Error(`Pass job ${id} has no claimed prediction window`);
    }
    await this.run({
      ...job,
      window_start: job.window_start,
      window_end: job.window_end,
    });
  }
}
