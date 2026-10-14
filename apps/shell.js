/**
 * Kobello shell: reads apps.json, lists the apps in the sidebar and shows each
 * one in its own iframe. Frames stay alive when you switch, so apps keep state.
 */
(function () {
  const STORAGE_KEY = 'kobello.shell';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const shell = document.querySelector('.shell');
  const appList = document.getElementById('app-list');
  const appArea = document.getElementById('app-area');
  const toggleButton = document.getElementById('toggle-sidebar');
  const serverStatus = document.getElementById('server-status');

  const frames = new Map();
  const links = new Map();

  const loadPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  };

  const prefs = loadPrefs();

  const savePrefs = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable; preferences just won't persist
    }
  };

  const createIcon = (pathData) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
    return svg;
  };

  const openApp = (app) => {
    if (!frames.has(app.id)) {
      const frame = document.createElement('iframe');
      frame.className = 'app-frame';
      frame.title = app.name;
      frame.src = app.url;
      appArea.append(frame);
      frames.set(app.id, frame);
    }

    frames.forEach((frame, id) => { frame.hidden = id !== app.id; });
    links.forEach((link, id) => {
      if (id === app.id) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    document.title = `${app.name} · Kobello`;
    prefs.activeApp = app.id;
    savePrefs();
  };

  const renderApps = (apps) => {
    apps.forEach((app) => {
      const link = document.createElement('button');
      link.className = 'app-link';
      link.title = app.name;

      const name = document.createElement('span');
      name.className = 'app-name';
      name.textContent = app.name;

      link.append(createIcon(app.icon), name);
      link.addEventListener('click', () => openApp(app));

      const item = document.createElement('li');
      item.append(link);
      appList.append(item);
      links.set(app.id, link);
    });
  };

  const setCollapsed = (collapsed) => {
    shell.classList.toggle('collapsed', collapsed);
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggleButton.title = label;
    toggleButton.setAttribute('aria-label', label);
    prefs.collapsed = collapsed;
    savePrefs();
  };

  const checkServer = async () => {
    const label = serverStatus.querySelector('.status-label');
    try {
      const response = await fetch('/api/v1/serverInfo');
      const info = await response.json();
      serverStatus.className = 'sidebar-footer online';
      label.textContent = `Connected · ${new URL(info.serverUrl).host}`;
    } catch {
      serverStatus.className = 'sidebar-footer offline';
      label.textContent = 'Server unreachable';
    }
  };

  const init = async () => {
    setCollapsed(Boolean(prefs.collapsed));
    toggleButton.addEventListener('click', () => setCollapsed(!shell.classList.contains('collapsed')));

    const apps = await fetch('apps.json').then((response) => response.json());
    renderApps(apps);

    if (apps.length) {
      openApp(apps.find((app) => app.id === prefs.activeApp) || apps[0]);
    }

    checkServer();
    setInterval(checkServer, 15000);
  };

  init().catch((error) => {
    appArea.textContent = `Could not load apps.json: ${error.message}`;
  });
})();
