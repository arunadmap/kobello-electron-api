// Looks at a URL before it's installed: a Kobello app (it serves /kobello.json) or a plain website.
// `fetchUrl` is passed in (Electron's net.fetch in the app, a fake in tests).

import type { AppManifest, InspectResult, Permission } from '@kobello/sdk/protocol';
import { fail } from './common';

export type FetchUrl = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const PERMISSIONS: Permission[] = ['storage', 'files', 'notifications', 'links'];
const APP_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const TIMEOUT_MS = 10_000;

/**
 * Checks a URL can be an app: https only, plus http://localhost and 127.0.0.1 in developer mode.
 * Returns the parsed URL without its #hash.
 */
export function checkAppUrl(value: unknown, devMode: boolean): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return fail('INVALID_ARGUMENT', `Not a valid URL: "${value}"`);
  }
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !(devMode && local)) {
    fail('INVALID_ARGUMENT', devMode ? 'Use an https:// link, or http://localhost.' : 'Use an https:// link.');
  }
  url.hash = '';
  return url;
}

function isSameOrigin(value: unknown, origin: string): boolean {
  try {
    return typeof value === 'string' && new URL(value, origin).origin === origin;
  } catch {
    return false;
  }
}

/** Validates a kobello.json file. Throws INVALID_ARGUMENT naming the first problem. */
export function parseManifest(json: unknown, origin: string): AppManifest {
  const m = (json ?? {}) as Record<string, unknown>;
  const problem = (message: string) => fail('INVALID_ARGUMENT', `kobello.json: ${message}`);

  if (m.kobello !== 1) problem('"kobello" must be 1.');
  if (typeof m.id !== 'string' || !APP_ID.test(m.id)) problem('"id" must look like "com.example.notes".');
  if (m.id === 'kobello.shell') problem('"id" is reserved.');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) problem('"name" must be 1–80 characters.');
  if (typeof m.version !== 'string' || !m.version) problem('"version" is required.');
  if (!Array.isArray(m.permissions) || m.permissions.some((p) => !PERMISSIONS.includes(p))) {
    problem(`"permissions" may only contain ${PERMISSIONS.join(', ')}.`);
  }
  if (m.start_url !== undefined && !isSameOrigin(m.start_url, origin)) problem('"start_url" must be on the same site.');
  if (m.icon !== undefined && typeof m.icon !== 'string') problem('"icon" must be a string.');
  return m as unknown as AppManifest;
}

/** Fetches with a timeout. Turns network failures into NETWORK_ERROR. */
async function get(fetchUrl: FetchUrl, url: string): Promise<Response> {
  try {
    return await fetchUrl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return fail('NETWORK_ERROR', `Couldn't reach ${new URL(url).host}. Check your internet connection.`);
  }
}

export async function inspectUrl(value: unknown, fetchUrl: FetchUrl, devMode: boolean): Promise<InspectResult> {
  const url = checkAppUrl(value, devMode);

  // A Kobello app serves /kobello.json from its origin.
  const manifestResponse = await get(fetchUrl, `${url.origin}/kobello.json`);
  if (manifestResponse.ok) {
    let json: unknown;
    try {
      json = await manifestResponse.json();
    } catch {
      json = undefined; // not JSON: treat the site as a plain website
    }
    if (json !== undefined) {
      const manifest = parseManifest(json, url.origin);
      return {
        kind: 'kobello-app',
        url: new URL(manifest.start_url ?? '/', url.origin).toString(),
        manifest,
        iconUrl: manifest.icon ? new URL(manifest.icon, url.origin).toString() : undefined,
      };
    }
  }

  // Otherwise it's a website: read its name and icon from the page and its web app manifest.
  const page = await get(fetchUrl, url.toString());
  const html = page.ok ? (await page.text()).slice(0, 500_000) : '';
  const info = await readWebsiteInfo(html, url, fetchUrl);
  return { kind: 'website', url: url.toString(), ...info };
}

/** Finds a website's name and icon: its web app manifest first, then the HTML, then /favicon.ico. */
async function readWebsiteInfo(html: string, pageUrl: URL, fetchUrl: FetchUrl): Promise<{ name?: string; iconUrl?: string }> {
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const linkWithRel = (rel: RegExp) => links.find((tag) => rel.test(attr(tag, 'rel') ?? ''));
  const absolute = (href: string | undefined, base: string | URL) => (href ? new URL(href, base).toString() : undefined);

  let name = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || undefined;
  let iconUrl = absolute(attr(linkWithRel(/apple-touch-icon/i) ?? linkWithRel(/\bicon\b/i) ?? '', 'href'), pageUrl);

  const manifestHref = absolute(attr(linkWithRel(/\bmanifest\b/i) ?? '', 'href'), pageUrl);
  if (manifestHref) {
    try {
      const manifest = await (await get(fetchUrl, manifestHref)).json();
      name = manifest.name || manifest.short_name || name;
      // Pick the largest icon the manifest lists.
      const icons: { src?: string; sizes?: string }[] = Array.isArray(manifest.icons) ? manifest.icons : [];
      const size = (icon: { sizes?: string }) => parseInt(icon.sizes ?? '0', 10) || 0;
      const best = [...icons].filter((icon) => icon.src).sort((a, b) => size(b) - size(a))[0];
      if (best?.src) iconUrl = new URL(best.src, manifestHref).toString();
    } catch {
      // A broken manifest isn't fatal: keep what the HTML gave us.
    }
  }

  return { name: name?.slice(0, 80) || pageUrl.hostname, iconUrl: iconUrl ?? `${pageUrl.origin}/favicon.ico` };
}
