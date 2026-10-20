// Small helpers shared by the host modules. No Electron imports, so these modules can be unit-tested.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { KobelloError } from '@kobello/sdk';
import type { ErrorCode } from '@kobello/sdk/protocol';

/** Every app's data lives in ~/kobello/data/<appId>/ (storage.json and files/). */
export const DATA_ROOT = path.join(os.homedir(), 'kobello', 'data');

/** Kobello UI's own app ID. Its storage and the app registry live under this ID. */
export const SHELL_APP_ID = 'kobello.shell';

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

/** Writes a file in one step: a crash mid-write can't leave a half-written file behind. */
export function writeFileAtomic(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, filePath);
}
