export interface StationPassJob {
  id: string;
  window_hours: number;
  window_start: Date;
  window_end: Date;
}
export interface StationPassJobRepository {
  progress(id: string, generated: number, skipped: number): Promise<void>;
  complete(id: string): Promise<void>;
  fail(id: string, message: string): Promise<void>;
}
