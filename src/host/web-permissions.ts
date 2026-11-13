// Web permissions (camera, location, notifications, USB, ...) for every page Kobello shows.
// Electron grants all of them unless told otherwise, so each session gets handlers that deny by default.
// Kobello apps get their abilities from the SDK instead, where the user approves them.

import type { Session } from 'electron';

/** The only web permission pages get: putting text on the clipboard ("Copy" buttons). */
export function allowsWebPermission(permission: string): boolean {
  return permission === 'clipboard-sanitized-write';
}

/**
 * Makes a session deny every other permission request and check, and all device access.
 * That includes 'openExternal': a page can't start another program by navigating to its link
 * (search-ms:, ms-msdt: and the like). Links to the browser go through links.ts.
 */
export function denyWebPermissions(target: Session): void {
  target.setPermissionRequestHandler((_contents, permission, callback) => callback(allowsWebPermission(permission)));
  target.setPermissionCheckHandler((_contents, permission) => allowsWebPermission(permission));
  target.setDevicePermissionHandler(() => false);
}
