import type {
    ListPassesDTO,
    ListPassesResponseDTO,
} from "../dto/ListPassesDTO";
import type { StationRepository } from "../../stations/repositories/StationRepository";
import type { SatelliteRepository } from "../../satellites/repositories/SatelliteRepository";
import type { PassRepository } from "../repositories/PassRepository";
import { PassesInputError } from "../errors/PassesInputError";

export class ListPasses {
    constructor(
        private readonly stations: StationRepository,
        private readonly satellites: SatelliteRepository,
        private readonly passes: PassRepository,
        private readonly now: () => Date = () => new Date(),
    ) { }

    async execute(query: ListPassesDTO): Promise<ListPassesResponseDTO | null> {
        const station = await this.stations.findByUuid(query.stationUuid);
        if (!station) return null;
        if (
            query.satelliteNoradId !== undefined &&
            !(await this.satellites.findByNoradId(query.satelliteNoradId))
        ) {
            throw new PassesInputError("Satellite not found", 404);
        }
        const generation = await this.passes.findLatestGeneration(station.uuid);
        if (
            !generation ||
            generation.latitude !== station.latitude ||
            generation.longitude !== station.longitude ||
            generation.altitude !== station.altitude
        ) {
            throw new PassesInputError(
                "Station predictions are not available yet",
                503,
            );
        }
        const start = this.now();
        const hours = query.hours ?? 24;
        const end = new Date(start.getTime() + hours * 3_600_000);
        // Never present a partial prediction window as a complete result.
        if (generation.windowStart > start || generation.windowEnd < end) {
            throw new PassesInputError(
                "Requested window exceeds available prediction coverage",
                503,
            );
        }
        return {
            stationUuid: station.uuid,
            windowHours: hours,
            ...await this.passes.findAll({
                page: query.page ?? 1,
                limit: query.limit ?? 20,
                generationId: generation.id,
                stationUuid: station.uuid,
                start,
                end,
                minElevation: query.minElevation ?? 10,
                satelliteNoradId: query.satelliteNoradId,
            }),
        };
    }
}
