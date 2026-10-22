import type { Satellite } from "../../satellites/entities/Satellite";
import type { Station } from "../../stations/entities/Station";
import type { Pass } from "../entities/Pass";

export interface PredictionTask {
  satellite: Satellite;
  station: Station;
  start: number;
  end: number;
}
export interface PredictionResult {
  passes: Pass[];
  skipped: boolean;
}
