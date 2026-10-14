export type StartupState =
  | { status: 'ready'; serverUrl: string }
  | { status: 'no-app'; serverUrl: string; appsPath: string }
  | { status: 'server-error'; message: string };

export interface ShellApi {
  getServerAddress(): Promise<string | null>;
  getStartupState(): Promise<StartupState>;
  retry(): Promise<void>;
  openAppsFolder(): Promise<string>;
}
