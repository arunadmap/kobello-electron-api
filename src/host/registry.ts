// The list of installed apps, saved in ~/kobello/data/kobello.shell/registry.json.
// It's the source of truth for each app's identity, origin and permissions.

import fs from 'fs';
import type { InstalledApp } from '@kobello-electron/sdk/protocol';
import { writeFileAtomic } from './common';

export interface RegistryApp extends InstalledApp {
  /** The only origin this app may call the SDK from. */
  origin: string;
  /** The app's version from kobello.json (Kobello apps only). */
  version?: string;
  installedAt: string;
}

export class Registry {
  private apps: RegistryApp[] = [];

  constructor(private readonly filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        this.apps = JSON.parse(fs.readFileSync(filePath, 'utf8')).apps ?? [];
      } catch (error) {
        console.error(`Couldn't read ${filePath}; starting with no apps.`, error);
      }
    }
  }

  list(): RegistryApp[] {
    return [...this.apps];
  }

  get(id: string): RegistryApp | undefined {
    return this.apps.find((app) => app.id === id);
  }

  /** Adds the app, or replaces the one with the same ID (a reinstall). */
  put(app: RegistryApp): void {
    const index = this.apps.findIndex((existing) => existing.id === app.id);
    if (index >= 0) this.apps[index] = app;
    else this.apps.push(app);
    this.save();
  }

  remove(id: string): void {
    this.apps = this.apps.filter((app) => app.id !== id);
    this.save();
  }

  private save(): void {
    writeFileAtomic(this.filePath, JSON.stringify({ apps: this.apps }, null, 2));
  }
}

/** What Kobello UI sees: the record without the host-only fields. */
export function toInstalledApp({ id, kind, name, url, iconUrl, permissions }: RegistryApp): InstalledApp {
  return { id, kind, name, url, iconUrl, permissions };
}
