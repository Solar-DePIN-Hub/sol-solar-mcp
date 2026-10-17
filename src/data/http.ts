export class UpstreamError extends Error {
  constructor(
    readonly source: string,
    readonly status: number | undefined,
    readonly timedOut: boolean,
  ) {
    super(`${source} request failed`);
    this.name = "UpstreamError";
  }
}

export class SolarError extends Error {
  constructor(readonly spoken: string) {
    super(spoken);
    this.name = "SolarError";
  }
}

const USER_AGENT = "sol-solar-mcp/1.0 (+https://github.com/Solar-DePIN-Hub/sol-solar-mcp)";

export async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  source: string,
): Promise<unknown> {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    const text = await response.text();
    if (!response.ok) throw new UpstreamError(source, response.status, false);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new UpstreamError(source, response.status, false);
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new UpstreamError(source, undefined, timedOut);
  }
}

export function speakUpstream(error: UpstreamError): string {
  if (error.source === "geocoder") {
    return error.timedOut
      ? "The place search took too long. You can pass a latitude and longitude instead. Nothing was invented in its place."
      : "I couldn't search for that place just now. You can pass a latitude and longitude instead.";
  }
  if (error.source === "pvgis") {
    return error.timedOut
      ? "PVGIS took too long to answer. Nothing was invented in its place."
      : "I couldn't reach PVGIS just now. Nothing was invented in its place.";
  }
  return error.timedOut
    ? "The weather service took too long to answer. Nothing was invented in its place. Try again in a minute."
    : "I couldn't reach the weather service just now. Nothing was invented in its place. Try again in a minute.";
}
