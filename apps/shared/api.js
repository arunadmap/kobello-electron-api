/**
 * Tiny client for the Kobello file API. Paths are relative to ~/kobello.
 * Exposed as window.kobello for every app.
 */
(function () {
  const request = async (method, url, body) => {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }
    return data;
  };

  const query = (params) => new URLSearchParams(params).toString();

  window.kobello = {
    list: (path) =>
      request('GET', `/api/v1/file/list?${query({ path })}`).then((data) => data.files),

    read: (filePath, fileName) =>
      request('GET', `/api/v1/file/get?${query({ filePath, fileName })}`).then((data) => data.file),

    create: (filePath, fileName, content) =>
      request('POST', '/api/v1/file/create', { filePath, fileName, content }).then((data) => data.file),

    update: (filePath, fileName, content) =>
      request('PUT', '/api/v1/file/update', { filePath, fileName, content }).then((data) => data.file),

    remove: (filePath, fileName) =>
      request('DELETE', `/api/v1/file/delete?${query({ filePath, fileName })}`).then((data) => data.file),
  };
})();
