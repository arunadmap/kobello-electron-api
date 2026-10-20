// System notifications for apps, with a per-app rate limit.

import { randomUUID } from 'crypto';
import { Notification } from 'electron';
import type { NotificationOptions } from '@kobello/sdk/protocol';
import { fail, requireString } from './common';

const MAX_PER_MINUTE = 10;

export class Notifier {
  /** When each app last showed notifications, for the rate limit. */
  private recent = new Map<string, number[]>();
  /** Shown notifications must stay referenced, or Electron may drop them before they're clicked. */
  private active = new Set<Notification>();

  constructor(private readonly onClick: (appId: string, id: string, tag?: string) => void) {}

  show(appId: string, appName: string, options: NotificationOptions): string {
    const title = requireString(options?.title, 'Title', 100);
    const body = options.body === undefined ? '' : requireString(options.body, 'Body', 500, true);
    const tag = options.tag === undefined ? undefined : requireString(options.tag, 'Tag', 100);

    const now = Date.now();
    const times = (this.recent.get(appId) ?? []).filter((time) => now - time < 60_000);
    if (times.length >= MAX_PER_MINUTE) fail('RATE_LIMITED', `At most ${MAX_PER_MINUTE} notifications per minute.`);
    this.recent.set(appId, [...times, now]);

    if (!Notification.isSupported()) fail('UNSUPPORTED', "This computer doesn't support notifications.");

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
