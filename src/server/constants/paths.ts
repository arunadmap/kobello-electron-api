import path from "path";
import os from "os";
import { app } from "electron";

// Base directory for all file operations (user data, writable)
export const BASE_PATH = path.join(os.homedir(), "kobello");

// The shell application (index.html + assets) served at "/". It ships with the app:
// the project's apps/ folder in development, resources/apps in a packaged build.
export const APPS_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "apps")
  : path.join(app.getAppPath(), "apps");

// Persisted server state (open / active files)
export const STATE_PATH = path.join(BASE_PATH, "state");

// Server log files
export const LOGS_PATH = path.join(BASE_PATH, "logs");
