// Opens links in the user's default browser or mail app, on behalf of an app.

import { fail, isExternalLink, RateLimiter } from './common';

const MAX_OPENS = 5;
const WINDOW_SECONDS = 10;

export class LinkOpener {
  /** One limit per app for every way it can open a link, so it can't flood the user with browser tabs. */
  private limiter = new RateLimiter(MAX_OPENS, WINDOW_SECONDS * 1000);

  /** `openExternal` is Electron's shell.openExternal in the app, a fake in tests. */
  constructor(private readonly openExternal: (url: string) => Promise<void>) {}

  /** Opens an http, https or mailto link. Throws INVALID_ARGUMENT for other links and RATE_LIMITED for too many. */
  async open(appId: string, url: string): Promise<void> {
    if (!isExternalLink(url)) fail('INVALID_ARGUMENT', 'Only http, https and mailto links can be opened.');
    if (!this.limiter.take(appId)) fail('RATE_LIMITED', `At most ${MAX_OPENS} links every ${WINDOW_SECONDS} seconds.`);
    await this.openExternal(url);
  }
}
