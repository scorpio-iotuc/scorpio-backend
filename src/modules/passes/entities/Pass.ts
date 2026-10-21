export interface Pass {
  passId: string;
  /** NORAD catalogue number, not the internal database primary key. */
  satelliteId: number;
  satelliteName: string;
  aos: Date;
  los: Date;
  maxElevation: number;
  maxElevationAt: Date;
}
