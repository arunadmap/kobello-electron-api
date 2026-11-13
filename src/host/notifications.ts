// System notifications for apps, with a per-app rate limit.

import { randomUUID } from 'crypto';
import { Notification } from 'electron';
import type { NotificationOptions } from '@kobello/sdk/protocol';
import { fail, RateLimiter, requireString } from './common';

const MAX_PER_MINUTE = 10;

export class Notifier {
  private limiter = new RateLimiter(MAX_PER_MINUTE, 60_000);
  /** Shown notifications must stay referenced, or Electron may drop them before they're clicked. */
  private active = new Set<Notification>();

  constructor(private readonly onClick: (appId: string, id: string, tag?: string) => void) {}

  show(appId: string, appName: string, options: NotificationOptions): string {
    const title = requireString(options?.title, 'Title', 100);
    const body = options.body === undefined ? '' : requireString(options.body, 'Body', 500, true);
    const tag = options.tag === undefined ? undefined : requireString(options.tag, 'Tag', 100);

    if (!Notification.isSupported()) fail('UNSUPPORTED', "This computer doesn't support notifications.");
    if (!this.limiter.take(appId)) fail('RATE_LIMITED', `At most ${MAX_PER_MINUTE} notifications per minute.`);

    const id = randomUUID();
    // The app's name goes in the title, so the user knows which app is talking.
    const notification = new Notification({ title: `${appName}: ${title}`, body, silent: options.silent === true });
    const forget = () => this.active.delete(notification);
    notification.on('click', () => {
      forget();
      this.onClick(appId, id, tag);
    });
    notification.on('close', forget);
    this.active.add(notification);
    notification.show();
    return id;
  }
}
