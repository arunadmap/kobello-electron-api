// The fetch that site-info.ts uses in the app, built on Electron's net.request.
// Electron's net.fetch doesn't fit: with redirect: 'manual' it fails instead of returning the redirect.

import { Readable } from 'stream';
import { net } from 'electron';
import type { FetchUrl } from './site-info';

/**
 * GETs a URL without cookies, without the browser cache and without following redirects:
 * a redirect comes back as a 3xx response with a Location header.
 */
export const fetchWithoutRedirects: FetchUrl = (url, { signal }) => new Promise((resolve, reject) => {
  const request = net.request({ url, redirect: 'manual', credentials: 'omit', cache: 'no-store' });
  let body: Readable | undefined;

  // The timeout: stop the request, and the body if it's still being read.
  signal.addEventListener('abort', () => {
    request.abort();
    body?.destroy(signal.reason);
    reject(signal.reason);
  }, { once: true });

  // The redirect isn't followed, so Electron cancels the request. The 'error' that follows is
  // ignored: the promise has already resolved.
  request.on('redirect', (status, _method, location) => {
    resolve(new Response(null, { status, headers: { location } }));
  });
  request.on('response', (response) => {
    body = response as unknown as Readable;
    // When the reader stops early (the size limit), stop the download too.
    body.once('close', () => request.abort());
    const hasBody = ![204, 205, 304].includes(response.statusCode);
    try {
      resolve(new Response(hasBody ? Readable.toWeb(body) as ReadableStream : null, { status: response.statusCode }));
    } catch (error) {
      reject(error); // a status code a Response can't carry
    }
  });
  request.on('error', reject);
  request.end();
});
