import { lookup } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { registrable } from "../identity/graph.ts";
import { flat } from "../identity/names.ts";
import type { CacheEntry } from "./cache.ts";

/**
 * First-party brand asset fetch: ONE request path to a company's OWN public website, to find the best logo it publishes. Privacy contract:
 *  - the only thing contacted is the company's own registrable domain (apex or www, and assets on the same registrable domain); nothing about the
 *    user, any role, message, thread or account is sent: a plain anonymous GET with a fixed generic user agent and no cookies or referrer;
 *  - the host must resolve to a public address (no localhost, private, link-local or metadata ranges), every redirect is re-checked, cross-domain
 *    redirects and cross-domain assets are refused;
 *  - responses are size- and time-bounded; only images are stored; SVG is accepted only if it is inert (no script, no external references).
 * Quality contract: prefer a real brand asset to a favicon. Accepted, in order: an SVG icon, a web-app-manifest icon >= 192 px, an apple-touch-icon
 * >= 120 px, a PNG icon >= 96 px. Anything smaller (a 16-48 px favicon) is rejected: the monogram is better than a blurry mark.
 * For a domain that was only inferred from a sender, the homepage must name the company (title, site name or visible heading) before any asset is used.
 * The fetched asset never feeds back into identity: it is stored against an already-resolved company and domain, nothing more.
 */
const UA = "OpportunityInbox-BrandCache/1.0 (anonymous; fetches this site's public icon once)";
const MAX_HTML = 1_500_000;
const MAX_ASSET = 400_000;
const TIMEOUT_MS = 8000;

export type Fetched = { entry: CacheEntry; data?: Buffer | string; file?: string };

const BLOCKED = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) BLOCKED.addSubnet(net, prefix, "ipv6");

/** Not a globally routable unicast address. IPv4-mapped/compatible IPv6 forms are normalized to their embedded IPv4 and judged by the IPv4 rules. */
export function privateIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) return privateIp(dotted[1]);
  const hex = /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return privateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")); }
  const kind = isIP(v);
  if (!kind) return true;
  return BLOCKED.check(v, kind === 4 ? "ipv4" : "ipv6");
}

/** DNS lookup used for the actual connection: the address that is connected to is the address that was checked (no rebinding window). */
const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }).then(
    (addrs) => {
      const ok = addrs.filter((a) => !privateIp(a.address));
      if (addrs.length === 0 || ok.length !== addrs.length) return callback(new Error("refused: non-public address") as NodeJS.ErrnoException, "", 4);
      if (options && (options as { all?: boolean }).all) return (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, ok);
      callback(null, ok[0].address, ok[0].family);
    },
    (e) => callback(e, "", 4),
  );
};

function hostLooksValid(host: string): boolean {
  if (isIP(host)) return !privateIp(host);
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
}

/** GET over HTTPS with the connection pinned to a validated public address, manual redirects (same registrable domain only), a size cap and a time limit. */
async function get(url: string, domain: string, maxBytes: number, accept: string, truncate = false, hops = 4): Promise<{ body: Buffer; type: string; url: string } | null> {
  for (let i = 0; i <= hops; i++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || registrable(u.hostname) !== domain || !hostLooksValid(u.hostname)) {
      if (process.env.BRAND_DEBUG) console.error("refused", u.hostname, u.protocol);
      return null;
    }
    const res = await new Promise<{ status: number; location: string | null; type: string; body: Buffer } | null>((resolve) => {
      const chunks: Buffer[] = [];
      let n = 0, done = false;
      const finish = (v: { status: number; location: string | null; type: string; body: Buffer } | null) => { if (!done) { done = true; resolve(v); } };
      const req = https.request(u, { method: "GET", lookup: pinnedLookup, headers: { "user-agent": UA, accept }, timeout: TIMEOUT_MS, agent: false }, (r) => {
        const status = r.statusCode ?? 0;
        const location = typeof r.headers.location === "string" ? r.headers.location : null;
        const type = String(r.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) { r.resume(); return finish({ status, location, type, body: Buffer.alloc(0) }); }
        if (status < 200 || status >= 300) { r.resume(); return finish(null); }
        r.on("data", (c: Buffer) => {
          n += c.length;
          if (n > maxBytes) {
            if (!truncate) { req.destroy(); return finish(null); }
            chunks.push(c); // a page is read only as far as its <head>, where icons are declared
            req.destroy();
            return finish({ status, location: null, type, body: Buffer.concat(chunks) });
          }
          chunks.push(c);
        });
        r.on("end", () => finish({ status, location: null, type, body: Buffer.concat(chunks) }));
        r.on("error", () => finish(null));
      });
      req.on("timeout", () => { req.destroy(); finish(null); });
      req.on("error", (e) => { if (process.env.BRAND_DEBUG) console.error("fetch error", u.hostname, (e as Error).message); finish(null); });
      req.end();
    });
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return null;
      url = new URL(res.location, u).toString();
      continue;
    }
    return { body: res.body, type: res.type, url: u.toString() };
  }
  return null;
}

