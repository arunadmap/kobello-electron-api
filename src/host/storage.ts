// Key/value storage for one app, kept in <app folder>/storage.json.

import fs from 'fs';
import type { JsonValue } from '@kobello-electron/sdk/protocol';
import { fail, requireString, writeFileAtomic } from './common';

const MAX_KEY_LENGTH = 256;
const MAX_VALUE_BYTES = 1024 * 1024;      // 1 MB per value
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB per app

/** The bytes one entry takes in storage.json: "key":"value" plus a comma. */
const entryBytes = (key: string, text: string) => Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(text)) + 2;

export class AppStorage {
  /**
   * Values are kept as JSON text. A Map, not a plain object, so keys like "constructor" or
   * "__proto__" are ordinary keys.
   */
  private values = new Map<string, string>();
  /** The size of all entries, kept up to date on every change instead of re-measured. */
  private totalBytes = 0;

  constructor(private readonly filePath: string, private readonly maxTotalBytes = MAX_TOTAL_BYTES) {
    if (!fs.existsSync(filePath)) return;
    try {
      const saved: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const entries = saved && typeof saved === 'object' && !Array.isArray(saved) ? Object.entries(saved) : [];
      for (const [key, text] of entries) {
        if (typeof text !== 'string') continue;
        this.values.set(key, text);
        this.totalBytes += entryBytes(key, text);
      }
    } catch (error) {
      console.error(`Couldn't read ${filePath}; starting with empty storage.`, error);
    }
  }

  get(key: unknown): JsonValue | undefined {
    const text = this.values.get(requireString(key, 'Key', MAX_KEY_LENGTH));
    return text === undefined ? undefined : JSON.parse(text);
  }

  set(key: unknown, value: unknown): void {
    const name = requireString(key, 'Key', MAX_KEY_LENGTH);
    const text = JSON.stringify(value);
    if (text === undefined) fail('INVALID_ARGUMENT', 'Value must be JSON (no undefined or functions).');
    if (Buffer.byteLength(text) > MAX_VALUE_BYTES) fail('QUOTA_EXCEEDED', 'A single value can be at most 1 MB.');

    const total = this.totalBytes - this.sizeOf(name) + entryBytes(name, text);
    if (total > this.maxTotalBytes) fail('QUOTA_EXCEEDED', 'Storage is full (10 MB per app).');
    this.values.set(name, text);
    this.totalBytes = total;
    this.save();
  }

  delete(key: unknown): void {
    const name = requireString(key, 'Key', MAX_KEY_LENGTH);
    if (!this.values.has(name)) return;
    this.totalBytes -= this.sizeOf(name);
    this.values.delete(name);
    this.save();
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  clear(): void {
    this.values.clear();
    this.totalBytes = 0;
    this.save();
  }

  /** The bytes a stored key takes now, or 0 if it isn't set. */
  private sizeOf(key: string): number {
    const text = this.values.get(key);
    return text === undefined ? 0 : entryBytes(key, text);
  }

  private save(): void {
    writeFileAtomic(this.filePath, JSON.stringify(Object.fromEntries(this.values)));
  }
}
