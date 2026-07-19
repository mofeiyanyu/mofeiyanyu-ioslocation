// Assemble worker/single-file-worker.js — a dependency-free single-file Worker for the
// "paste into the Cloudflare dashboard" deploy path. It inlines every src/*.js and then
// inlines src/index.js itself (imports stripped, Hono replaced by a tiny shim), so the
// router is defined ONCE in index.js and the single-file can never drift. Regenerate:
//   cd worker && node scripts/build-single.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (f) => readFileSync(path.join(dir, "src", f), "utf8").replace(/^export\s+/gm, "").trim();
// index.js: drop the `import ...` lines (those symbols are inlined above) and the trailing
// `export default app;` (re-added at the end). Hono comes from the shim below.
const readIndex = () =>
  readFileSync(path.join(dir, "src", "index.js"), "utf8")
    .replace(/^import\s.*$/gm, "")
    .trim();

const header = `/**
 * iOS Location Spoofer — stateless picker, single-file Cloudflare Worker (AUTO-GENERATED).
 * DO NOT EDIT BY HAND. Source of truth: worker/src/*. Regenerate:
 *   cd worker && node scripts/build-single.mjs
 * Mirrors the Hono build (src/index.js) exactly: landing + /picker + /api/parse +
 * PWA manifest/icons + self-hosted module scripts & manifests. Stateless.
 */`;

const honoShim = `/* ---- minimal Hono shim (so this single-file mirrors src/index.js one-to-one) ---- */
class Hono {
  constructor() { this._routes = []; this._err = null; }
  get(p, h) { this._routes.push(["GET", p, h]); return this; }
  post(p, h) { this._routes.push(["POST", p, h]); return this; }
  onError(fn) { this._err = fn; }
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const c = {
      env, executionCtx: ctx,
      req: {
        url: request.url,
        method: request.method,
        query: (k) => url.searchParams.get(k),
        header: (k) => request.headers.get(k),
        json: () => request.json(),
        raw: request,
      },
      _h: {},
      header(k, v) { this._h[k] = v; },
      html(s) { return new Response(s, { headers: { "Content-Type": "text/html;charset=utf-8", ...this._h } }); },
      json(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json", ...this._h } }); },
      text(s, status) { return new Response(s, { status: status || 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...this._h } }); },
      body(b, status, headers) { return new Response(b, { status: status || 200, headers: { ...this._h, ...(headers || {}) } }); },
    };
    try {
      for (const [m, p, h] of this._routes) { if (m === request.method && url.pathname === p) return await h(c); }
      return new Response("Not found", { status: 404 });
    } catch (e) { if (this._err) return this._err(e, c); throw e; }
  }
}`;

const out = [
  header,
  honoShim,
  "/* ==== inlined from src/parse.js ==== */", readSrc("parse.js"),
  "/* ==== inlined from src/icons.js ==== */", readSrc("icons.js"),
  "/* ==== inlined from src/modules.js ==== */", readSrc("modules.js"),
  "/* ==== inlined from src/page.js ==== */", readSrc("page.js"),
  "/* ==== inlined from src/landing.js ==== */", readSrc("landing.js"),
  "/* ==== inlined from src/index.js (imports stripped, Hono shimmed) ==== */", readIndex(),
].join("\n\n");

writeFileSync(path.join(dir, "single-file-worker.js"), out);
console.log("wrote worker/single-file-worker.js (" + out.length + " bytes)");
