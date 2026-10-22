import { predict } from "./predict";
import { InvalidOrbitError } from "../errors/InvalidOrbitError";
import type { PredictionTask, PredictionResult } from "../dto/PredictionDTO";

// Worker threads perform CPU work only. Database writes belong to the coordinator.
export default async function predictWorker(
  task: PredictionTask,
): Promise<PredictionResult> {
  try {
    return {
      passes: await predict(
        task.satellite,
        task.station,
        task.start,
        task.end,
        0,
      ),
      skipped: false,
    };
  } catch (error) {
    // Packet ingestion can create catalogue entries without orbital elements.
    if (error instanceof InvalidOrbitError)
      return { passes: [], skipped: true };
    throw error;
  }
}
