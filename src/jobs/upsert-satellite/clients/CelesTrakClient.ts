import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import type { UpsertSatelliteDTO } from "../../../modules/satellites/dto/UpsertSatelliteDTO";
import { mapRow, requiredColumns } from "./map-row";

type SaveBatch = (batch: UpsertSatelliteDTO[]) => Promise<unknown>;
export interface CelesTrakClient {
  streamActiveSatellites(
    save: SaveBatch,
    onDownloaded: () => Promise<void>,
  ): Promise<void>;
}

/** Separate helper allows deterministic stream/backpressure tests without HTTP. */
export async function importCsv(
  source: Readable,
  save: SaveBatch,
  onDownloaded: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let count = 0;
  let consumerError: unknown;
  try {
    await pipeline(
      source,
      parse({
        bom: true,
        skip_empty_lines: true,
        max_record_size: 64 * 1024,
        columns: (columns: string[]) => {
          if (
            new Set(columns).size !== columns.length ||
            requiredColumns.some((c) => !columns.includes(c))
          ) {
            throw new Error("Invalid CelesTrak CSV headers");
          }
          return columns;
        },
      }),
      async function consume(rows) {
        try {
          let batch: UpsertSatelliteDTO[] = [];
          // Consume parsed rows incrementally, awaiting each full batch before continuing.
          for await (const row of rows) {
            signal?.throwIfAborted();
            batch.push(mapRow(row));
            count++;
            if (batch.length === 100) {
              // Backpressure is applied by awaiting the save operation,
              // which prevents an unbounded queue of writes and propagates backpressure to the CSV parser.
              await save(batch);
              batch = [];
            }
          }
          signal?.throwIfAborted();
          // EOF reached and all records parsed. A final partial write may still fail.
          if (!count) throw new Error("CelesTrak CSV catalog is empty");
          // Mark the job as downloaded before saving the final batch
          await onDownloaded();
          if (batch.length) await save(batch);
        } catch (error) {
          consumerError = error;
          throw error;
        }
      },
      { signal },
    );
  } catch (error) {
    // Iterator cleanup may emit AbortError; retain the actual validation/DB error.
    throw consumerError ?? error;
  }
}

export class FetchCelesTrakClient implements CelesTrakClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async streamActiveSatellites(
    save: SaveBatch,
    onDownloaded: () => Promise<void>,
  ): Promise<void> {
    // Includes database waits caused by backpressure, not just network time.
    const signal = AbortSignal.timeout(30 * 60_000);
    const response = await this.request(
      "https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=CSV",
      { signal },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`CelesTrak request failed: ${response.status}`);
    }
    await importCsv(
      Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>),
      save,
      onDownloaded,
      signal,
    );
  }
}
