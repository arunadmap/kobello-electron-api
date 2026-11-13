// Looks at a URL before it's installed: a Kobello app (it serves /kobello.json) or a plain website.
//
// `fetchUrl` is passed in (Electron's network stack in the app, a fake in tests). It must not follow
// redirects itself: it returns the 3xx response, and this module follows it one hop at a time, so a
// site can't send the host to an address the user couldn't have typed.

import type { AppManifest, InspectResult, Permission } from '@kobello-electron/sdk/protocol';
import { fail, PERMISSIONS, SHELL_APP_ID } from './common';
import { isReservedName } from './files';

export type FetchUrl = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

const APP_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 2048;

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

/** Resolves a link found in a page or a redirect. Undefined unless it could itself be an app URL. */
function allowedUrl(value: unknown, base: URL | string, devMode: boolean): URL | undefined {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_LENGTH) return undefined;
  try {
    return checkAppUrl(new URL(value, base), devMode);
  } catch {
    return undefined;
  }
}

/** An icon Kobello UI may show: a link that passes checkAppUrl, or an inline data:image. Otherwise undefined. */
function iconUrl(value: unknown, base: URL | string, devMode: boolean): string | undefined {
  if (typeof value === 'string' && /^data:image\//i.test(value) && value.length <= MAX_URL_LENGTH) return value;
  return allowedUrl(value, base, devMode)?.toString();
}

function isSameOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value, origin).origin === origin;
  } catch {
    return false;
  }
}

function problem(message: string): never {
  return fail('INVALID_ARGUMENT', `kobello.json: ${message}`);
}

/**
 * Validates a kobello.json file and returns a clean copy with only the fields Kobello knows.
 * Throws INVALID_ARGUMENT naming the first problem.
 */
export function parseManifest(json: unknown, origin: string): AppManifest {
  const m = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const { id, name, version, permissions } = m;

  if (m.kobello !== 1) problem('"kobello" must be 1.');
  // The ID names the app's data folder, so it can't be a name Windows reserves ("con.example").
  if (typeof id !== 'string' || id.length > 100 || !APP_ID.test(id) || isReservedName(id)) problem('"id" must look like "com.example.notes".');
  if (id === SHELL_APP_ID) problem('"id" is reserved.');
  if (typeof name !== 'string' || !name.trim() || name.length > 80) problem('"name" must be 1–80 characters.');
  if (typeof version !== 'string' || !version || version.length > 50) problem('"version" must be 1–50 characters.');
  if (!Array.isArray(permissions) || permissions.some((p) => !PERMISSIONS.includes(p))) {
    problem(`"permissions" may only contain ${PERMISSIONS.join(', ')}.`);
  }

  const manifest: AppManifest = { kobello: 1, id, name: name.trim(), version, permissions: [...new Set<Permission>(permissions)] };
  for (const [key, maxLength] of [['description', 300], ['start_url', MAX_URL_LENGTH], ['icon', MAX_URL_LENGTH]] as const) {
    const value = m[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > maxLength) problem(`"${key}" must be text of at most ${maxLength} characters.`);
    manifest[key] = value;
  }
  if (manifest.start_url !== undefined && !isSameOrigin(manifest.start_url, origin)) problem('"start_url" must be on the same site.');
  return manifest;
}

interface Download {
  /** Where the content came from, after redirects. */
  url: URL;
  ok: boolean;
  /** The body as text, cut off at the size limit. */
  text: string;
  /** False when the body was longer than the limit. */
  complete: boolean;
}

/**
 * Downloads a URL as text, reading at most `maxBytes` of it.
 * Redirects are followed by hand, at most 5, and every hop must pass checkAppUrl like a link the
 * user typed (with `sameOrigin`, it must also stay on the first URL's origin).
 * Returns null when a redirect is refused; throws NETWORK_ERROR when the site can't be reached.
 */
async function download(fetchUrl: FetchUrl, start: URL, devMode: boolean, maxBytes: number, sameOrigin = false): Promise<Download | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetchUrl(url.toString(), { signal });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (location === null && response.ok) return { url, ok: true, ...(await readText(response, maxBytes)) };
      // Not content we'll read (an error page or a redirect): stop the download.
      response.body?.cancel().catch((): void => undefined);
      if (location === null) return { url, ok: false, text: '', complete: true };
      const next = allowedUrl(location, url, devMode);
      if (!next || (sameOrigin && next.origin !== start.origin)) return null;
      url = next;
    }
    return null; // too many redirects
  } catch {
    return fail('NETWORK_ERROR', `Couldn't reach ${url.host}. Check your internet connection.`);
  }
}

