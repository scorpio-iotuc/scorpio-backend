export interface ListSatellitesDTO {
  /** Internal cursor pagination for workers; regular HTTP listings still use page. */
  afterId?: number;
  page?: number;
  limit?: number;
  noradId?: number;
  displayName?: string;
}
