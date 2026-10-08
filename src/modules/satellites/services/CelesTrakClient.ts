export interface CelesTrakClient {
  downloadActiveSatellites(): Promise<string>;
}

export class FetchCelesTrakClient implements CelesTrakClient {
  private readonly activeSatellitesUrl =
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=JSON';

  async downloadActiveSatellites(): Promise<string> {
    const response = await fetch(this.activeSatellitesUrl, {
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new Error(`Failed to download active satellites from CelesTrak. Status: ${response.status}`);
    }

    return response.text();
  }
}
