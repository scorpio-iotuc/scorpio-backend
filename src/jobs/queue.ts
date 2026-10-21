import { Logger } from "../lib/Logger";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { scheduleKey } from "./schedule";

const logger = new Logger("JobQueue");

export class JobQueue {
  private waiting = new Set<string>();
  constructor(private readonly db: PrismaClient = prisma) {}

  async schedule(now: Date, satelliteTrigger: string, windowHours: number) {
    const queued: { id: string; name: string }[] = [];
    const satelliteKey = scheduleKey(now, satelliteTrigger);
    const passKey = scheduleKey(now, "12:00");
    // Schedule even while another job is running: queued jobs wait for the shared worker.
    if (
      satelliteKey &&
      !(await this.db.satelliteUpsertJob.findUnique({
        where: { schedule_key: satelliteKey },
      }))
    ) {
      try {
        const job = await this.db.satelliteUpsertJob.create({
          data: { schedule_key: satelliteKey, status: "queued" },
        });
        queued.push({ id: job.id, name: "Satellite upsert" });
      } catch (error) {
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ))
          throw error;
      }
    }
    if (passKey) {
      // Unique schedule keys make this safe after restarts and repeated scheduler ticks.
      try {
        const existing = await this.db.stationPassJob.findUnique({
          where: { schedule_key: passKey },
        });
        if (!existing) {
          const job = await this.db.stationPassJob.create({
            data: {
              schedule_key: passKey,
              status: "queued",
              window_hours: windowHours,
            },
          });
          queued.push({ id: job.id, name: "Create Station Passes" });
        }
      } catch (error) {
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ))
          throw error;
      }
    }
    for (const job of queued) logger.info("Job queued", { jobId: job.id, jobType: job.name, status: "queued" });
    return queued;
  }

  async recover(): Promise<number> {
    // Called only after acquiring the shared worker ownership lock.
    const recovered = await this.db.$transaction(async (tx) => {
      const data = {
        status: "failed" as const,
        finished_at: new Date(),
        error_message: "Job interrupted by worker restart.",
      };
      const satellites = await tx.satelliteUpsertJob.updateMany({
        where: { status: "running" },
        data,
      });
      const passes = await tx.stationPassJob.updateMany({
        where: { status: "running" },
        data,
      });
      await tx.stationPassGeneration.deleteMany({
        where: { job: { status: "failed" } },
      });
      return satellites.count + passes.count;
    });
    if (recovered) logger.warn("Interrupted jobs recovered", { failed: recovered });
    return recovered;
  }

  async reportWaiting(active: { id: string; kind: string } | null): Promise<void> {
    if (!active) { this.waiting.clear(); return; }
    // Report the head of each queue only when it or the blocking job changes.
    const satellite = await this.db.satelliteUpsertJob.findFirst({
      where: { status: "queued" }, orderBy: [{ created: "asc" }, { id: "asc" }],
    });
    const pass = await this.db.stationPassJob.findFirst({
      where: { status: "queued" }, orderBy: [{ created_at: "asc" }, { id: "asc" }],
    });
    const current = new Set<string>();
    for (const [kind, job] of [["satellite", satellite], ["passes", pass]] as const) {
      if (!job) continue;
      const key = `${kind}:${job.id}:${active.kind}:${active.id}`;
      current.add(key);
      if (!this.waiting.has(key)) logger.info("Job waiting for running job", {
        jobId: job.id, jobType: kind, status: "queued", runningJobId: active.id, runningJobType: active.kind,
      });
    }
    this.waiting = current;
  }

  async claimNext(now: Date) {
    // The process owns advisory lock (8432, 1). Both job types use this one claim path.
    const next = await this.db.$transaction(async (tx) => {
      if (
        (await tx.satelliteUpsertJob.findFirst({
          where: { status: "running" },
        })) ||
        (await tx.stationPassJob.findFirst({ where: { status: "running" } }))
      )
        return null;
      const satellite = await tx.satelliteUpsertJob.findFirst({
        where: { status: "queued" },
        orderBy: [{ created: "asc" }, { id: "asc" }],
      });
      const pass = await tx.stationPassJob.findFirst({
        where: { status: "queued" },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      });
      // Oldest queued job wins; ties favor refreshing orbital elements first.
      if (satellite && (!pass || satellite.created <= pass.created_at)) {
        const claimed = await tx.satelliteUpsertJob.updateMany({
          where: { id: satellite.id, status: "queued" },
          data: { status: "running", started_at: now },
        });
        return claimed.count
          ? { kind: "satellite" as const, job: satellite }
          : null;
      }
      if (!pass) return null;
      const windowEnd = new Date(now.getTime() + pass.window_hours * 3_600_000);
      const claimed = await tx.stationPassJob.updateMany({
        where: { id: pass.id, status: "queued" },
        data: {
          status: "running",
          started_at: now,
          window_start: now,
          window_end: windowEnd,
        },
      });
      return claimed.count
        ? {
            kind: "passes" as const,
            job: { ...pass, window_start: now, window_end: windowEnd },
          }
        : null;
    });
    if (next) logger.info("Job claimed", { jobId: next.job.id, jobType: next.kind, status: "running" });
    return next;
  }
}
