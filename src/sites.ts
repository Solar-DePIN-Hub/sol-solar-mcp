import { randomUUID } from "node:crypto";

export interface SolarSite {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
  systemKw: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  tiltSource: "user" | "pvgis-optimal" | "latitude-fallback";
  pricePerKwh: number | null;
  currency: string | null;
}

const MAX_SITES = 500;

export class SiteBook {
  private readonly sites = new Map<string, SolarSite>();
  private readonly bySession = new Map<string, string>();
  private readonly order: string[] = [];

  save(site: SolarSite, sessionId?: string): SolarSite {
    if (!this.sites.has(site.id)) {
      this.order.push(site.id);
    }
    this.sites.set(site.id, site);
    if (sessionId) this.bySession.set(sessionId, site.id);
    while (this.order.length > MAX_SITES) {
      const oldest = this.order.shift();
      if (oldest) this.sites.delete(oldest);
    }
    return site;
  }

  create(input: Omit<SolarSite, "id">, sessionId?: string): SolarSite {
    return this.save({ ...input, id: randomUUID() }, sessionId);
  }

  resolve(sessionId: string | undefined, siteId?: string): SolarSite | undefined {
    if (siteId) return this.sites.get(siteId);
    if (!sessionId) return undefined;
    const id = this.bySession.get(sessionId);
    return id ? this.sites.get(id) : undefined;
  }

  forgetSession(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
