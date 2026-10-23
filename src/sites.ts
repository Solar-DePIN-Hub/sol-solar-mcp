import { randomUUID } from "node:crypto";
import type { KeyValueStore } from "./store.js";

export interface SavedAppliance {
  name: string;
  powerKw: number;
  durationHours: number;
}

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
  /** Appliances the person described once, so a later session can say "the washer" without repeating power and duration. */
  appliances?: SavedAppliance[];
}

const MAX_SITES = 500;
export const MAX_SAVED_APPLIANCES = 8;
/** How long a household is kept in the store after its last change: 90 days. */
export const SITE_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Remembers homes. The session map is per MCP session. Each site is also written to the
 * KeyValueStore under `site:<id>`, so a new MCP session (or a new Lambda instance with
 * TOKEN_STORE=dynamodb) can pick the household up again from its site_id.
 */
export class SiteBook {
  private readonly sites = new Map<string, SolarSite>();
  private readonly bySession = new Map<string, string>();
  private readonly order: string[] = [];

  constructor(private readonly store?: KeyValueStore) {}

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

  /** Look a site up in the shared store when this process has not seen it. */
  async load(siteId: string, sessionId?: string): Promise<SolarSite | undefined> {
    const local = this.sites.get(siteId);
    if (local) {
      if (sessionId) this.bySession.set(sessionId, local.id);
      return local;
    }
    if (!this.store || !/^[0-9a-f-]{36}$/i.test(siteId)) return undefined;
    const raw = await this.store.get(`site:${siteId}`);
    if (!raw) return undefined;
    try {
      const site = JSON.parse(raw) as SolarSite;
      if (site.id !== siteId) return undefined;
      return this.save(site, sessionId);
    } catch {
      return undefined;
    }
  }

  async persist(site: SolarSite): Promise<SolarSite> {
    if (this.store) await this.store.set(`site:${site.id}`, JSON.stringify(site), SITE_TTL_SECONDS);
    return site;
  }

  forgetSession(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}

export function findAppliance(site: SolarSite, name: string): SavedAppliance | undefined {
  const key = name.trim().toLowerCase();
  return site.appliances?.find((item) => item.name.toLowerCase() === key);
}

export function mergeAppliances(current: SavedAppliance[] | undefined, incoming: SavedAppliance[]): SavedAppliance[] {
  const list = [...(current ?? [])];
  for (const item of incoming) {
    const index = list.findIndex((saved) => saved.name.toLowerCase() === item.name.toLowerCase());
    if (index >= 0) list[index] = item;
    else list.push(item);
  }
  return list.slice(-MAX_SAVED_APPLIANCES);
}
