// Development only: serves the editor in a normal browser together with a pretend GitHub that holds the
// website repository in memory (starting from this checkout's HEAD), so the app can be tried without
// touching the real site.  Run:  node mac-app/dev/mock-github.mjs [port]   then open http://localhost:PORT/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const web = path.join(here, '..', 'web');
const repoDir = path.join(here, '..', '..');
const port = Number(process.argv[2] || 8765);

const git = (...a) => execFileSync('git', a, { cwd: repoDir, maxBuffer: 1 << 30 });
const blobs = new Map(); // sha -> Buffer (only for blobs created here)
const readBlob = (sha) => blobs.get(sha) || git('cat-file', 'blob', sha);
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const rand = () => crypto.randomBytes(20).toString('hex');

const trees = new Map(); // treeSha -> Map(path -> sha)
const commits = new Map(); // commitSha -> { tree, parents, message }
const base = new Map();
for (const line of git('ls-tree', '-r', 'HEAD').toString().split('\n')) {
  const m = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
  if (m) base.set(m[2], m[1]);
}
const t0 = rand();
trees.set(t0, base);
let head = rand();
commits.set(head, { tree: t0, parents: [], message: 'initial' });
export const log = [];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : null;
  const p = url.pathname;
  let m;
  if (p.startsWith('/raw/')) return send(res, 200, readBlob(p.slice(5)), 'image/jpeg');
  if (p === '/_state') { // for tests: current content of a path at head
    const files = trees.get(commits.get(head).tree);
    const f = url.searchParams.get('path');
    if (f) return files.has(f) ? send(res, 200, readBlob(files.get(f)), 'text/plain') : send(res, 404, 'missing', 'text/plain');
    return send(res, 200, { head, commits: log, paths: [...files.keys()] });
  }
  if (p.startsWith('/gh/')) {
    const api = p.slice(3).replace(/^\/repos\/[^/]+\/[^/]+/, '');
    if (api === '' && req.method === 'GET') return send(res, 200, { default_branch: 'main', permissions: { push: true } });
    if ((m = api.match(/^\/git\/ref\/heads\/(.+)$/))) return send(res, 200, { object: { sha: head } });
    if ((m = api.match(/^\/git\/commits\/([0-9a-f]+)$/))) {
      const c = commits.get(m[1]);
      return c ? send(res, 200, { sha: m[1], tree: { sha: c.tree } }) : send(res, 404, { message: 'Not Found' });
    }
    if ((m = api.match(/^\/git\/trees\/([0-9a-f]+)$/))) {
      const t = trees.get(m[1]);
      return send(res, 200, { sha: m[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })) });
    }
    if ((m = api.match(/^\/git\/blobs\/([0-9a-f]+)$/))) {
      const buf = readBlob(m[1]);
      return send(res, 200, { sha: m[1], encoding: 'base64', content: buf.toString('base64') });
    }
    if (api === '/git/blobs' && req.method === 'POST') {
      const buf = Buffer.from(json.content, json.encoding === 'base64' ? 'base64' : 'utf8');
      const sha = gitSha(buf);
      blobs.set(sha, buf);
      return send(res, 201, { sha });
    }
    if (api === '/git/trees' && req.method === 'POST') {
      const t = new Map(trees.get(json.base_tree));
      for (const e of json.tree) {
        if (e.sha === null) {
          if (!t.has(e.path)) return send(res, 422, { message: `path ${e.path} does not exist` });
          t.delete(e.path);
        } else if (e.content !== undefined) {
          const buf = Buffer.from(e.content);
          const sha = gitSha(buf);
          blobs.set(sha, buf);
          t.set(e.path, sha);
        } else t.set(e.path, e.sha);
      }
      const sha = rand();
      trees.set(sha, t);
      return send(res, 201, { sha });
    }
    if (api === '/git/commits' && req.method === 'POST') {
      const sha = rand();
      commits.set(sha, { tree: json.tree, parents: json.parents, message: json.message });
      return send(res, 201, { sha });
    }
    if ((m = api.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method === 'PATCH') {
      if (commits.get(json.sha).parents[0] !== head) return send(res, 422, { message: 'Update is not a fast forward' });
      head = json.sha;
      log.push(commits.get(head).message);
      return send(res, 200, { object: { sha: head } });
    }
    return send(res, 404, { message: 'Not Found ' + api });
  }
  // Pretend someone else published a change (for testing clashes): POST /_external?path=...  body = new text
  if (p === '/_external' && req.method === 'POST') {
    const c = commits.get(head);
    const t = new Map(trees.get(c.tree));
    const buf = Buffer.from(body);
    const sha = gitSha(buf);
    blobs.set(sha, buf);
    t.set(url.searchParams.get('path'), sha);
    const ts = rand();
    trees.set(ts, t);
    const cs = rand();
    commits.set(cs, { tree: ts, parents: [head], message: 'external' });
    head = cs;
    return send(res, 200, { head });
  }
  const file = path.join(web, p === '/' ? 'index.html' : p);
  if (!file.startsWith(web) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
}).listen(port, () => console.log(`Editor with pretend GitHub: http://localhost:${port}/`));
