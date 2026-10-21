import { randomUUID } from "node:crypto";
import { Logger } from "../../../lib/Logger";
import type { Request, Response } from "express";
import type { SatelliteRepository } from "../../satellites/repositories/SatelliteRepository";
import type { StationRepository } from "../../stations/repositories/StationRepository";
import { ListPasses } from "../use-cases/ListPasses";
import { PassesInputError } from "../errors/PassesInputError";
import type { PassRepository } from "../repositories/PassRepository";
import { GetPassTrajectory } from "../use-cases/GetPassTrajectory";

const logger = new Logger("PassesAPI");

export class PassController {
    private readonly listPasses: ListPasses;
    private readonly getTrajectory: GetPassTrajectory;

    constructor(
        stationRepository: StationRepository,
        satelliteRepository: SatelliteRepository,
        passRepository: PassRepository,
    ) {
        this.listPasses = new ListPasses(
            stationRepository,
            satelliteRepository,
            passRepository,
        );
        this.getTrajectory = new GetPassTrajectory(passRepository);
    }

    public static build(
        stationRepository: StationRepository,
        satelliteRepository: SatelliteRepository,
        passRepository: PassRepository,
    ) {
        return new PassController(
            stationRepository,
            satelliteRepository,
            passRepository,
        );
    }

    list = (req: Request, res: Response): Promise<Response> =>
        this.logRequest("ListPasses", req, res, () => this.listRequest(req, res));

    trajectory = (req: Request, res: Response): Promise<Response> =>
        this.logRequest("GetPassTrajectory", req, res, () => this.trajectoryRequest(req, res));

    private async logRequest(operation: string, req: Request, res: Response, handle: () => Promise<Response>): Promise<Response> {
        const startedAt = Date.now();
        // Log bounded scalar identifiers only, never headers, bodies or orbital/trajectory payloads.
        const scalar = (value: unknown) => typeof value === "string" ? value.slice(0, 128) : undefined;
        const context = {
            requestId: randomUUID(), operation,
            stationUuid: scalar(req.query.stationUuid),
            passId: scalar(req.params?.passId ?? req.query.passId),
            hours: scalar(req.query.hours), minElevation: scalar(req.query.minElevation),
            noradid: scalar(req.query.noradid ?? req.query.satelliteNoradId),
            stepSeconds: scalar(req.query.stepSeconds),
            page: scalar(req.query.page), limit: scalar(req.query.limit),
        };
        logger.info("Request started", context);
        try {
            const response = await handle();
            const details = { ...context, status: res.statusCode, elapsedMs: Date.now() - startedAt };
            if (res.statusCode >= 400) logger.warn("Request rejected", details);
            else logger.info("Request completed", details);
            return response;
        } catch (error) {
            logger.error("Request failed", { ...context, status: 500, elapsedMs: Date.now() - startedAt, error });
            throw error;
        }
    }

    private listRequest = async (req: Request, res: Response): Promise<Response> => {
        const number = (value: unknown): number | undefined => {
            if (value === undefined) return undefined;
            return typeof value === "string" && value.trim() !== ""
                ? Number(value)
                : NaN;
        };
        // Keep the original scaffold's spelling as an alias for the documented query parameter.
        if (
            req.query.noradid !== undefined &&
            req.query.satelliteNoradId !== undefined
        ) {
            return res
                .status(400)
                .json({ message: "Use only one of noradid and satelliteNoradId" });
        }
        const stationUuid = req.query.stationUuid;
        const page = number(req.query.page) ?? 1;
        const limit = number(req.query.limit) ?? 20;
        const hours = number(req.query.hours) ?? 24;
        const minElevation = number(req.query.minElevation) ?? 10;
        const satelliteNoradId = number(
            req.query.noradid ?? req.query.satelliteNoradId,
        );

        if (typeof stationUuid !== "string" || !stationUuid.trim()) {
            return res.status(400).json({ message: "stationUuid is required" });
        }
        if (!Number.isSafeInteger(page) || page < 1) {
            return res.status(400).json({ message: "page must be a positive integer" });
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ message: "limit must be an integer between 1 and 100" });
        }
        if ((page - 1) * limit > 2147483647) {
            return res.status(400).json({ message: "Requested page offset is too large" });
        }
        if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
            return res
                .status(400)
                .json({ message: "hours must be greater than 0 and at most 168" });
        }
        if (
            !Number.isFinite(minElevation) ||
            minElevation < 0 ||
            minElevation > 90
        ) {
            return res
                .status(400)
                .json({ message: "minElevation must be between 0 and 90 degrees" });
        }
        if (
            satelliteNoradId !== undefined &&
            (!Number.isSafeInteger(satelliteNoradId) ||
                satelliteNoradId <= 0 ||
                satelliteNoradId > 2147483647)
        ) {
            return res
                .status(400)
                .json({ message: "noradid must be a positive 32-bit integer" });
        }

        try {
            const result = await this.listPasses.execute({
                stationUuid,
                page,
                limit,
                hours,
                minElevation,
                satelliteNoradId,
            });
            if (!result)
                return res.status(404).json({ message: "Station not found" });
            return res.status(200).json(result);
        } catch (error) {
            if (error instanceof PassesInputError) {
                return res.status(error.status).json({ message: error.message });
            }
            throw error; // Express 5 forwards rejected handlers to the shared error middleware.
        }
    };
    private trajectoryRequest = async (req: Request, res: Response): Promise<Response> => {
        const passId = req.params.passId ?? req.query.passId;
        const stationUuid = req.query.stationUuid;
        const rawStep = req.query.stepSeconds;
        const stepSeconds =
            rawStep === undefined
                ? 10
                : typeof rawStep === "string" && rawStep.trim() !== ""
                    ? Number(rawStep)
                    : NaN;
        if (typeof passId !== "string" || !passId.trim()) {
            return res.status(400).json({ message: "passId is required" });
        }
        if (
            stationUuid !== undefined &&
            (typeof stationUuid !== "string" || !stationUuid.trim())
        ) {
            return res.status(400).json({ message: "Invalid stationUuid" });
        }
        if (
            !Number.isInteger(stepSeconds) ||
            stepSeconds < 1 ||
            stepSeconds > 300
        ) {
            return res
                .status(400)
                .json({ message: "stepSeconds must be an integer between 1 and 300" });
        }
        try {
            const result = await this.getTrajectory.execute(
                passId,
                stepSeconds,
                stationUuid,
            );
            if (!result) return res.status(404).json({ message: "Pass not found" });
            return res.status(200).json(result);
        } catch (error) {
            if (error instanceof PassesInputError)
                return res.status(error.status).json({ message: error.message });
            throw error;
        }
    };
}
