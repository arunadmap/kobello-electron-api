/**
 * Files app: browse ~/kobello and preview text files.
 */
(function () {
  const PREVIEW_LIMIT = 200000; // characters
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    folder: 'M3 6.5h6l2 2h10V19H3z',
    file: 'M6 3h9l5 5v13H6z M15 3v5h5',
  };

  const crumbs = document.getElementById('crumbs');
  const fileList = document.getElementById('file-list');
  const refreshButton = document.getElementById('refresh');
  const emptyState = document.getElementById('empty-state');
  const previewPane = document.getElementById('preview-pane');
  const previewTitle = document.getElementById('preview-title');
  const previewMeta = document.getElementById('preview-meta');
  const preview = document.getElementById('preview');

  let segments = [];
  let selected = null;

  const createIcon = (type) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add(`${type}-icon`);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[type]);
    svg.append(path);
    return svg;
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const showPreview = (visible) => {
    previewPane.hidden = !visible;
    emptyState.hidden = visible;
  };

  const renderCrumbs = () => {
    const parts = [{ label: 'kobello', path: [] }].concat(
      segments.map((name, index) => ({ label: name, path: segments.slice(0, index + 1) }))
    );

    crumbs.replaceChildren(...parts.flatMap((part, index) => {
      const button = document.createElement('button');
      button.className = 'crumb';
      button.textContent = part.label;
      button.addEventListener('click', () => openFolder(part.path));

      if (index === 0) {
        return [button];
      }
      const separator = document.createElement('span');
      separator.className = 'crumb-separator';
      separator.textContent = '/';
      return [separator, button];
    }));
  };

  const showListMessage = (text, isError = false) => {
    const message = document.createElement('li');
    message.className = isError ? 'list-message error' : 'list-message';
    message.textContent = text;
    fileList.replaceChildren(message);
  };

  const renderItems = (items) => {
    if (!items.length) {
      showListMessage('This folder is empty.');
      return;
    }

    const sorted = [...items].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
    );

    fileList.replaceChildren(...sorted.map((entry) => {
      const button = document.createElement('button');
      button.className = entry.type === 'file' && entry.name === selected ? 'item active' : 'item';
      button.title = entry.name;

      const name = document.createElement('span');
      name.textContent = entry.name;
      button.append(createIcon(entry.type), name);

      button.addEventListener('click', () => {
        if (entry.type === 'folder') {
          openFolder([...segments, entry.name]);
        } else {
          openFile(entry.name);
        }
      });

      const item = document.createElement('li');
      item.append(button);
      return item;
    }));
  };

  const openFolder = async (path) => {
    try {
      const items = await window.kobello.list(path.join('/'));
      segments = path;
      selected = null;
      showPreview(false);
      renderCrumbs();
      renderItems(items);
    } catch (error) {
      showListMessage(error.message, true);
    }
  };

  const openFile = async (name) => {
    try {
      const file = await window.kobello.read(segments.join('/'), name);
      selected = name;

      const truncated = file.content.length > PREVIEW_LIMIT;
      previewTitle.textContent = name;
      previewMeta.textContent = `${formatSize(file.size)} · created ${new Date(file.createdAt).toLocaleString()}`
        + (truncated ? ' · preview truncated' : '');
      preview.textContent = truncated ? file.content.slice(0, PREVIEW_LIMIT) : file.content;
      showPreview(true);

      fileList.querySelectorAll('.item').forEach((button) => {
        button.classList.toggle('active', button.title === name);
      });
    } catch (error) {
      previewTitle.textContent = name;
      previewMeta.textContent = '';
      preview.textContent = error.message;
      showPreview(true);
    }
  };

  refreshButton.addEventListener('click', () => openFolder(segments));

  openFolder([]);
})();