/** Reads a body up to `maxBytes`, then stops the download instead of loading the rest into memory. */
async function readText(response: Response, maxBytes: number): Promise<{ text: string; complete: boolean }> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader && size <= maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size > maxBytes) reader?.cancel().catch((): void => undefined);
  return { text: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'), complete: size <= maxBytes };
}

/** Parses a downloaded JSON file. Undefined if it's missing, cut off or not JSON. */
function parseJson(file: Download | null): unknown {
  if (!file?.ok || !file.complete) return undefined;
  try {
    return JSON.parse(file.text);
  } catch {
    return undefined;
  }
}

export async function inspectUrl(value: unknown, fetchUrl: FetchUrl, devMode: boolean): Promise<InspectResult> {
  const url = checkAppUrl(value, devMode);

  // A Kobello app serves /kobello.json from its own origin. A copy that another site answers for
  // (a cross-origin redirect) doesn't count: that site could claim any origin as its app.
  const json = parseJson(await download(fetchUrl, new URL('/kobello.json', url.origin), devMode, MAX_JSON_BYTES, true));
  if (json !== undefined) {
    const manifest = parseManifest(json, url.origin);
    return {
      kind: 'kobello-app',
      url: new URL(manifest.start_url ?? '/', url.origin).toString(),
      manifest,
      iconUrl: iconUrl(manifest.icon, url.origin, devMode),
    };
  }

  // Otherwise it's a website: read its name and icon from the page and its web app manifest.
  const page = await download(fetchUrl, url, devMode, MAX_HTML_BYTES);
  const info = await readWebsiteInfo(page?.text ?? '', page?.url ?? url, fetchUrl, devMode);
  return { kind: 'website', url: url.toString(), ...info };
}

/** Finds a website's name and icon: its web app manifest first, then the HTML, then /favicon.ico. */
async function readWebsiteInfo(html: string, pageUrl: URL, fetchUrl: FetchUrl, devMode: boolean): Promise<{ name?: string; iconUrl?: string }> {
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const hrefs = (rel: RegExp) => links.filter((tag) => rel.test(attr(tag, 'rel') ?? '')).map((tag) => attr(tag, 'href'));
  const text = (value: unknown) => (typeof value === 'string' && value.trim()) || undefined;

  let name = text(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]);
  // The first icon Kobello may show, preferring the larger apple-touch-icon.
  let icon = [...hrefs(/apple-touch-icon/i), ...hrefs(/\bicon\b/i)].map((href) => iconUrl(href, pageUrl, devMode)).find(Boolean);

  // The web app manifest must be the site's own file.
  const manifestUrl = allowedUrl(hrefs(/\bmanifest\b/i)[0], pageUrl, devMode);
  if (manifestUrl?.origin === pageUrl.origin) {
    try {
      const file = await download(fetchUrl, manifestUrl, devMode, MAX_JSON_BYTES, true);
      const manifest = (parseJson(file) ?? {}) as { name?: unknown; short_name?: unknown; icons?: unknown };
      name = text(manifest.name) ?? text(manifest.short_name) ?? name;
      // Pick the largest icon the manifest lists, out of those Kobello may show.
      const icons: ({ src?: unknown; sizes?: unknown } | null)[] = Array.isArray(manifest.icons) ? manifest.icons : [];
      const best = icons
        .map((entry) => ({ url: iconUrl(entry?.src, file?.url ?? manifestUrl, devMode), size: parseInt(String(entry?.sizes), 10) || 0 }))
        .filter((entry) => entry.url)
        .sort((a, b) => b.size - a.size)[0];
      icon = best?.url ?? icon;
    } catch {
      // A broken manifest isn't fatal: keep what the HTML gave us.
    }
  }

  return { name: name?.slice(0, 80) || pageUrl.hostname, iconUrl: icon ?? `${pageUrl.origin}/favicon.ico` };
}
