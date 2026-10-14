import path from "path";
import os from "os";

// Base directory for all file operations
export const BASE_PATH = path.join(os.homedir(), "kobello");

// The shell application (index.html + assets) served at "/"
export const APPS_PATH = path.join(BASE_PATH, "apps");

// Persisted server state (open / active files)
export const STATE_PATH = path.join(BASE_PATH, "state");

// Server log files
export const LOGS_PATH = path.join(BASE_PATH, "logs");
