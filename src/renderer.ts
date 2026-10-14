/**
 * Status screen shown when the shell application cannot be loaded:
 * either the local server failed to start, or ~/kobello/apps has no index.html.
 */
import './index.css';
import type { ShellApi, StartupState } from './types/startup';

declare global {
  interface Window {
    api: ShellApi;
  }
}

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  if (text) {
    element.textContent = text;
  }
  return element;
};

const createButton = (label: string, onClick: () => void, primary = false): HTMLButtonElement => {
  const button = createElement('button', primary ? 'button button-primary' : 'button', label);
  button.addEventListener('click', onClick);
  return button;
};

const render = (state: StartupState): void => {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  const card = createElement('div', 'status-card');
  const actions = createElement('div', 'status-actions');
  const retry = createButton('Retry', () => window.api.retry(), true);

  if (state.status === 'server-error') {
    card.append(
      createElement('h1', 'status-title status-error', 'Local server failed to start'),
      createElement('p', 'status-text', state.message)
    );
    actions.append(retry);
  } else {
    card.append(
      createElement('h1', 'status-title', 'No application installed'),
      createElement('p', 'status-text', 'Put your application\'s index.html (and its assets) in this folder, then retry:'),
      createElement('code', 'status-path', state.status === 'no-app' ? state.appsPath : '')
    );
    actions.append(retry, createButton('Open folder', () => window.api.openAppsFolder()));
  }

  card.append(actions);
  root.replaceChildren(card);
};

(async () => {
  try {
    render(await window.api.getStartupState());
  } catch (error) {
    console.error('Failed to read startup state:', error);
    render({
      status: 'server-error',
      message: error instanceof Error ? error.message : 'Could not reach the main process.',
    });
  }
})();
