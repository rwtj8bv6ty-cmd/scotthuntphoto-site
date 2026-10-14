// The link between the editor and the Mac app (Sources/main.swift).
// Opened in an ordinary browser instead (for development), it talks to dev/mock-github.mjs on the same address.
(function () {
  const wk = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
  if (wk) {
    window.Native = {
      inApp: true,
      async loadConfig() { return JSON.parse((await wk.postMessage({ cmd: 'loadConfig' })) || '{}'); },
      saveConfig(c) { return wk.postMessage({ cmd: 'saveConfig', json: JSON.stringify(c) }); },
      http(method, url, headers, body) { return wk.postMessage({ cmd: 'http', method, url, headers, body: body ?? null }); },
      open(url) { wk.postMessage({ cmd: 'open', url }); },
      clearCache() { return wk.postMessage({ cmd: 'clearCache' }); },
      blobURL(owner, repo, sha) { return `shp://blob/${owner}/${repo}/${sha}`; },
    };
    return;
  }
  const KEY = 'site-manager-config';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  window.Native = {
    inApp: false,
    async loadConfig() { return read(); },
    async saveConfig(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} },
    async http(method, url, headers, body) {
      const token = read().token;
      const target = url.replace('https://api.github.com', location.origin + '/gh');
      try {
        const r = await fetch(target, { method, headers: { ...headers, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ?? undefined });
        return { status: r.status, body: await r.text() };
      } catch (e) {
        return { status: 0, body: String(e) };
      }
    },
    open(url) { window.open(url, '_blank'); },
    async clearCache() {},
    blobURL(owner, repo, sha) { return `${location.origin}/raw/${sha}`; },
  };
})();
