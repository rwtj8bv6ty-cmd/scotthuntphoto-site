// Reading the website's repository from GitHub and publishing changes as one commit.
(function () {
  const API = 'https://api.github.com';

  async function gh(method, path, body) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await Native.http(method, API + path, headers, body === undefined ? undefined : JSON.stringify(body));
    if (!r || !r.status) throw new Error('Could not reach GitHub. Check the internet connection and try again.');
    let data = null;
    try { data = r.body ? JSON.parse(r.body) : null; } catch { data = r.body; }
    if (r.status >= 400) {
      const e = new Error(explain(r.status, data));
      e.status = r.status;
      throw e;
    }
    return data;
  }

  function explain(status, data) {
    const msg = (data && data.message) || '';
    if (status === 401) return 'GitHub did not accept the access key. It may have expired; add a new one under Account.';
    if (status === 403 && /rate limit/i.test(msg)) return 'GitHub asked us to slow down. Wait a few minutes and try again.';
    if (status === 403) return 'The access key is not allowed to change this website. Make a new key with the "repo" box ticked.';
    if (status === 404) return 'GitHub could not find the website repository with this access key.';
    return `GitHub said: ${msg || 'error ' + status}`;
  }

  const decoder = new TextDecoder();
  const b64ToText = (b64) => decoder.decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  const textToB64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

  // Run fn over items with at most n at a time.
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  class Repo {
    constructor({ owner, repo, branch }) {
      Object.assign(this, { owner, repo, branch });
      this.base = `/repos/${owner}/${repo}`;
    }
    info() { return gh('GET', this.base); }
    async head() {
      const ref = await gh('GET', `${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`);
      return ref.object.sha;
    }
    // Returns { commit, treeSha, files: Map(path -> sha) } for the branch's latest commit (or the given one).
    async snapshot(commit) {
      commit = commit || (await this.head());
      const c = await gh('GET', `${this.base}/git/commits/${commit}`);
      const t = await gh('GET', `${this.base}/git/trees/${c.tree.sha}?recursive=1`);
      const files = new Map();
      for (const e of t.tree) if (e.type === 'blob') files.set(e.path, e.sha);
      return { commit, treeSha: c.tree.sha, files, truncated: !!t.truncated };
    }
    async readText(sha) {
      const b = await gh('GET', `${this.base}/git/blobs/${sha}`);
      return b.encoding === 'base64' ? b64ToText(b.content) : b.content;
    }
    readMany(shas, n = 8) { return pool(shas, n, (sha) => this.readText(sha)); }

    // changes: [{ path, text } | { path, blob } | { path, delete: true }]
    async commit(parent, baseTree, changes, message, progress) {
      const uploads = changes.filter((c) => c.blob);
      let done = 0;
      const shas = await pool(uploads, 3, async (c) => {
        const b = await gh('POST', `${this.base}/git/blobs`, { content: await blobToB64(c.blob), encoding: 'base64' });
        progress && progress(++done, uploads.length);
        return b.sha;
      });
      const shaFor = new Map(uploads.map((c, i) => [c, shas[i]]));
      const tree = changes.map((c) => {
        if (c.delete) return { path: c.path, mode: '100644', type: 'blob', sha: null };
        if (c.blob) return { path: c.path, mode: '100644', type: 'blob', sha: shaFor.get(c) };
        return { path: c.path, mode: '100644', type: 'blob', content: c.text };
      });
      const t = await gh('POST', `${this.base}/git/trees`, { base_tree: baseTree, tree });
      const commit = await gh('POST', `${this.base}/git/commits`, { message, tree: t.sha, parents: [parent] });
      await gh('PATCH', `${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha, force: false });
      return commit.sha;
    }
  }

  window.GitHub = { gh, Repo, pool, textToB64 };
})();
