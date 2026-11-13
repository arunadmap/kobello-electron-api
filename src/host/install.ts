// The rules for installing an app. No Electron imports, so they can be unit-tested.

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { InspectResult, Permission } from '@kobello-electron/sdk/protocol';
import { fail, PERMISSIONS, requireString, writeFileAtomic } from './common';
import type { Registry, RegistryApp } from './registry';

/** Checks the permissions Kobello UI says the user approved: known permissions, each at most once. */
export function checkApprovedPermissions(value: unknown): Permission[] {
  if (!Array.isArray(value) || value.some((p) => !PERMISSIONS.includes(p)) || new Set(value).size !== value.length) {
    fail('INVALID_ARGUMENT', `Permissions must be a list of ${PERMISSIONS.join(', ')}, each at most once.`);
  }
  return value;
}

/**
 * Builds the registry record for an app that was just looked at again (`result`).
 *
 * The user approved `approved` after the first look. A Kobello app whose kobello.json asks for
 * anything else by now is refused, so it can't gain a permission the user never saw.
 */
export function installRecord(result: InspectResult, approved: Permission[], name: unknown, registry: Registry): RegistryApp {
  const origin = new URL(result.url).origin;
  const displayName = name === undefined ? undefined : requireString(name, 'Name', 80).trim() || undefined;

  if (result.kind === 'website') {
    // The same website twice: keep the one we have. Websites never get permissions.
    const existing = registry.list().find((app) => app.kind === 'website' && app.url === result.url);
    return existing ?? {
      id: `site-${randomUUID()}`,
      kind: 'website',
      name: displayName ?? result.name ?? new URL(result.url).hostname,
      url: result.url,
      iconUrl: result.iconUrl,
      permissions: [],
      origin,
      installedAt: new Date().toISOString(),
    };
  }

  const { manifest } = result;
  if (manifest.permissions.some((permission) => !approved.includes(permission))) {
    fail('PERMISSION_DENIED', `${manifest.name} now asks for different permissions. Check it again.`);
  }
  const existing = registry.get(manifest.id);
  if (existing && existing.origin !== origin) {
    fail('ALREADY_EXISTS', `An app with ID "${manifest.id}" is already installed from ${existing.origin}.`);
  }
  return {
    id: manifest.id,
    kind: 'kobello-app',
    name: displayName ?? existing?.name ?? manifest.name,
    url: result.url,
    iconUrl: result.iconUrl,
    permissions: manifest.permissions,
    origin,
    version: manifest.version,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
  };
}

/**
 * Marks an app's data folder as belonging to the app's origin (owner.json).
 *
 * An app picks its own ID, and the ID names the data folder. Without this, any site could publish
 * a kobello.json with another app's ID and, once that app was removed, read the data it left behind.
 * A folder that has no owner yet (from an older Kobello) goes to the first app that claims it.
 * owner.json sits outside files/, so the app itself can't change it.
 */
export function claimDataFolder(appDir: string, app: { id: string; name: string; origin: string }): void {
  const ownerFile = path.join(appDir, 'owner.json');
  let owner: unknown;
  try {
    owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')).origin;
  } catch {
    owner = undefined; // no owner file, or an unreadable one
  }
  if (owner === app.origin) return;
  if (typeof owner === 'string') {
    fail('PERMISSION_DENIED', `${app.name} can't be added: the data saved for "${app.id}" belongs to an app from ${owner}.`);
  }
  writeFileAtomic(ownerFile, JSON.stringify({ origin: app.origin }, null, 2));
}
