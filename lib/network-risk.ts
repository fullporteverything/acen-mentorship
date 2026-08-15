export type NetworkRisk = { blocked: boolean; state: "clear" | "blocked" | "unavailable" | "overridden" };
type Fetcher = typeof fetch;

export async function assessNetworkRisk(ip: string, fetcher: Fetcher = fetch, override?: "allow" | "block"): Promise<NetworkRisk> {
  if (override === "allow") return { blocked: false, state: "overridden" };
  if (override === "block") return { blocked: true, state: "overridden" };
  if (!ip) return { blocked: false, state: "unavailable" };
  try {
    const response = await fetcher(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { blocked: false, state: "unavailable" };
    const data = await response.json() as { status?: string; proxy?: boolean; hosting?: boolean };
    const blocked = data.status === "success" && (data.proxy === true || data.hosting === true);
    return { blocked, state: blocked ? "blocked" : "clear" };
  } catch {
    return { blocked: false, state: "unavailable" };
  }
}
