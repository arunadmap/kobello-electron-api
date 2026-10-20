// Key/value storage for one app, kept in <app folder>/storage.json.

import fs from 'fs';
import type { JsonValue } from '@kobello/sdk/protocol';
import { fail, requireString, writeFileAtomic } from './common';

const MAX_KEY_LENGTH = 256;
const MAX_VALUE_BYTES = 1024 * 1024;      // 1 MB per value
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB per app

export class AppStorage {
  /** Values are kept as JSON text, which is also how they're measured against the limits. */
  private values: Record<string, string>;

  constructor(private readonly filePath: string) {
    this.values = {};
    if (fs.existsSync(filePath)) {
      try {
        this.values = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        console.error(`Couldn't read ${filePath}; starting with empty storage.`, error);
      }
    }
  }

  get(key: unknown): JsonValue | undefined {
    const text = this.values[requireString(key, 'Key', MAX_KEY_LENGTH)];
    return text === undefined ? undefined : JSON.parse(text);
  }

  set(key: unknown, value: unknown): void {
    const name = requireString(key, 'Key', MAX_KEY_LENGTH);
    const text = JSON.stringify(value);
    if (text === undefined) fail('INVALID_ARGUMENT', 'Value must be JSON (no undefined or functions).');
    if (Buffer.byteLength(text) > MAX_VALUE_BYTES) fail('QUOTA_EXCEEDED', 'A single value can be at most 1 MB.');

    const next = { ...this.values, [name]: text };
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_TOTAL_BYTES) fail('QUOTA_EXCEEDED', 'Storage is full (10 MB per app).');
    this.values = next;
    this.save();
  }

  delete(key: unknown): void {
    const name = requireString(key, 'Key', MAX_KEY_LENGTH);
    if (!(name in this.values)) return;
    delete this.values[name];
    this.save();
  }

  keys(): string[] {
    return Object.keys(this.values);
  }

  clear(): void {
    this.values = {};
    this.save();
  }

  private save(): void {
    writeFileAtomic(this.filePath, JSON.stringify(this.values));
  }
}
