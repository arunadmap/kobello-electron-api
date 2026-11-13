// Small helpers shared by the host modules. No Electron imports, so these modules can be unit-tested.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { KobelloError } from '@kobello/sdk';
import type { Bounds, ErrorCode, Permission } from '@kobello/sdk/protocol';

/** Every app's data lives in ~/kobello/data/<appId>/ (owner.json, storage.json and files/). */
export const DATA_ROOT = path.join(os.homedir(), 'kobello', 'data');

/** Kobello UI's own app ID. Its storage and the app registry live under this ID. */
export const SHELL_APP_ID = 'kobello.shell';

/** Every permission a Kobello app can ask for. */
export const PERMISSIONS: readonly Permission[] = ['storage', 'files', 'notifications', 'links'];

/** Throws the error the SDK will show to the calling app. */
export function fail(code: ErrorCode, message: string): never {
  throw new KobelloError(code, message);
}

/** Checks that a value is a string of the allowed length and returns it. */
export function requireString(value: unknown, name: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `${name} must be a string.`);
  if (!allowEmpty && value.length === 0) fail('INVALID_ARGUMENT', `${name} can't be empty.`);
  if (value.length > maxLength) fail('INVALID_ARGUMENT', `${name} is longer than ${maxLength} characters.`);
  return value;
}

/** True for the object's own keys only: "constructor" and "__proto__" don't count. */
export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Links that may be handed to the user's default browser or mail app. */
export function isExternalLink(url: string): boolean {
  return /^(https?|mailto):/i.test(url);
}

/** Writes a file in one step: a crash mid-write can't leave a half-written file behind. */
export function writeFileAtomic(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, filePath);
}

/** Allows each key (an app ID) a number of actions per time window. */
export class RateLimiter {
  private recent = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** Counts one action and returns true, or returns false when the key has used up its window. */
  take(key: string, now = Date.now()): boolean {
    const times = (this.recent.get(key) ?? []).filter((time) => now - time < this.windowMs);
    const allowed = times.length < this.max;
    if (allowed) times.push(now);
    this.recent.set(key, times);
    return allowed;
  }
}

/** Resolves with `fallback` if the promise takes longer than `ms`. The timer runs here, in the main process. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Turns bounds measured in Kobello UI (CSS pixels) into window pixels.
 * They differ when Kobello UI is zoomed (Ctrl + plus/minus).
 */
export function scaleBounds(bounds: Bounds, zoomFactor: number): Bounds {
  const scale = (value: number) => Math.round(value * zoomFactor);
  return { x: scale(bounds.x), y: scale(bounds.y), width: scale(bounds.width), height: scale(bounds.height) };
}