type Link = { href: string; sizes: number; type: string; rel: string };
function iconLinks(html: string, base: string): Link[] {
  const out: Link[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || !/icon|manifest/.test(rel)) continue;
    const size = /sizes=["'](\d+)x\d+/i.exec(tag)?.[1];
    try { out.push({ href: new URL(href, base).toString(), sizes: size ? Number(size) : 0, type: /type=["']([^"']+)/i.exec(tag)?.[1] ?? "", rel }); } catch { /* bad URL: skip */ }
  }
  return out;
}

function pngSize(b: Buffer): { w: number; h: number } | null {
  return b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(12) === 0x49484452 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
}

/** An SVG is stored only if it cannot do anything: no script, no event handlers, no external references, no foreign objects. */
export function inertSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text) && text.length <= MAX_ASSET && !/<script|on\w+\s*=|<foreignObject|<iframe|<!ENTITY|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|javascript:)|url\(\s*["']?\s*(?:https?:|\/\/)/i.test(text);
}

/**
 * Many SVG favicons carry an `@media (prefers-color-scheme: dark)` block (a white mark for dark tabs). Our tile is a fixed light surface in both themes, so
 * that block would turn the mark white-on-white. Remove those blocks (balanced braces) and keep the default, light-surface styling.
 */
export function lightOnlySvg(svg: string): string {
  let out = svg, at: number;
  const re = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/i;
  while ((at = out.search(re)) >= 0) {
    const open = out.indexOf("{", at);
    let depth = 0, i = open;
    for (; i < out.length; i++) { if (out[i] === "{") depth++; else if (out[i] === "}" && --depth === 0) break; }
    out = out.slice(0, at) + out.slice(i + 1);
  }
  return out;
}

const text = (html: string, re: RegExp) => re.exec(html)?.[1] ?? "";
/** Does the homepage name this company? (page title, site name, or first heading) */
export function pageNamesCompany(html: string, companyKeys: string[]): boolean {
  const hay = flat([text(html, /<title[^>]*>([^<]*)</i), text(html, /property=["']og:site_name["'][^>]*content=["']([^"']*)/i), text(html, /content=["']([^"']*)["'][^>]*property=["']og:site_name/i), text(html, /name=["']application-name["'][^>]*content=["']([^"']*)/i), text(html, /<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i).replace(/<[^>]+>/g, "")].join(" "));
  return companyKeys.some((k) => k.length >= 3 && hay.includes(k));
}

export async function fetchFirstParty(domain: string, opts: { source: "learned" | "graph" | "sender"; companyKeys: string[]; needsPageCheck: boolean }): Promise<Fetched> {
  const at = new Date().toISOString();
  const none = (reason: string): Fetched => ({ entry: { status: "none", reason, source: opts.source, at } });
  if (registrable(domain) !== domain) return none("not a registrable domain");
  const page = (await get(`https://${domain}/`, domain, MAX_HTML, "text/html", true)) ?? (await get(`https://www.${domain}/`, domain, MAX_HTML, "text/html", true));
  if (!page) return none("homepage unreachable");
  const html = page.body.toString("utf8");
  if (opts.needsPageCheck && !pageNamesCompany(html, opts.companyKeys)) return none("homepage does not name the company");

  const links = iconLinks(html, page.url);
  const candidates: Array<{ href: string; from: "svg" | "manifest" | "apple-touch-icon" | "icon"; rank: number }> = [];
  for (const l of links) {
    const isSvg = /svg/.test(l.type) || l.href.split("?")[0].toLowerCase().endsWith(".svg");
    if (/mask-icon/.test(l.rel)) continue; // a one-colour silhouette, not the brand mark
    if (isSvg && /icon/.test(l.rel)) candidates.push({ href: l.href, from: "svg", rank: 0 });
    else if (/apple-touch-icon/.test(l.rel)) candidates.push({ href: l.href, from: "apple-touch-icon", rank: 2 });
    else if (/icon/.test(l.rel) && !/\.ico(\?|$)/i.test(l.href) && l.sizes >= 96) candidates.push({ href: l.href, from: "icon", rank: 3 });
  }
  const manifest = links.find((l) => /manifest/.test(l.rel));
  if (manifest) {
    const m = await get(manifest.href, domain, 200_000, "application/json");
    try {
      const icons = (JSON.parse(m?.body.toString("utf8") ?? "{}").icons ?? []) as Array<{ src?: string; sizes?: string; type?: string }>;
      for (const ic of icons) {
        const size = Number(/(\d+)x/.exec(ic.sizes ?? "")?.[1] ?? 0);
        if (ic.src && size >= 192 && (ic.type ?? "image/png").includes("png")) candidates.push({ href: new URL(ic.src, manifest.href).toString(), from: "manifest", rank: 1 });
      }
    } catch { /* no usable manifest */ }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  for (const c of candidates.slice(0, 5)) {
    const res = await get(c.href, domain, MAX_ASSET, "image/*");
    if (!res) continue;
    if (c.from === "svg") {
      const svg = res.body.toString("utf8");
      if (!inertSvg(svg)) continue;
      return { entry: { status: "ok", file: `${domain}.svg`, kind: "svg", width: null, height: null, from: "svg", source: opts.source, at }, data: lightOnlySvg(svg), file: `${domain}.svg` };
    }
    const dims = pngSize(res.body);
    const min = c.from === "manifest" ? 192 : c.from === "apple-touch-icon" ? 120 : 96;
    if (!dims || dims.w < min || dims.h < min || dims.w > 2048 || Math.abs(dims.w - dims.h) > Math.max(8, dims.w * 0.15)) continue; // too small, huge, or not a square mark
    return { entry: { status: "ok", file: `${domain}.png`, kind: "png", width: dims.w, height: dims.h, from: c.from, source: opts.source, at }, data: res.body, file: `${domain}.png` };
  }
  return none(candidates.length === 0 ? "no logo-quality icon published (favicon only)" : "published icons too small or unusable");
}
