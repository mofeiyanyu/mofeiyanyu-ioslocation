/**
 * iOS Location Spoofer — stateless picker, single-file Cloudflare Worker (AUTO-GENERATED).
 * DO NOT EDIT BY HAND. Source of truth: worker/src/*. Regenerate:
 *   cd worker && node scripts/build-single.mjs
 * Mirrors the Hono build (src/index.js) exactly: landing + /picker + /api/parse +
 * PWA manifest/icons + self-hosted module scripts & manifests. Stateless.
 */

/* ---- minimal Hono shim (so this single-file mirrors src/index.js one-to-one) ---- */
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
}

/* ==== inlined from src/parse.js ==== */

// Coordinate parsing: accepts a map link (Apple Maps / Amap, including short links) and extracts the longitude, latitude and name.
// Amap uses GCJ-02; Apple Maps is also GCJ-02 in mainland China. Both are converted to WGS84 before being fed to wloc;
// gcj02ToWgs84 has a built-in out_of_china check and returns coordinates outside China unchanged (no-op).

function safeDecode(s) {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch (e) {
    return String(s);
  }
}

// Extract longitude, latitude and name from a string. Handles:
//  Apple Maps coordinate=/ll=/sll=lat,lon  (name in name=...)
//  Amap ?p=POIID,lat,lon,name,city  (comma or %2C)
//  Amap ?q=lat,lon,name             (newer share links, comma or %2C)
//  Plain text lat,lon
function extractFromString(s) {
  if (!s) return null;
  const str = String(s);
  let m;
  // Baidu (BD-09): gate on host so other providers' params aren't misread as Baidu.
  if (/baidu\.com/i.test(str)) {
    m = str.match(/[?&](?:location|latlng|point)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
    if (m) {
      const nm = str.match(/[?&](?:name|title|content)=([^&]+)/i);
      return { lat: +m[1], lon: +m[2], name: nm ? safeDecode(nm[1]) : "", src: "baidu" };
    }
  }
  // Google Maps: !3d/!4d is the place point, @lat,lng is the viewport centre.
  // Treated as WGS-84; the GCJ conversion applied downstream is a no-op outside China.
  m = str.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: +m[1], lon: +m[2], name: "", src: "google" };
  m = str.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: +m[1], lon: +m[2], name: "", src: "google" };
  m = str.match(/(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i);
  if (m) {
    const nm = str.match(/[?&]name=([^&]+)/i);
    return { lat: +m[1], lon: +m[2], name: nm ? safeDecode(nm[1]) : "", src: "apple" };
  }
  m = str.match(
    /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i
  );
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };
  m = str.match(
    /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i
  );
  if (m) return { lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" };
  m = str.match(/(-?\d{1,3}\.\d{4,})\s*(?:,|%2C)\s*(-?\d{1,3}\.\d{4,})/);
  if (m) return { lat: +m[1], lon: +m[2], name: "", src: "text" };
  return null;
}

// Accepts raw text (which may contain a place name plus a link), extracts the URL, follows redirects to expand short links when needed, and extracts the coordinates.
async function parseCoords(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty input");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  let target = urlMatch ? urlMatch[0] : text;

  let hit = extractFromString(target);
  if (hit) return hit;

  if (urlMatch) {
    let cur = target;
    for (let i = 0; i < 5; i++) {
      let resp;
      try {
        resp = await fetch(cur, {
          redirect: "manual",
          headers: {
            "user-agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/24A5370h Safari/604.1",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "zh-CN,zh-Hans;q=0.9",
          },
        });
      } catch (e) {
        break;
      }
      const loc = resp.headers.get("location");
      if (loc) {
        hit = extractFromString(loc);
        if (hit) return hit;
        cur = new URL(loc, cur).toString();
        hit = extractFromString(cur);
        if (hit) return hit;
        continue;
      }
      hit = extractFromString(resp.url);
      if (hit) return hit;
      try {
        const body = await resp.text();
        hit = extractFromString(body);
        if (hit) return hit;
      } catch (e) {}
      break;
    }
  }
  throw new Error("Could not parse coordinates from the link");
}

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function gcjOutOfChina(lng, la) {
  return lng < 72.004 || lng > 137.8347 || la < 0.8293 || la > 55.8271;
}

function gcjDeltaLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return r;
}

function gcjDeltaLon(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return r;
}

// WGS84 -> GCJ-02 (forward offset), matching the offset used by Amap / Apple in China.
function wgs84ToGcj02(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let dLat = gcjDeltaLat(lon - 105.0, lat - 35.0);
  let dLon = gcjDeltaLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

// GCJ-02 -> WGS84 (iterative inverse, sub-meter accuracy).
// A single-pass inverse leaves a 1~2m residual in areas with a steep offset gradient; here a fixed-point
// iteration converges to <0.1m, aligning strictly with Amap's own WGS84->GCJ inverse and removing round-trip residuals.
function gcj02ToWgs84(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 6; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLon);
    const errLat = g.lat - lat;
    const errLon = g.lon - lon;
    if (Math.abs(errLat) < 1e-9 && Math.abs(errLon) < 1e-9) break;
    wgsLat -= errLat;
    wgsLon -= errLon;
  }
  return { lat: wgsLat, lon: wgsLon };
}

const BD_X_PI = (Math.PI * 3000) / 180;

// BD-09 (Baidu) -> GCJ-02 (Baidu adds a second offset on top of GCJ-02).
function bd09ToGcj02(lat, lon) {
  const x = lon - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BD_X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * BD_X_PI);
  return { lat: z * Math.sin(theta), lon: z * Math.cos(theta) };
}

// BD-09 (Baidu) -> WGS-84. Baidu Maps is mainland-China only; outside China
// the GCJ guard makes this a no-op so foreign coordinates pass through untouched.
function bd09ToWgs84(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  const g = bd09ToGcj02(lat, lon);
  return gcj02ToWgs84(g.lat, g.lon);
}

/* ==== inlined from src/icons.js ==== */

// Auto-generated PWA app icons. Regenerate with scripts/gen_icons.py.
// Blue square + white location pin; apple-touch-icon (180) and web manifest (512).
const ICON_180_B64 = "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";
const ICON_512_B64 = "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";

// Inline vector icon (favicon + manifest 'any' purpose).
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E9BFF"/><stop offset="1" stop-color="#0A66FF"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><path fill="#fff" d="M256 120a96 96 0 0 0-96 96c0 66 96 176 96 176s96-110 96-176a96 96 0 0 0-96-96z"/><circle cx="256" cy="216" r="40" fill="#0A66FF"/></svg>`;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ==== inlined from src/modules.js ==== */

// Auto-generated: the on-device module scripts, base64 (UTF-8 bytes). DO NOT EDIT BY HAND.
// Regenerate with: cd stateless-picker/worker && node scripts/gen-modules.mjs
// The worker serves these at /location-spoofer.js, /location-settings.js and
// /location-spoofer-qx.js so the whole stateless setup runs from the worker (no GitHub dep).
const LOCATION_SPOOFER_B64 = "LyoKICog5oum5oiqIEFwcGxlIC9jbGxzL3dsb2Mg5o6l5Y+j55qE5Zue5bqU77yM6KejIEFSUEMg5bCB5YyF77yM5pS5IFdpRmkg54Ot54K55ZKM5Z+656uZ5Z2Q5qCH77yMCiAqIOWGjeaMiSBBcHBsZSDnmoTmoLzlvI/lsIHlm57ljrvov5Tlm57nu5nns7vnu5/jgIIKICoKICog5Li76KaB5rWB56iL77yaCiAqICAgQVJQQyDmi4bljIUg4oaSIHByb3RvYnVmIOino+Wtl+autSDihpIg5pu/5o2iIExvY2F0aW9uIOWtkOa2iOaBr+eahOWdkOaghy/nsr7luqYv6L+Q5Yqo54q25oCBCiAqICAg4oaSIHByb3RvYnVmIOmHjeaWsOaJk+WMhSDihpIg5oyJ5Y6f5qC85byP77yIQVJQQyAvIG1hcmtlciAvIHN5bnRoZXRpY++8ieWwgeWbngogKi8KKGZ1bmN0aW9uICgpIHsKICAidXNlIHN0cmljdCI7CgogIHZhciBERUZBVUxUX0NPTkZJRyA9IHsKICAgIC8vIFN0YXRlbGVzcyBkZWZhdWx0OiBPRkYgdW50aWwgYSBjb29yZGluYXRlIGlzIHdyaXR0ZW4gdG8gdGhlIGRldmljZSdzIG93bgogICAgLy8gJHBlcnNpc3RlbnRTdG9yZSAoYnkgdGhlIHBpY2tlcidzIHNhdmUtaW50ZXJjZXB0b3IpIG9yIGVuYWJsZWQ9dHJ1ZSBpcyBwYXNzZWQKICAgIC8vIGFzIGEgbW9kdWxlIGFyZ3VtZW50LiBUaGlzIG1ha2VzICJub3RoaW5nIHBpY2tlZCB5ZXQiIGZhbGwgdGhyb3VnaCB0byB0aGUgcmVhbAogICAgLy8gbG9jYXRpb24gaW5zdGVhZCBvZiB0aGUgYnVpbHQtaW4gQXBwbGUgUGFyayBkZWZhdWx0LiBTdGF0ZWZ1bCBtb2R1bGUgbWFuaWZlc3RzCiAgICAvLyBwYXNzIGVuYWJsZWQ9dHJ1ZSBleHBsaWNpdGx5IHRvIGtlZXAgdGhlaXIgYWx3YXlzLW9uIGJlaGF2aW9yLgogICAgZW5hYmxlZDogZmFsc2UsCiAgICBtb2RlOiAicmVzcG9uc2UiLAogICAgbGF0aXR1ZGU6IDM3LjMzNDksCiAgICBsb25naXR1ZGU6IC0xMjIuMDA5MDIsCiAgICBob3Jpem9udGFsQWNjdXJhY3k6IDM5LAogICAgdmVydGljYWxBY2N1cmFjeTogMTAwMCwKICAgIGFsdGl0dWRlOiA1MzAsCiAgICB1bmtub3duVmFsdWU0OiAzLAogICAgbW90aW9uQWN0aXZpdHlUeXBlOiA2MywKICAgIG1vdGlvbkFjdGl2aXR5Q29uZmlkZW5jZTogNDY3LAogICAgZmFpbE9wZW46IHRydWUsCiAgICBkZWJ1ZzogZmFsc2UsCiAgICBkdW1wUmF3OiBmYWxzZSwKICAgIGR1bXBIZWFkZXJzOiBmYWxzZSwKICAgIHByZXBhcmVIZWFkZXJzOiBmYWxzZSwKICAgIHJhd0xpbWl0OiAwCiAgfTsKCiAgLy8gUHJlZml4IHByZXBlbmRlZCB0byBhIFNQT09GRUQgKHN5bnRoZXNpemVkKSByZXNwb25zZS4gTWlycm9ycyB0aGUgb3JpZ2luYWwgR28KICAvLyBgaW5pdGlhbEJ5dGVzID0gMDAwMTAwMDAwMDAxMDAwMGAgZnJvbSBtYWluLmdvOjI1My4KICB2YXIgQVBQTEVfV0xPQ19QUkVGSVggPSBieXRlc0Zyb21BcnJheShbMHgwMCwgMHgwMSwgMHgwMCwgMHgwMCwgMHgwMCwgMHgwMSwgMHgwMCwgMHgwMF0pOwoKICAvLyBTdGFibGUgbWFya2VyIHRoYXQgcHJlY2VkZXMgdGhlIEFwcGxlV0xvYyBwcm90b2J1ZiBpbnNpZGUgYSBSRUFMIEFwcGxlIC9jbGxzL3dsb2MKICAvLyByZXNwb25zZS4gQWZ0ZXIgdGhlIG1hcmtlciBjb21lIDIgYnl0ZXMgKHVpbnQxNiBCRSBwYXlsb2FkIGxlbmd0aCkgdGhlbiB0aGUgcGF5bG9hZC4KICB2YXIgQVBQTEVfV0xPQ19NQVJLRVIgPSBieXRlc0Zyb21BcnJheShbMHgwMCwgMHgwMCwgMHgwMCwgMHgwMSwgMHgwMCwgMHgwMF0pOwogIHZhciBST09UX0RST1BfRklFTERTID0geyAzOiB0cnVlLCA0OiB0cnVlLCAzMzogdHJ1ZSB9OwogIHZhciBDRUxMX1JFU1BPTlNFX0ZJRUxEUyA9IHsgMjI6IHRydWUsIDI0OiB0cnVlIH07CiAgdmFyIExPQ0FUSU9OX1JFUExBQ0VEX0ZJRUxEUyA9IHsKICAgIDE6IHRydWUsCiAgICAyOiB0cnVlLAogICAgMzogdHJ1ZSwKICAgIDQ6IHRydWUsCiAgICA1OiB0cnVlLAogICAgNjogdHJ1ZSwKICAgIDExOiB0cnVlLAogICAgMTI6IHRydWUKICB9OwoKICBmdW5jdGlvbiBieXRlc0Zyb21BcnJheSh2YWx1ZXMpIHsKICAgIHJldHVybiBuZXcgVWludDhBcnJheSh2YWx1ZXMpOwogIH0KCiAgZnVuY3Rpb24gY29uY2F0Qnl0ZXMocGFydHMpIHsKICAgIHZhciB0b3RhbCA9IDA7CiAgICB2YXIgaTsKICAgIGZvciAoaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMSkgewogICAgICB0b3RhbCArPSBwYXJ0c1tpXS5sZW5ndGg7CiAgICB9CgogICAgdmFyIG91dCA9IG5ldyBVaW50OEFycmF5KHRvdGFsKTsKICAgIHZhciBvZmZzZXQgPSAwOwogICAgZm9yIChpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgIG91dC5zZXQocGFydHNbaV0sIG9mZnNldCk7CiAgICAgIG9mZnNldCArPSBwYXJ0c1tpXS5sZW5ndGg7CiAgICB9CiAgICByZXR1cm4gb3V0OwogIH0KCiAgZnVuY3Rpb24gYnl0ZXNFcXVhbFByZWZpeChieXRlcywgcHJlZml4KSB7CiAgICBpZiAoIWJ5dGVzIHx8IGJ5dGVzLmxlbmd0aCA8IHByZWZpeC5sZW5ndGgpIHsKICAgICAgcmV0dXJuIGZhbHNlOwogICAgfQogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVmaXgubGVuZ3RoOyBpICs9IDEpIHsKICAgICAgaWYgKGJ5dGVzW2ldICE9PSBwcmVmaXhbaV0pIHsKICAgICAgICByZXR1cm4gZmFsc2U7CiAgICAgIH0KICAgIH0KICAgIHJldHVybiB0cnVlOwogIH0KCiAgLy8gU2VhcmNoIGZvciBhIGJ5dGUgc2VxdWVuY2Ugd2l0aGluIGJ5dGVzOyByZXR1cm5zIGZpcnN0IGluZGV4IG9yIC0xLgogIC8vIFNlYXJjaGVzIGZvcndhcmQgdG8gcHJlZmVyIHRoZSBlYXJsaWVzdCAobW9zdCBsaWtlbHkgY29ycmVjdCkgbWF0Y2guCiAgZnVuY3Rpb24gZmluZEJ5dGVzKGJ5dGVzLCBtYXJrZXIpIHsKICAgIGlmICghYnl0ZXMgfHwgIW1hcmtlciB8fCBtYXJrZXIubGVuZ3RoID09PSAwKSB7CiAgICAgIHJldHVybiAtMTsKICAgIH0KICAgIGZvciAodmFyIGkgPSAwOyBpIDw9IGJ5dGVzLmxlbmd0aCAtIG1hcmtlci5sZW5ndGg7IGkgKz0gMSkgewogICAgICB2YXIgb2sgPSB0cnVlOwogICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG1hcmtlci5sZW5ndGg7IGogKz0gMSkgewogICAgICAgIGlmIChieXRlc1tpICsgal0gIT09IG1hcmtlcltqXSkgewogICAgICAgICAgb2sgPSBmYWxzZTsKICAgICAgICAgIGJyZWFrOwogICAgICAgIH0KICAgICAgfQogICAgICBpZiAob2spIHsKICAgICAgICByZXR1cm4gaTsKICAgICAgfQogICAgfQogICAgcmV0dXJuIC0xOwogIH0KCiAgLy8gVHJ5IHRvIHBhcnNlIGJ5dGVzIGFzIHByb3RvYnVmIGZpZWxkcy4gUmV0dXJucyBmaWVsZHMgYXJyYXkgb3IgbnVsbCBvbiBmYWlsdXJlLgogIGZ1bmN0aW9uIHRyeVBhcnNlRmllbGRzKGJ5dGVzKSB7CiAgICB0cnkgewogICAgICBpZiAoIWJ5dGVzIHx8IGJ5dGVzLmxlbmd0aCA9PT0gMCkgewogICAgICAgIHJldHVybiBudWxsOwogICAgICB9CiAgICAgIHZhciBmaWVsZHMgPSBwYXJzZUZpZWxkcyhieXRlcyk7CiAgICAgIHJldHVybiBmaWVsZHMubGVuZ3RoID4gMCA/IGZpZWxkcyA6IG51bGw7CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQogIH0KCiAgZnVuY3Rpb24gYmluYXJ5U3RyaW5nVG9CeXRlcyh2YWx1ZSkgewogICAgdmFyIG91dCA9IG5ldyBVaW50OEFycmF5KHZhbHVlLmxlbmd0aCk7CiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZhbHVlLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgIG91dFtpXSA9IHZhbHVlLmNoYXJDb2RlQXQoaSkgJiAweGZmOwogICAgfQogICAgcmV0dXJuIG91dDsKICB9CgogIGZ1bmN0aW9uIGJ5dGVzVG9CaW5hcnlTdHJpbmcoYnl0ZXMpIHsKICAgIHZhciBjaHVua1NpemUgPSAweDgwMDA7CiAgICB2YXIgY2h1bmtzID0gW107CiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSBjaHVua1NpemUpIHsKICAgICAgdmFyIGNodW5rID0gYnl0ZXMuc3ViYXJyYXkoaSwgaSArIGNodW5rU2l6ZSk7CiAgICAgIGNodW5rcy5wdXNoKFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoY2h1bmspKSk7CiAgICB9CiAgICByZXR1cm4gY2h1bmtzLmpvaW4oIiIpOwogIH0KCiAgZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NChieXRlcykgewogICAgdmFyIGFscGhhYmV0ID0gIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8iOwogICAgdmFyIG91dCA9ICIiOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMykgewogICAgICB2YXIgYjAgPSBieXRlc1tpXTsKICAgICAgdmFyIGIxID0gaSArIDEgPCBieXRlcy5sZW5ndGggPyBieXRlc1tpICsgMV0gOiAwOwogICAgICB2YXIgYjIgPSBpICsgMiA8IGJ5dGVzLmxlbmd0aCA/IGJ5dGVzW2kgKyAyXSA6IDA7CiAgICAgIHZhciB0cmlwbGV0ID0gKGIwIDw8IDE2KSB8IChiMSA8PCA4KSB8IGIyOwogICAgICBvdXQgKz0gYWxwaGFiZXRbKHRyaXBsZXQgPj4gMTgpICYgMHgzZl07CiAgICAgIG91dCArPSBhbHBoYWJldFsodHJpcGxldCA+PiAxMikgJiAweDNmXTsKICAgICAgb3V0ICs9IGkgKyAxIDwgYnl0ZXMubGVuZ3RoID8gYWxwaGFiZXRbKHRyaXBsZXQgPj4gNikgJiAweDNmXSA6ICI9IjsKICAgICAgb3V0ICs9IGkgKyAyIDwgYnl0ZXMubGVuZ3RoID8gYWxwaGFiZXRbdHJpcGxldCAmIDB4M2ZdIDogIj0iOwogICAgfQogICAgcmV0dXJuIG91dDsKICB9CgogIGZ1bmN0aW9uIGhleFByZXZpZXcoYnl0ZXMsIGxpbWl0KSB7CiAgICBpZiAoIWJ5dGVzKSB7CiAgICAgIHJldHVybiAiPG5vbmU+IjsKICAgIH0KICAgIHZhciBvdXQgPSBbXTsKICAgIHZhciBtYXggPSBNYXRoLm1pbihieXRlcy5sZW5ndGgsIGxpbWl0IHx8IDE2KTsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbWF4OyBpICs9IDEpIHsKICAgICAgb3V0LnB1c2goKCIwIiArIGJ5dGVzW2ldLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpKTsKICAgIH0KICAgIHJldHVybiBvdXQuam9pbigiIik7CiAgfQoKICBmdW5jdGlvbiBib2R5VG9CeXRlcyhib2R5KSB7CiAgICBpZiAoYm9keSA9PSBudWxsKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQogICAgaWYgKGJvZHkgaW5zdGFuY2VvZiBVaW50OEFycmF5KSB7CiAgICAgIHJldHVybiBib2R5OwogICAgfQogICAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gInVuZGVmaW5lZCIgJiYgYm9keSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7CiAgICAgIHJldHVybiBuZXcgVWludDhBcnJheShib2R5KTsKICAgIH0KICAgIGlmICh0eXBlb2YgYm9keSA9PT0gInN0cmluZyIpIHsKICAgICAgcmV0dXJuIGJpbmFyeVN0cmluZ1RvQnl0ZXMoYm9keSk7CiAgICB9CiAgICBpZiAodHlwZW9mIGJvZHkgPT09ICJvYmplY3QiICYmIHR5cGVvZiBib2R5Lmxlbmd0aCA9PT0gIm51bWJlciIpIHsKICAgICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJvZHkpOwogICAgfQogICAgaWYgKHR5cGVvZiBib2R5ID09PSAib2JqZWN0IiAmJiBib2R5LmJ5dGVzICYmIHR5cGVvZiBib2R5LmJ5dGVzLmxlbmd0aCA9PT0gIm51bWJlciIpIHsKICAgICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJvZHkuYnl0ZXMpOwogICAgfQogICAgaWYgKHR5cGVvZiBib2R5ID09PSAib2JqZWN0IiAmJiBib2R5LmRhdGEgJiYgdHlwZW9mIGJvZHkuZGF0YS5sZW5ndGggPT09ICJudW1iZXIiKSB7CiAgICAgIHJldHVybiBuZXcgVWludDhBcnJheShib2R5LmRhdGEpOwogICAgfQogICAgcmV0dXJuIG51bGw7CiAgfQoKICBmdW5jdGlvbiBtZXNzYWdlQm9keVRvQnl0ZXMobWVzc2FnZSkgewogICAgaWYgKCFtZXNzYWdlKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQogICAgcmV0dXJuICgKICAgICAgYm9keVRvQnl0ZXMobWVzc2FnZS5ib2R5Qnl0ZXMpIHx8CiAgICAgIGJvZHlUb0J5dGVzKG1lc3NhZ2UuYm9keSkgfHwKICAgICAgYm9keVRvQnl0ZXMobWVzc2FnZS5yYXdCb2R5KSB8fAogICAgICBib2R5VG9CeXRlcyhtZXNzYWdlLmJpbmFyeUJvZHkpCiAgICApOwogIH0KCiAgZnVuY3Rpb24gcmVhZFVJbnQxNkJFKGJ5dGVzLCBvZmZzZXQpIHsKICAgIGlmIChvZmZzZXQgKyAyID4gYnl0ZXMubGVuZ3RoKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigidWludDE2IG91dCBvZiByYW5nZSIpOwogICAgfQogICAgcmV0dXJuIChieXRlc1tvZmZzZXRdIDw8IDgpIHwgYnl0ZXNbb2Zmc2V0ICsgMV07CiAgfQoKICBmdW5jdGlvbiByZWFkVUludDMyQkUoYnl0ZXMsIG9mZnNldCkgewogICAgaWYgKG9mZnNldCArIDQgPiBieXRlcy5sZW5ndGgpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKCJ1aW50MzIgb3V0IG9mIHJhbmdlIik7CiAgICB9CiAgICByZXR1cm4gKAogICAgICAoYnl0ZXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgKwogICAgICAoKGJ5dGVzW29mZnNldCArIDFdIDw8IDE2KSB8IChieXRlc1tvZmZzZXQgKyAyXSA8PCA4KSB8IGJ5dGVzW29mZnNldCArIDNdKQogICAgKSA+Pj4gMDsKICB9CgogIGZ1bmN0aW9uIHdyaXRlVUludDE2QkUodmFsdWUpIHsKICAgIGlmICh2YWx1ZSA8IDAgfHwgdmFsdWUgPiAweGZmZmYpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKCJ1aW50MTYgdmFsdWUgb3V0IG9mIHJhbmdlOiAiICsgdmFsdWUpOwogICAgfQogICAgcmV0dXJuIGJ5dGVzRnJvbUFycmF5KFsodmFsdWUgPj4gOCkgJiAweGZmLCB2YWx1ZSAmIDB4ZmZdKTsKICB9CgogIGZ1bmN0aW9uIHdyaXRlVUludDMyQkUodmFsdWUpIHsKICAgIHJldHVybiBieXRlc0Zyb21BcnJheShbCiAgICAgICh2YWx1ZSA+Pj4gMjQpICYgMHhmZiwKICAgICAgKHZhbHVlID4+PiAxNikgJiAweGZmLAogICAgICAodmFsdWUgPj4+IDgpICYgMHhmZiwKICAgICAgdmFsdWUgJiAweGZmCiAgICBdKTsKICB9CgogIGZ1bmN0aW9uIGFzY2lpQnl0ZXModmFsdWUpIHsKICAgIHZhciBvdXQgPSBuZXcgVWludDhBcnJheSh2YWx1ZS5sZW5ndGgpOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkgKz0gMSkgewogICAgICBvdXRbaV0gPSB2YWx1ZS5jaGFyQ29kZUF0KGkpICYgMHg3ZjsKICAgIH0KICAgIHJldHVybiBvdXQ7CiAgfQoKICBmdW5jdGlvbiBlbmNvZGVWYXJpbnRVbnNpZ25lZCh2YWx1ZSkgewogICAgdmFyIHYgPSB0eXBlb2YgdmFsdWUgPT09ICJiaWdpbnQiID8gdmFsdWUgOiBCaWdJbnQodmFsdWUpOwogICAgaWYgKHYgPCAwbikgewogICAgICB0aHJvdyBuZXcgRXJyb3IoIm5lZ2F0aXZlIHVuc2lnbmVkIHZhcmludCIpOwogICAgfQoKICAgIHZhciBvdXQgPSBbXTsKICAgIHdoaWxlICh2ID49IDB4ODBuKSB7CiAgICAgIG91dC5wdXNoKE51bWJlcigodiAmIDB4N2ZuKSB8IDB4ODBuKSk7CiAgICAgIHYgPj49IDduOwogICAgfQogICAgb3V0LnB1c2goTnVtYmVyKHYpKTsKICAgIHJldHVybiBieXRlc0Zyb21BcnJheShvdXQpOwogIH0KCiAgZnVuY3Rpb24gZW5jb2RlVmFyaW50U2lnbmVkSW50NjQodmFsdWUpIHsKICAgIHZhciB2ID0gdHlwZW9mIHZhbHVlID09PSAiYmlnaW50IiA/IHZhbHVlIDogQmlnSW50KE1hdGgudHJ1bmModmFsdWUpKTsKICAgIGlmICh2IDwgMG4pIHsKICAgICAgdiA9IEJpZ0ludC5hc1VpbnROKDY0LCB2KTsKICAgIH0KICAgIHJldHVybiBlbmNvZGVWYXJpbnRVbnNpZ25lZCh2KTsKICB9CgogIGZ1bmN0aW9uIGRlY29kZVZhcmludChieXRlcywgb2Zmc2V0KSB7CiAgICB2YXIgcmVzdWx0ID0gMG47CiAgICB2YXIgc2hpZnQgPSAwbjsKICAgIHZhciBjdXJyZW50ID0gb2Zmc2V0OwoKICAgIHdoaWxlIChjdXJyZW50IDwgYnl0ZXMubGVuZ3RoKSB7CiAgICAgIHZhciBiID0gYnl0ZXNbY3VycmVudF07CiAgICAgIGN1cnJlbnQgKz0gMTsKICAgICAgcmVzdWx0IHw9IEJpZ0ludChiICYgMHg3ZikgPDwgc2hpZnQ7CiAgICAgIGlmICgoYiAmIDB4ODApID09PSAwKSB7CiAgICAgICAgcmV0dXJuIHsgdmFsdWU6IHJlc3VsdCwgb2Zmc2V0OiBjdXJyZW50IH07CiAgICAgIH0KICAgICAgc2hpZnQgKz0gN247CiAgICAgIGlmIChzaGlmdCA+IDcwbikgewogICAgICAgIHRocm93IG5ldyBFcnJvcigidmFyaW50IHRvbyBsb25nIik7CiAgICAgIH0KICAgIH0KCiAgICB0aHJvdyBuZXcgRXJyb3IoInVudGVybWluYXRlZCB2YXJpbnQiKTsKICB9CgogIGZ1bmN0aW9uIG1ha2VLZXkoZmllbGROdW1iZXIsIHdpcmVUeXBlKSB7CiAgICByZXR1cm4gZW5jb2RlVmFyaW50VW5zaWduZWQoKEJpZ0ludChmaWVsZE51bWJlcikgPDwgM24pIHwgQmlnSW50KHdpcmVUeXBlKSk7CiAgfQoKICBmdW5jdGlvbiBtYWtlVmFyaW50RmllbGQoZmllbGROdW1iZXIsIHZhbHVlKSB7CiAgICByZXR1cm4gY29uY2F0Qnl0ZXMoW21ha2VLZXkoZmllbGROdW1iZXIsIDApLCBlbmNvZGVWYXJpbnRTaWduZWRJbnQ2NCh2YWx1ZSldKTsKICB9CgogIGZ1bmN0aW9uIG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZChmaWVsZE51bWJlciwgcGF5bG9hZCkgewogICAgcmV0dXJuIGNvbmNhdEJ5dGVzKFttYWtlS2V5KGZpZWxkTnVtYmVyLCAyKSwgZW5jb2RlVmFyaW50VW5zaWduZWQocGF5bG9hZC5sZW5ndGgpLCBwYXlsb2FkXSk7CiAgfQoKICBmdW5jdGlvbiBwYXJzZUZpZWxkcyhieXRlcykgewogICAgdmFyIGZpZWxkcyA9IFtdOwogICAgdmFyIG9mZnNldCA9IDA7CgogICAgd2hpbGUgKG9mZnNldCA8IGJ5dGVzLmxlbmd0aCkgewogICAgICB2YXIga2V5U3RhcnQgPSBvZmZzZXQ7CiAgICAgIHZhciBrZXkgPSBkZWNvZGVWYXJpbnQoYnl0ZXMsIG9mZnNldCk7CiAgICAgIG9mZnNldCA9IGtleS5vZmZzZXQ7CgogICAgICB2YXIgZmllbGROdW1iZXIgPSBOdW1iZXIoa2V5LnZhbHVlID4+IDNuKTsKICAgICAgdmFyIHdpcmVUeXBlID0gTnVtYmVyKGtleS52YWx1ZSAmIDB4N24pOwogICAgICBpZiAoZmllbGROdW1iZXIgPT09IDApIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoInByb3RvYnVmIGZpZWxkIG51bWJlciAwIik7CiAgICAgIH0KCiAgICAgIHZhciB2YWx1ZVN0YXJ0ID0gb2Zmc2V0OwogICAgICB2YXIgdmFsdWVFbmQ7CiAgICAgIGlmICh3aXJlVHlwZSA9PT0gMCkgewogICAgICAgIHZhbHVlRW5kID0gZGVjb2RlVmFyaW50KGJ5dGVzLCBvZmZzZXQpLm9mZnNldDsKICAgICAgfSBlbHNlIGlmICh3aXJlVHlwZSA9PT0gMSkgewogICAgICAgIHZhbHVlRW5kID0gb2Zmc2V0ICsgODsKICAgICAgfSBlbHNlIGlmICh3aXJlVHlwZSA9PT0gMikgewogICAgICAgIHZhciBsZW5ndGhJbmZvID0gZGVjb2RlVmFyaW50KGJ5dGVzLCBvZmZzZXQpOwogICAgICAgIHZhciBsZW5ndGggPSBOdW1iZXIobGVuZ3RoSW5mby52YWx1ZSk7CiAgICAgICAgdmFsdWVTdGFydCA9IGxlbmd0aEluZm8ub2Zmc2V0OwogICAgICAgIHZhbHVlRW5kID0gdmFsdWVTdGFydCArIGxlbmd0aDsKICAgICAgfSBlbHNlIGlmICh3aXJlVHlwZSA9PT0gNSkgewogICAgICAgIHZhbHVlRW5kID0gb2Zmc2V0ICsgNDsKICAgICAgfSBlbHNlIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoInVuc3VwcG9ydGVkIHByb3RvYnVmIHdpcmUgdHlwZTogIiArIHdpcmVUeXBlKTsKICAgICAgfQoKICAgICAgaWYgKHZhbHVlRW5kID4gYnl0ZXMubGVuZ3RoKSB7CiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCJwcm90b2J1ZiBmaWVsZCBleGNlZWRzIGJ1ZmZlciIpOwogICAgICB9CgogICAgICBmaWVsZHMucHVzaCh7CiAgICAgICAgZmllbGROdW1iZXI6IGZpZWxkTnVtYmVyLAogICAgICAgIHdpcmVUeXBlOiB3aXJlVHlwZSwKICAgICAgICBrZXlTdGFydDoga2V5U3RhcnQsCiAgICAgICAgdmFsdWVTdGFydDogdmFsdWVTdGFydCwKICAgICAgICB2YWx1ZUVuZDogdmFsdWVFbmQsCiAgICAgICAgZW5kOiB2YWx1ZUVuZCwKICAgICAgICByYXc6IGJ5dGVzLnNsaWNlKGtleVN0YXJ0LCB2YWx1ZUVuZCksCiAgICAgICAgdmFsdWVCeXRlczogYnl0ZXMuc2xpY2UodmFsdWVTdGFydCwgdmFsdWVFbmQpCiAgICAgIH0pOwogICAgICBvZmZzZXQgPSB2YWx1ZUVuZDsKICAgIH0KCiAgICByZXR1cm4gZmllbGRzOwogIH0KCiAgZnVuY3Rpb24gZmlyc3RGaWVsZEJ5TnVtYmVyKGZpZWxkcywgZmllbGROdW1iZXIpIHsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmllbGRzLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgIGlmIChmaWVsZHNbaV0uZmllbGROdW1iZXIgPT09IGZpZWxkTnVtYmVyKSB7CiAgICAgICAgcmV0dXJuIGZpZWxkc1tpXTsKICAgICAgfQogICAgfQogICAgcmV0dXJuIG51bGw7CiAgfQoKICBmdW5jdGlvbiBzaWduZWRWYXJpbnRGaWVsZFZhbHVlKGZpZWxkKSB7CiAgICBpZiAoIWZpZWxkIHx8IGZpZWxkLndpcmVUeXBlICE9PSAwKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQogICAgcmV0dXJuIEJpZ0ludC5hc0ludE4oNjQsIGRlY29kZVZhcmludChmaWVsZC52YWx1ZUJ5dGVzLCAwKS52YWx1ZSk7CiAgfQoKICBmdW5jdGlvbiBsb2NhdGlvblN1bW1hcnkobG9jYXRpb25QYXlsb2FkKSB7CiAgICB0cnkgewogICAgICB2YXIgZmllbGRzID0gcGFyc2VGaWVsZHMobG9jYXRpb25QYXlsb2FkKTsKICAgICAgdmFyIGxhdCA9IHNpZ25lZFZhcmludEZpZWxkVmFsdWUoZmlyc3RGaWVsZEJ5TnVtYmVyKGZpZWxkcywgMSkpOwogICAgICB2YXIgbG9uID0gc2lnbmVkVmFyaW50RmllbGRWYWx1ZShmaXJzdEZpZWxkQnlOdW1iZXIoZmllbGRzLCAyKSk7CiAgICAgIGlmIChsYXQgPT0gbnVsbCB8fCBsb24gPT0gbnVsbCkgewogICAgICAgIHJldHVybiAiPG1pc3Npbmc+IjsKICAgICAgfQogICAgICByZXR1cm4gKE51bWJlcihsYXQpIC8gMTAwMDAwMDAwKS50b0ZpeGVkKDgpICsgIiwiICsgKE51bWJlcihsb24pIC8gMTAwMDAwMDAwKS50b0ZpeGVkKDgpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIHJldHVybiAiPHBhcnNlLWZhaWxlZDoiICsgZXJyLm1lc3NhZ2UgKyAiPiI7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBwYXRjaGVkUGF5bG9hZFN1bW1hcnkocGF5bG9hZCkgewogICAgdHJ5IHsKICAgICAgdmFyIHJvb3RGaWVsZHMgPSBwYXJzZUZpZWxkcyhwYXlsb2FkKTsKICAgICAgdmFyIHBhcnRzID0gW107CiAgICAgIHZhciB3aWZpID0gZmlyc3RGaWVsZEJ5TnVtYmVyKHJvb3RGaWVsZHMsIDIpOwogICAgICBpZiAod2lmaSAmJiB3aWZpLndpcmVUeXBlID09PSAyKSB7CiAgICAgICAgdmFyIHdpZmlMb2NhdGlvbiA9IGZpcnN0RmllbGRCeU51bWJlcihwYXJzZUZpZWxkcyh3aWZpLnZhbHVlQnl0ZXMpLCAyKTsKICAgICAgICBwYXJ0cy5wdXNoKCJmaXJzdFdpZmk9IiArICh3aWZpTG9jYXRpb24gPyBsb2NhdGlvblN1bW1hcnkod2lmaUxvY2F0aW9uLnZhbHVlQnl0ZXMpIDogIjxtaXNzaW5nPiIpKTsKICAgICAgfQogICAgICB2YXIgY2VsbCA9IGZpcnN0Q2VsbFJlc3BvbnNlRmllbGQocm9vdEZpZWxkcyk7CiAgICAgIGlmIChjZWxsICYmIGNlbGwud2lyZVR5cGUgPT09IDIpIHsKICAgICAgICB2YXIgY2VsbExvY2F0aW9uID0gZmlyc3RGaWVsZEJ5TnVtYmVyKHBhcnNlRmllbGRzKGNlbGwudmFsdWVCeXRlcyksIDUpOwogICAgICAgIHBhcnRzLnB1c2goImZpcnN0Q2VsbD0iICsgKGNlbGxMb2NhdGlvbiA/IGxvY2F0aW9uU3VtbWFyeShjZWxsTG9jYXRpb24udmFsdWVCeXRlcykgOiAiPG1pc3Npbmc+IikpOwogICAgICB9CiAgICAgIHJldHVybiBwYXJ0cy5sZW5ndGggPyBwYXJ0cy5qb2luKCIsICIpIDogIm5vIHdpZmkvY2VsbCBsb2NhdGlvbiBmaWVsZHMiOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIHJldHVybiAic3VtbWFyeSBmYWlsZWQ6ICIgKyBlcnIubWVzc2FnZTsKICAgIH0KICB9CgogIGZ1bmN0aW9uIGlzQ2VsbFJlc3BvbnNlRmllbGQoZmllbGROdW1iZXIpIHsKICAgIHJldHVybiBDRUxMX1JFU1BPTlNFX0ZJRUxEU1tmaWVsZE51bWJlcl0gPT09IHRydWU7CiAgfQoKICBmdW5jdGlvbiBmaXJzdENlbGxSZXNwb25zZUZpZWxkKGZpZWxkcykgewogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWVsZHMubGVuZ3RoOyBpICs9IDEpIHsKICAgICAgaWYgKGlzQ2VsbFJlc3BvbnNlRmllbGQoZmllbGRzW2ldLmZpZWxkTnVtYmVyKSkgewogICAgICAgIHJldHVybiBmaWVsZHNbaV07CiAgICAgIH0KICAgIH0KICAgIHJldHVybiBudWxsOwogIH0KCiAgZnVuY3Rpb24gY29vcmRUb0ludCh2YWx1ZSkgewogICAgLy8g5L2/55SoIE1hdGgudHJ1bmMg57K+56Gu5Yy56YWNIEdvOiBpbnQ2NChjb29yZCAqIDFlOCkKICAgIHJldHVybiBNYXRoLnRydW5jKE51bWJlcih2YWx1ZSkgKiAxMDAwMDAwMDApOwogIH0KCiAgZnVuY3Rpb24gcGFyc2VCb29sZWFuKHZhbHVlLCBkZWZhdWx0VmFsdWUpIHsKICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSB8fCB2YWx1ZSA9PT0gZmFsc2UpIHsKICAgICAgcmV0dXJuIHZhbHVlOwogICAgfQogICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gInN0cmluZyIpIHsKICAgICAgdmFyIG5vcm1hbGl6ZWQgPSB2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKTsKICAgICAgaWYgKG5vcm1hbGl6ZWQgPT09ICJ0cnVlIiB8fCBub3JtYWxpemVkID09PSAiMSIgfHwgbm9ybWFsaXplZCA9PT0gInllcyIgfHwgbm9ybWFsaXplZCA9PT0gIm9uIikgewogICAgICAgIHJldHVybiB0cnVlOwogICAgICB9CiAgICAgIGlmIChub3JtYWxpemVkID09PSAiZmFsc2UiIHx8IG5vcm1hbGl6ZWQgPT09ICIwIiB8fCBub3JtYWxpemVkID09PSAibm8iIHx8IG5vcm1hbGl6ZWQgPT09ICJvZmYiKSB7CiAgICAgICAgcmV0dXJuIGZhbHNlOwogICAgICB9CiAgICB9CiAgICByZXR1cm4gZGVmYXVsdFZhbHVlOwogIH0KCiAgZnVuY3Rpb24gbm9ybWFsaXplQ29uZmlnKGlucHV0KSB7CiAgICB2YXIgY2ZnID0ge307CiAgICB2YXIga2V5OwogICAgZm9yIChrZXkgaW4gREVGQVVMVF9DT05GSUcpIHsKICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChERUZBVUxUX0NPTkZJRywga2V5KSkgewogICAgICAgIGNmZ1trZXldID0gREVGQVVMVF9DT05GSUdba2V5XTsKICAgICAgfQogICAgfQogICAgaW5wdXQgPSBpbnB1dCB8fCB7fTsKICAgIGZvciAoa2V5IGluIGlucHV0KSB7CiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaW5wdXQsIGtleSkpIHsKICAgICAgICBjZmdba2V5XSA9IGlucHV0W2tleV07CiAgICAgIH0KICAgIH0KCiAgICBjZmcuZW5hYmxlZCA9IHBhcnNlQm9vbGVhbihjZmcuZW5hYmxlZCwgdHJ1ZSk7CiAgICBjZmcuZmFpbE9wZW4gPSBwYXJzZUJvb2xlYW4oY2ZnLmZhaWxPcGVuLCB0cnVlKTsKICAgIHZhciBtb2RlID0gU3RyaW5nKGNmZy5tb2RlIHx8ICJyZXNwb25zZSIpLnRvTG93ZXJDYXNlKCk7CiAgICBjZmcubW9kZSA9IG1vZGUgPT09ICJyZXF1ZXN0IiB8fCBtb2RlID09PSAicHJlcGFyZSIgfHwgbW9kZSA9PT0gInByb2JlIiB8fCBtb2RlID09PSAiaW5zcGVjdCIgPyBtb2RlIDogInJlc3BvbnNlIjsKICAgIGNmZy5sYXRpdHVkZSA9IE51bWJlcihjZmcubGF0aXR1ZGUpOwogICAgY2ZnLmxvbmdpdHVkZSA9IE51bWJlcihjZmcubG9uZ2l0dWRlKTsKICAgIGNmZy5ob3Jpem9udGFsQWNjdXJhY3kgPSBNYXRoLnRydW5jKE51bWJlcihjZmcuaG9yaXpvbnRhbEFjY3VyYWN5KSk7CiAgICBjZmcudmVydGljYWxBY2N1cmFjeSA9IE1hdGgudHJ1bmMoTnVtYmVyKGNmZy52ZXJ0aWNhbEFjY3VyYWN5KSk7CiAgICBjZmcuYWx0aXR1ZGUgPSBNYXRoLnRydW5jKE51bWJlcihjZmcuYWx0aXR1ZGUpKTsKICAgIGNmZy51bmtub3duVmFsdWU0ID0gTWF0aC50cnVuYyhOdW1iZXIoY2ZnLnVua25vd25WYWx1ZTQpKTsKICAgIGNmZy5tb3Rpb25BY3Rpdml0eVR5cGUgPSBNYXRoLnRydW5jKE51bWJlcihjZmcubW90aW9uQWN0aXZpdHlUeXBlKSk7CiAgICBjZmcubW90aW9uQWN0aXZpdHlDb25maWRlbmNlID0gTWF0aC50cnVuYyhOdW1iZXIoY2ZnLm1vdGlvbkFjdGl2aXR5Q29uZmlkZW5jZSkpOwogICAgY2ZnLmR1bXBSYXcgPSBjZmcuZHVtcFJhdyA9PT0gdHJ1ZSB8fCBTdHJpbmcoY2ZnLmR1bXBSYXcpLnRvTG93ZXJDYXNlKCkgPT09ICJ0cnVlIjsKICAgIGNmZy5kdW1wSGVhZGVycyA9IGNmZy5kdW1wSGVhZGVycyA9PT0gdHJ1ZSB8fCBTdHJpbmcoY2ZnLmR1bXBIZWFkZXJzKS50b0xvd2VyQ2FzZSgpID09PSAidHJ1ZSI7CiAgICBjZmcucHJlcGFyZUhlYWRlcnMgPSBjZmcucHJlcGFyZUhlYWRlcnMgPT09IHRydWUgfHwgU3RyaW5nKGNmZy5wcmVwYXJlSGVhZGVycykudG9Mb3dlckNhc2UoKSA9PT0gInRydWUiOwogICAgY2ZnLnJhd0xpbWl0ID0gTWF0aC50cnVuYyhOdW1iZXIoY2ZnLnJhd0xpbWl0IHx8IDApKTsKICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGNmZy5yYXdMaW1pdCkgfHwgY2ZnLnJhd0xpbWl0IDwgMCkgewogICAgICBjZmcucmF3TGltaXQgPSAwOwogICAgfQoKICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGNmZy5sYXRpdHVkZSkgfHwgY2ZnLmxhdGl0dWRlIDwgLTkwIHx8IGNmZy5sYXRpdHVkZSA+IDkwKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigiaW52YWxpZCBsYXRpdHVkZSIpOwogICAgfQogICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoY2ZnLmxvbmdpdHVkZSkgfHwgY2ZnLmxvbmdpdHVkZSA8IC0xODAgfHwgY2ZnLmxvbmdpdHVkZSA+IDE4MCkgewogICAgICB0aHJvdyBuZXcgRXJyb3IoImludmFsaWQgbG9uZ2l0dWRlIik7CiAgICB9CiAgICByZXR1cm4gY2ZnOwogIH0KCiAgZnVuY3Rpb24gcGF0Y2hMb2NhdGlvbihsb2NhdGlvblBheWxvYWQsIGNvbmZpZykgewogICAgdmFyIHBhcnRzID0gW107CiAgICB2YXIgZmllbGRzID0gbG9jYXRpb25QYXlsb2FkLmxlbmd0aCA/IHBhcnNlRmllbGRzKGxvY2F0aW9uUGF5bG9hZCkgOiBbXTsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmllbGRzLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgIGlmICghTE9DQVRJT05fUkVQTEFDRURfRklFTERTW2ZpZWxkc1tpXS5maWVsZE51bWJlcl0pIHsKICAgICAgICBwYXJ0cy5wdXNoKGZpZWxkc1tpXS5yYXcpOwogICAgICB9CiAgICB9CgogICAgcGFydHMucHVzaChtYWtlVmFyaW50RmllbGQoMSwgY29vcmRUb0ludChjb25maWcubGF0aXR1ZGUpKSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCgyLCBjb29yZFRvSW50KGNvbmZpZy5sb25naXR1ZGUpKSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCgzLCBjb25maWcuaG9yaXpvbnRhbEFjY3VyYWN5KSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCg0LCBjb25maWcudW5rbm93blZhbHVlNCkpOwogICAgcGFydHMucHVzaChtYWtlVmFyaW50RmllbGQoNSwgY29uZmlnLmFsdGl0dWRlKSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCg2LCBjb25maWcudmVydGljYWxBY2N1cmFjeSkpOwogICAgcGFydHMucHVzaChtYWtlVmFyaW50RmllbGQoMTEsIGNvbmZpZy5tb3Rpb25BY3Rpdml0eVR5cGUpKTsKICAgIHBhcnRzLnB1c2gobWFrZVZhcmludEZpZWxkKDEyLCBjb25maWcubW90aW9uQWN0aXZpdHlDb25maWRlbmNlKSk7CiAgICByZXR1cm4gY29uY2F0Qnl0ZXMocGFydHMpOwogIH0KCiAgZnVuY3Rpb24gcGF0Y2hXaWZpRGV2aWNlKHdpZmlQYXlsb2FkLCBjb25maWcpIHsKICAgIHZhciBmaWVsZHMgPSBwYXJzZUZpZWxkcyh3aWZpUGF5bG9hZCk7CiAgICB2YXIgcGFydHMgPSBbXTsKICAgIHZhciBwYXRjaGVkTG9jYXRpb24gPSBmYWxzZTsKCiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZpZWxkcy5sZW5ndGg7IGkgKz0gMSkgewogICAgICB2YXIgZmllbGQgPSBmaWVsZHNbaV07CiAgICAgIGlmIChmaWVsZC5maWVsZE51bWJlciA9PT0gMiAmJiBmaWVsZC53aXJlVHlwZSA9PT0gMikgewogICAgICAgIHBhcnRzLnB1c2gobWFrZUxlbmd0aERlbGltaXRlZEZpZWxkKDIsIHBhdGNoTG9jYXRpb24oZmllbGQudmFsdWVCeXRlcywgY29uZmlnKSkpOwogICAgICAgIHBhdGNoZWRMb2NhdGlvbiA9IHRydWU7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgcGFydHMucHVzaChmaWVsZC5yYXcpOwogICAgICB9CiAgICB9CgogICAgaWYgKCFwYXRjaGVkTG9jYXRpb24pIHsKICAgICAgcGFydHMucHVzaChtYWtlTGVuZ3RoRGVsaW1pdGVkRmllbGQoMiwgcGF0Y2hMb2NhdGlvbihieXRlc0Zyb21BcnJheShbXSksIGNvbmZpZykpKTsKICAgIH0KCiAgICByZXR1cm4gY29uY2F0Qnl0ZXMocGFydHMpOwogIH0KCiAgZnVuY3Rpb24gcGF0Y2hDZWxsVG93ZXIoY2VsbFBheWxvYWQsIGNvbmZpZykgewogICAgdmFyIGZpZWxkcyA9IHBhcnNlRmllbGRzKGNlbGxQYXlsb2FkKTsKICAgIHZhciBwYXJ0cyA9IFtdOwogICAgdmFyIHBhdGNoZWRMb2NhdGlvbiA9IGZhbHNlOwoKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmllbGRzLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgIHZhciBmaWVsZCA9IGZpZWxkc1tpXTsKICAgICAgaWYgKGZpZWxkLmZpZWxkTnVtYmVyID09PSA1ICYmIGZpZWxkLndpcmVUeXBlID09PSAyKSB7CiAgICAgICAgcGFydHMucHVzaChtYWtlTGVuZ3RoRGVsaW1pdGVkRmllbGQoNSwgcGF0Y2hMb2NhdGlvbihmaWVsZC52YWx1ZUJ5dGVzLCBjb25maWcpKSk7CiAgICAgICAgcGF0Y2hlZExvY2F0aW9uID0gdHJ1ZTsKICAgICAgfSBlbHNlIHsKICAgICAgICBwYXJ0cy5wdXNoKGZpZWxkLnJhdyk7CiAgICAgIH0KICAgIH0KCiAgICBpZiAoIXBhdGNoZWRMb2NhdGlvbikgewogICAgICBwYXJ0cy5wdXNoKG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZCg1LCBwYXRjaExvY2F0aW9uKGJ5dGVzRnJvbUFycmF5KFtdKSwgY29uZmlnKSkpOwogICAgfQoKICAgIHJldHVybiBjb25jYXRCeXRlcyhwYXJ0cyk7CiAgfQoKICBmdW5jdGlvbiBwYXRjaEFwcGxlV0xvY1BheWxvYWQocGF5bG9hZCwgY29uZmlnKSB7CiAgICB2YXIgZmllbGRzID0gcGFyc2VGaWVsZHMocGF5bG9hZCk7CiAgICB2YXIgcGFydHMgPSBbXTsKICAgIHZhciB3aWZpQ291bnQgPSAwOwogICAgdmFyIGNlbGxDb3VudCA9IDA7CgogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWVsZHMubGVuZ3RoOyBpICs9IDEpIHsKICAgICAgdmFyIGZpZWxkID0gZmllbGRzW2ldOwogICAgICBpZiAoZmllbGQuZmllbGROdW1iZXIgPT09IDIgJiYgZmllbGQud2lyZVR5cGUgPT09IDIpIHsKICAgICAgICBwYXJ0cy5wdXNoKG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZCgyLCBwYXRjaFdpZmlEZXZpY2UoZmllbGQudmFsdWVCeXRlcywgY29uZmlnKSkpOwogICAgICAgIHdpZmlDb3VudCArPSAxOwogICAgICB9IGVsc2UgaWYgKGlzQ2VsbFJlc3BvbnNlRmllbGQoZmllbGQuZmllbGROdW1iZXIpICYmIGZpZWxkLndpcmVUeXBlID09PSAyKSB7CiAgICAgICAgcGFydHMucHVzaChtYWtlTGVuZ3RoRGVsaW1pdGVkRmllbGQoZmllbGQuZmllbGROdW1iZXIsIHBhdGNoQ2VsbFRvd2VyKGZpZWxkLnZhbHVlQnl0ZXMsIGNvbmZpZykpKTsKICAgICAgICBjZWxsQ291bnQgKz0gMTsKICAgICAgfSBlbHNlIGlmICghUk9PVF9EUk9QX0ZJRUxEU1tmaWVsZC5maWVsZE51bWJlcl0pIHsKICAgICAgICBwYXJ0cy5wdXNoKGZpZWxkLnJhdyk7CiAgICAgIH0KICAgIH0KCiAgICByZXR1cm4geyBwYXlsb2FkOiBjb25jYXRCeXRlcyhwYXJ0cyksIHdpZmlDb3VudDogd2lmaUNvdW50LCBjZWxsQ291bnQ6IGNlbGxDb3VudCB9OwogIH0KCiAgZnVuY3Rpb24gcmVhZFBhc2NhbFN0cmluZyhieXRlcywgc3RhdGUpIHsKICAgIHZhciBsZW5ndGggPSByZWFkVUludDE2QkUoYnl0ZXMsIHN0YXRlLm9mZnNldCk7CiAgICBzdGF0ZS5vZmZzZXQgKz0gMjsKICAgIGlmIChzdGF0ZS5vZmZzZXQgKyBsZW5ndGggPiBieXRlcy5sZW5ndGgpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKCJBUlBDIHBhc2NhbCBzdHJpbmcgZXhjZWVkcyBidWZmZXIiKTsKICAgIH0KCiAgICB2YXIgY2hhcnMgPSBbXTsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHsKICAgICAgY2hhcnMucHVzaChTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW3N0YXRlLm9mZnNldCArIGldKSk7CiAgICB9CiAgICBzdGF0ZS5vZmZzZXQgKz0gbGVuZ3RoOwogICAgcmV0dXJuIGNoYXJzLmpvaW4oIiIpOwogIH0KCiAgZnVuY3Rpb24gd3JpdGVQYXNjYWxTdHJpbmcodmFsdWUpIHsKICAgIHZhciBieXRlcyA9IGFzY2lpQnl0ZXModmFsdWUpOwogICAgcmV0dXJuIGNvbmNhdEJ5dGVzKFt3cml0ZVVJbnQxNkJFKGJ5dGVzLmxlbmd0aCksIGJ5dGVzXSk7CiAgfQoKICBmdW5jdGlvbiBwYXJzZUFycGMoYnl0ZXMpIHsKICAgIHZhciBzdGF0ZSA9IHsgb2Zmc2V0OiAwIH07CiAgICB2YXIgdmVyc2lvbiA9IHJlYWRVSW50MTZCRShieXRlcywgc3RhdGUub2Zmc2V0KTsKICAgIHN0YXRlLm9mZnNldCArPSAyOwogICAgdmFyIGxvY2FsZSA9IHJlYWRQYXNjYWxTdHJpbmcoYnl0ZXMsIHN0YXRlKTsKICAgIHZhciBhcHBJZGVudGlmaWVyID0gcmVhZFBhc2NhbFN0cmluZyhieXRlcywgc3RhdGUpOwogICAgdmFyIG9zVmVyc2lvbiA9IHJlYWRQYXNjYWxTdHJpbmcoYnl0ZXMsIHN0YXRlKTsKICAgIHZhciBmdW5jdGlvbklkID0gcmVhZFVJbnQzMkJFKGJ5dGVzLCBzdGF0ZS5vZmZzZXQpOwogICAgc3RhdGUub2Zmc2V0ICs9IDQ7CiAgICB2YXIgcGF5bG9hZExlbmd0aCA9IHJlYWRVSW50MzJCRShieXRlcywgc3RhdGUub2Zmc2V0KTsKICAgIHN0YXRlLm9mZnNldCArPSA0OwoKICAgIGlmIChzdGF0ZS5vZmZzZXQgKyBwYXlsb2FkTGVuZ3RoID4gYnl0ZXMubGVuZ3RoKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigiQVJQQyBwYXlsb2FkIGV4Y2VlZHMgYnVmZmVyIik7CiAgICB9CgogICAgcmV0dXJuIHsKICAgICAgdmVyc2lvbjogdmVyc2lvbiwKICAgICAgbG9jYWxlOiBsb2NhbGUsCiAgICAgIGFwcElkZW50aWZpZXI6IGFwcElkZW50aWZpZXIsCiAgICAgIG9zVmVyc2lvbjogb3NWZXJzaW9uLAogICAgICBmdW5jdGlvbklkOiBmdW5jdGlvbklkLAogICAgICBwYXlsb2FkOiBieXRlcy5zbGljZShzdGF0ZS5vZmZzZXQsIHN0YXRlLm9mZnNldCArIHBheWxvYWRMZW5ndGgpCiAgICB9OwogIH0KCiAgZnVuY3Rpb24gc2VyaWFsaXplQXJwYyhhcnBjKSB7CiAgICByZXR1cm4gY29uY2F0Qnl0ZXMoWwogICAgICB3cml0ZVVJbnQxNkJFKGFycGMudmVyc2lvbiksCiAgICAgIHdyaXRlUGFzY2FsU3RyaW5nKGFycGMubG9jYWxlKSwKICAgICAgd3JpdGVQYXNjYWxTdHJpbmcoYXJwYy5hcHBJZGVudGlmaWVyKSwKICAgICAgd3JpdGVQYXNjYWxTdHJpbmcoYXJwYy5vc1ZlcnNpb24pLAogICAgICB3cml0ZVVJbnQzMkJFKGFycGMuZnVuY3Rpb25JZCksCiAgICAgIHdyaXRlVUludDMyQkUoYXJwYy5wYXlsb2FkLmxlbmd0aCksCiAgICAgIGFycGMucGF5bG9hZAogICAgXSk7CiAgfQoKICBmdW5jdGlvbiBidWlsZEFwcGxlV0xvY1Jlc3BvbnNlKHBheWxvYWQsIHByZWZpeCkgewogICAgcmV0dXJuIGNvbmNhdEJ5dGVzKFtwcmVmaXggfHwgQVBQTEVfV0xPQ19QUkVGSVgsIHdyaXRlVUludDE2QkUocGF5bG9hZC5sZW5ndGgpLCBwYXlsb2FkXSk7CiAgfQoKICBmdW5jdGlvbiBleHRyYWN0UHJlZml4ZWRBcHBsZVdMb2NQYXlsb2FkKHJlc3BvbnNlQnl0ZXMpIHsKICAgIGlmICghcmVzcG9uc2VCeXRlcyB8fCByZXNwb25zZUJ5dGVzLmxlbmd0aCA8IDEwKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQogICAgaWYgKHJlc3BvbnNlQnl0ZXNbMF0gIT09IDB4MDAgfHwgcmVzcG9uc2VCeXRlc1sxXSAhPT0gMHgwMSkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICAgIGlmIChyZXNwb25zZUJ5dGVzWzZdICE9PSAweDAwIHx8IHJlc3BvbnNlQnl0ZXNbN10gIT09IDB4MDApIHsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgdmFyIHBheWxvYWRMZW5ndGggPSByZWFkVUludDE2QkUocmVzcG9uc2VCeXRlcywgOCk7CiAgICB2YXIgcGF5bG9hZE9mZnNldCA9IDEwOwogICAgaWYgKHBheWxvYWRMZW5ndGggPD0gMCB8fCBwYXlsb2FkT2Zmc2V0ICsgcGF5bG9hZExlbmd0aCA+IHJlc3BvbnNlQnl0ZXMubGVuZ3RoKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAgIHZhciBwYXlsb2FkID0gcmVzcG9uc2VCeXRlcy5zbGljZShwYXlsb2FkT2Zmc2V0LCBwYXlsb2FkT2Zmc2V0ICsgcGF5bG9hZExlbmd0aCk7CiAgICBpZiAodHJ5UGFyc2VGaWVsZHMocGF5bG9hZCkgPT09IG51bGwpIHsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgcmV0dXJuIHsKICAgICAga2luZDogInN5bnRoZXRpYyIsCiAgICAgIHBheWxvYWQ6IHBheWxvYWQsCiAgICAgIHByZWZpeDogcmVzcG9uc2VCeXRlcy5zbGljZSgwLCA4KSwKICAgICAgc3VmZml4OiByZXNwb25zZUJ5dGVzLnNsaWNlKHBheWxvYWRPZmZzZXQgKyBwYXlsb2FkTGVuZ3RoKQogICAgfTsKICB9CgogIC8vIEV4dHJhY3QgdGhlIEFwcGxlV0xvYyBwcm90b2J1ZiBwYXlsb2FkIGZyb20gYSAvY2xscy93bG9jIHJlc3BvbnNlIGJvZHkuCiAgLy8gUmV0dXJucyBhIHR5cGVkIHJlc3VsdDogeyBraW5kLCBwYXlsb2FkLCAuLi4gfSBzbyB0aGUgY2FsbGVyIGNhbiB3cml0ZSBiYWNrCiAgLy8gaW4gdGhlIGNvcnJlY3QgZm9ybWF0LgogIC8vCiAgLy8gU3VwcG9ydGVkIHNoYXBlczoKICAvLyAgICJhcnBjIiAgICAgIOKAkyBGdWxsIEFSUEMgZW52ZWxvcGUgKHNhbWUgZm9ybWF0IGFzIHJlcXVlc3RzKS4gVGhlIHJlYWwgQXBwbGUKICAvLyAgICAgICAgICAgICAgICAgcmVzcG9uc2UgdXNlcyB0aGlzLiBDb250YWlucyBhcnBjIG1ldGFkYXRhIGZvciB3cml0ZS1iYWNrLgogIC8vICAgInN5bnRoZXRpYyIg4oCTIE91ciBvd24gc3Bvb2ZlZCByZXNwb25zZTogQVBQTEVfV0xPQ19QUkVGSVggKDggYnl0ZXMpICsgdWludDE2IGxlbi4KICAvLyAgICJtYXJrZXIiICAgIOKAkyBGYWxsYmFjazogbWFya2VyIHNlYXJjaCAwMCAwMCAwMCAwMSAwMCAwMCArIHVpbnQxNiBsZW4uCiAgLy8gICAgICAgICAgICAgICAgIEtlZXBzIHRoZSBwcmVmaXgvc3VmZml4IGJ5dGVzIGZvciB3cml0ZS1iYWNrLgogIC8vICAgImJhcmUiICAgICAg4oCTIEJhcmUgcHJvdG9idWYgcGF5bG9hZCAoZmllbGQgdGFnIDB4MTIgPSB3aWZpIGRldmljZSwgd2lyZSB0eXBlIDIpLgogIGZ1bmN0aW9uIGV4dHJhY3RBcHBsZVdMb2NQYXlsb2FkKHJlc3BvbnNlQnl0ZXMpIHsKICAgIGlmICghcmVzcG9uc2VCeXRlcyB8fCByZXNwb25zZUJ5dGVzLmxlbmd0aCA8IDIpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKCJBcHBsZSBXTG9jIHJlc3BvbnNlIHRvbyBzaG9ydCIpOwogICAgfQoKICAgIC8vIFNoYXBlIDE6IHByZWZpeGVkIFdMb2MgcmVzcG9uc2UuIFRoZSBvcmlnaW5hbCBHbyBpbXBsZW1lbnRhdGlvbiBlbWl0cwogICAgLy8gMDAwMTAwMDAwMDAxMDAwMCwgd2hpbGUgQXBwbGUncyBsaXZlIHJlc3BvbnNlcyBtYXkgdXNlIDAwMDEwMDAwMDAwMzAwMDAuCiAgICB2YXIgcHJlZml4ZWQgPSBleHRyYWN0UHJlZml4ZWRBcHBsZVdMb2NQYXlsb2FkKHJlc3BvbnNlQnl0ZXMpOwogICAgaWYgKHByZWZpeGVkKSB7CiAgICAgIHJldHVybiBwcmVmaXhlZDsKICAgIH0KCiAgICAvLyBTaGFwZSAyOiBBUlBDIGVudmVsb3BlIOKAkyB0cnkgdGhlIHByb3BlciBzdHJ1Y3R1cmVkIHBhcnNlciBmaXJzdC4KICAgIC8vIFRoZSBBcHBsZSAvY2xscy93bG9jIHJlc3BvbnNlIHVzZXMgdGhlIHNhbWUgQVJQQyBmcmFtaW5nIGFzIHRoZSByZXF1ZXN0LgogICAgdHJ5IHsKICAgICAgdmFyIGFycGMgPSBwYXJzZUFycGMocmVzcG9uc2VCeXRlcyk7CiAgICAgIGlmIChhcnBjLnBheWxvYWQubGVuZ3RoID4gMCAmJiB0cnlQYXJzZUZpZWxkcyhhcnBjLnBheWxvYWQpICE9PSBudWxsKSB7CiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgIGtpbmQ6ICJhcnBjIiwKICAgICAgICAgIHBheWxvYWQ6IGFycGMucGF5bG9hZCwKICAgICAgICAgIGFycGM6IGFycGMKICAgICAgICB9OwogICAgICB9CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIC8vIEFSUEMgcGFyc2UgZmFpbGVkIOKAkyBjb250aW51ZSB3aXRoIGZhbGxiYWNrIHN0cmF0ZWdpZXMuCiAgICB9CgogICAgLy8gU2hhcGUgMzogbWFya2VyIHNlYXJjaCBmYWxsYmFjay4gVGhlIEFSUEMgZnVuY3Rpb25JZCAoMDAgMDAgMDAgMDEpIG1heSBiZQogICAgLy8gZm9sbG93ZWQgYnkgdWludDE2L3VpbnQzMiBwYXlsb2FkIGxlbmd0aC4gVHJ5IHRvIGZpbmQgYW5kIHZhbGlkYXRlLgogICAgdmFyIG1hcmtlcklkeCA9IGZpbmRCeXRlcyhyZXNwb25zZUJ5dGVzLCBBUFBMRV9XTE9DX01BUktFUik7CiAgICBpZiAobWFya2VySWR4ID49IDApIHsKICAgICAgdmFyIGxlbk9mZnNldCA9IG1hcmtlcklkeCArIEFQUExFX1dMT0NfTUFSS0VSLmxlbmd0aDsKICAgICAgaWYgKGxlbk9mZnNldCArIDIgPD0gcmVzcG9uc2VCeXRlcy5sZW5ndGgpIHsKICAgICAgICB2YXIgcmVhbExlbiA9IHJlYWRVSW50MTZCRShyZXNwb25zZUJ5dGVzLCBsZW5PZmZzZXQpOwogICAgICAgIHZhciByZWFsUGF5bG9hZE9mZnNldCA9IGxlbk9mZnNldCArIDI7CiAgICAgICAgaWYgKHJlYWxMZW4gPiAwICYmIHJlYWxQYXlsb2FkT2Zmc2V0ICsgcmVhbExlbiA8PSByZXNwb25zZUJ5dGVzLmxlbmd0aCkgewogICAgICAgICAgdmFyIGNhbmRpZGF0ZVBheWxvYWQgPSByZXNwb25zZUJ5dGVzLnNsaWNlKHJlYWxQYXlsb2FkT2Zmc2V0LCByZWFsUGF5bG9hZE9mZnNldCArIHJlYWxMZW4pOwogICAgICAgICAgLy8gT25seSBhY2NlcHQgaWYgdGhlIGNhbmRpZGF0ZSBwYXJzZXMgYXMgdmFsaWQgcHJvdG9idWYuCiAgICAgICAgICBpZiAodHJ5UGFyc2VGaWVsZHMoY2FuZGlkYXRlUGF5bG9hZCkgIT09IG51bGwpIHsKICAgICAgICAgICAgcmV0dXJuIHsKICAgICAgICAgICAgICBraW5kOiAibWFya2VyIiwKICAgICAgICAgICAgICBwYXlsb2FkOiBjYW5kaWRhdGVQYXlsb2FkLAogICAgICAgICAgICAgIHByZWZpeDogcmVzcG9uc2VCeXRlcy5zbGljZSgwLCBtYXJrZXJJZHgpLAogICAgICAgICAgICAgIG1hcmtlckFuZExlbjogcmVzcG9uc2VCeXRlcy5zbGljZShtYXJrZXJJZHgsIHJlYWxQYXlsb2FkT2Zmc2V0KSwKICAgICAgICAgICAgICBzdWZmaXg6IHJlc3BvbnNlQnl0ZXMuc2xpY2UocmVhbFBheWxvYWRPZmZzZXQgKyByZWFsTGVuKQogICAgICAgICAgICB9OwogICAgICAgICAgfQogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIC8vIFNoYXBlIDQ6IGJhcmUgcHJvdG9idWYgcGF5bG9hZCAoYmVzdCBlZmZvcnQpLgogICAgaWYgKGxvb2tzTGlrZUFwcGxlV0xvY1BheWxvYWQocmVzcG9uc2VCeXRlcykpIHsKICAgICAgcmV0dXJuIHsKICAgICAgICBraW5kOiAiYmFyZSIsCiAgICAgICAgcGF5bG9hZDogcmVzcG9uc2VCeXRlcwogICAgICB9OwogICAgfQoKICAgIHRocm93IG5ldyBFcnJvcigibWlzc2luZyBBcHBsZSBXTG9jIHJlc3BvbnNlIHByZWZpeCIpOwogIH0KCiAgLy8gSGV1cmlzdGljOiBhIHZhbGlkIEFwcGxlV0xvYyBwYXlsb2FkIHN0YXJ0cyB3aXRoIGEgcHJvdG9idWYgdGFnIHdob3NlIHdpcmUgdHlwZQogIC8vIGlzIDAgb3IgMiBhbmQgZmllbGQgbnVtYmVyIGlzID4gMC4gRmllbGQgMiAod2lmaSkgdGFnIGlzIDB4MTIuCiAgZnVuY3Rpb24gbG9va3NMaWtlQXBwbGVXTG9jUGF5bG9hZChieXRlcykgewogICAgaWYgKCFieXRlcyB8fCBieXRlcy5sZW5ndGggPT09IDApIHsKICAgICAgcmV0dXJuIGZhbHNlOwogICAgfQogICAgdmFyIHRhZyA9IGJ5dGVzWzBdOwogICAgdmFyIGZpZWxkTnVtYmVyID0gdGFnID4+IDM7CiAgICB2YXIgd2lyZVR5cGUgPSB0YWcgJiAweDc7CiAgICByZXR1cm4gZmllbGROdW1iZXIgPiAwICYmICh3aXJlVHlwZSA9PT0gMCB8fCB3aXJlVHlwZSA9PT0gMik7CiAgfQoKICBmdW5jdGlvbiBzcG9vZkFycGNSZXF1ZXN0KHJlcXVlc3RCeXRlcywgY29uZmlnSW5wdXQpIHsKICAgIHZhciBjb25maWcgPSBub3JtYWxpemVDb25maWcoY29uZmlnSW5wdXQpOwogICAgdmFyIGFycGMgPSBwYXJzZUFycGMocmVxdWVzdEJ5dGVzKTsKICAgIHZhciBwYXRjaGVkID0gcGF0Y2hBcHBsZVdMb2NQYXlsb2FkKGFycGMucGF5bG9hZCwgY29uZmlnKTsKICAgIHJldHVybiB7CiAgICAgIHJlc3BvbnNlOiBidWlsZEFwcGxlV0xvY1Jlc3BvbnNlKHBhdGNoZWQucGF5bG9hZCksCiAgICAgIHBheWxvYWQ6IHBhdGNoZWQucGF5bG9hZCwKICAgICAgd2lmaUNvdW50OiBwYXRjaGVkLndpZmlDb3VudCwKICAgICAgY2VsbENvdW50OiBwYXRjaGVkLmNlbGxDb3VudCwKICAgICAgYXJwYzogYXJwYwogICAgfTsKICB9CgogIGZ1bmN0aW9uIHNwb29mQXBwbGVSZXNwb25zZShyZXNwb25zZUJ5dGVzLCBjb25maWdJbnB1dCkgewogICAgdmFyIGNvbmZpZyA9IG5vcm1hbGl6ZUNvbmZpZyhjb25maWdJbnB1dCk7CiAgICB2YXIgZXh0cmFjdGlvbiA9IGV4dHJhY3RBcHBsZVdMb2NQYXlsb2FkKHJlc3BvbnNlQnl0ZXMpOwogICAgdmFyIHBhdGNoZWQgPSBwYXRjaEFwcGxlV0xvY1BheWxvYWQoZXh0cmFjdGlvbi5wYXlsb2FkLCBjb25maWcpOwogICAgdmFyIHJlc3BvbnNlOwoKICAgIGlmIChleHRyYWN0aW9uLmtpbmQgPT09ICJhcnBjIikgewogICAgICAvLyBXcml0ZSBiYWNrIGluIEFSUEMgZm9ybWF0LCBwcmVzZXJ2aW5nIHRoZSBvcmlnaW5hbCBlbnZlbG9wZSBtZXRhZGF0YS4KICAgICAgdmFyIGFycGNPdXQgPSB7CiAgICAgICAgdmVyc2lvbjogZXh0cmFjdGlvbi5hcnBjLnZlcnNpb24sCiAgICAgICAgbG9jYWxlOiBleHRyYWN0aW9uLmFycGMubG9jYWxlLAogICAgICAgIGFwcElkZW50aWZpZXI6IGV4dHJhY3Rpb24uYXJwYy5hcHBJZGVudGlmaWVyLAogICAgICAgIG9zVmVyc2lvbjogZXh0cmFjdGlvbi5hcnBjLm9zVmVyc2lvbiwKICAgICAgICBmdW5jdGlvbklkOiBleHRyYWN0aW9uLmFycGMuZnVuY3Rpb25JZCwKICAgICAgICBwYXlsb2FkOiBwYXRjaGVkLnBheWxvYWQKICAgICAgfTsKICAgICAgcmVzcG9uc2UgPSBzZXJpYWxpemVBcnBjKGFycGNPdXQpOwogICAgfSBlbHNlIGlmIChleHRyYWN0aW9uLmtpbmQgPT09ICJtYXJrZXIiKSB7CiAgICAgIC8vIFJlYnVpbGQ6IG9yaWdpbmFsIHByZWZpeCArIG1hcmtlciBieXRlcyArIG5ldyB1aW50MTYgbGVuICsgcGF0Y2hlZCBwYXlsb2FkICsgc3VmZml4LgogICAgICB2YXIgbmV3TGVuQnl0ZXMgPSB3cml0ZVVJbnQxNkJFKHBhdGNoZWQucGF5bG9hZC5sZW5ndGgpOwogICAgICByZXNwb25zZSA9IGNvbmNhdEJ5dGVzKFsKICAgICAgICBleHRyYWN0aW9uLnByZWZpeCwKICAgICAgICBleHRyYWN0aW9uLm1hcmtlckFuZExlbi5zbGljZSgwLCBBUFBMRV9XTE9DX01BUktFUi5sZW5ndGgpLAogICAgICAgIG5ld0xlbkJ5dGVzLAogICAgICAgIHBhdGNoZWQucGF5bG9hZCwKICAgICAgICBleHRyYWN0aW9uLnN1ZmZpeAogICAgICBdKTsKICAgIH0gZWxzZSB7CiAgICAgIC8vIHN5bnRoZXRpYyAvIGJhcmUg4oCTIHVzZSB0aGUgc2ltcGxlIHByZWZpeCBmb3JtYXQuCiAgICAgIHJlc3BvbnNlID0gYnVpbGRBcHBsZVdMb2NSZXNwb25zZShwYXRjaGVkLnBheWxvYWQsIGV4dHJhY3Rpb24ucHJlZml4KTsKICAgIH0KCiAgICByZXR1cm4gewogICAgICByZXNwb25zZTogcmVzcG9uc2UsCiAgICAgIHBheWxvYWQ6IHBhdGNoZWQucGF5bG9hZCwKICAgICAgd2lmaUNvdW50OiBwYXRjaGVkLndpZmlDb3VudCwKICAgICAgY2VsbENvdW50OiBwYXRjaGVkLmNlbGxDb3VudCwKICAgICAga2luZDogZXh0cmFjdGlvbi5raW5kLAogICAgICBwcmVmaXg6IGV4dHJhY3Rpb24ucHJlZml4ID8gaGV4UHJldmlldyhleHRyYWN0aW9uLnByZWZpeCwgOCkgOiAiIgogICAgfTsKICB9CgogIGZ1bmN0aW9uIHBhcnNlQXJndW1lbnRTdHJpbmcoYXJndW1lbnQpIHsKICAgIHZhciByZXN1bHQgPSB7fTsKICAgIGlmICghYXJndW1lbnQgfHwgdHlwZW9mIGFyZ3VtZW50ICE9PSAic3RyaW5nIikgewogICAgICByZXR1cm4gcmVzdWx0OwogICAgfQoKICAgIHZhciB0YWlsS2V5cyA9IFsKICAgICAgImRlYnVnIiwKICAgICAgIm1vZGUiLAogICAgICAiZW5hYmxlZCIsCiAgICAgICJsYXRpdHVkZSIsCiAgICAgICJsb25naXR1ZGUiLAogICAgICAiYWx0aXR1ZGUiLAogICAgICAiYWRkcmVzcyIsCiAgICAgICJjb25maWdIb3N0IiwKICAgICAgImNvbmZpZ1Rva2VuIiwKICAgICAgImhvcml6b250YWxBY2N1cmFjeSIsCiAgICAgICJ2ZXJ0aWNhbEFjY3VyYWN5IiwKICAgICAgInVua25vd25WYWx1ZTQiLAogICAgICAibW90aW9uQWN0aXZpdHlUeXBlIiwKICAgICAgIm1vdGlvbkFjdGl2aXR5Q29uZmlkZW5jZSIsCiAgICAgICJmYWlsT3BlbiIsCiAgICAgICJkdW1wUmF3IiwKICAgICAgImR1bXBIZWFkZXJzIiwKICAgICAgInByZXBhcmVIZWFkZXJzIiwKICAgICAgInJhd0xpbWl0IgogICAgXTsKICAgIHZhciBjb25maWdVcmxLZXkgPSAiY29uZmlnVXJsPSI7CiAgICB2YXIgY29uZmlnVXJsSWR4ID0gYXJndW1lbnQuaW5kZXhPZihjb25maWdVcmxLZXkpOwogICAgaWYgKGNvbmZpZ1VybElkeCA+PSAwKSB7CiAgICAgIHZhciB2YWx1ZVN0YXJ0ID0gY29uZmlnVXJsSWR4ICsgY29uZmlnVXJsS2V5Lmxlbmd0aDsKICAgICAgdmFyIHRhaWwgPSBhcmd1bWVudC5zbGljZSh2YWx1ZVN0YXJ0KTsKICAgICAgdmFyIGVuZCA9IC0xOwogICAgICB2YXIgaTsKICAgICAgZm9yIChpID0gMDsgaSA8IHRhaWxLZXlzLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgICAgdmFyIG1hcmtlciA9ICImIiArIHRhaWxLZXlzW2ldICsgIj0iOwogICAgICAgIHZhciBwb3MgPSB0YWlsLmluZGV4T2YobWFya2VyKTsKICAgICAgICBpZiAocG9zID49IDAgJiYgKGVuZCA8IDAgfHwgcG9zIDwgZW5kKSkgewogICAgICAgICAgZW5kID0gcG9zOwogICAgICAgIH0KICAgICAgfQogICAgICB2YXIgY29uZmlnVXJsVmFsdWUgPSBlbmQgPj0gMCA/IHRhaWwuc2xpY2UoMCwgZW5kKSA6IHRhaWw7CiAgICAgIHRyeSB7CiAgICAgICAgcmVzdWx0LmNvbmZpZ1VybCA9IGRlY29kZVVSSUNvbXBvbmVudChjb25maWdVcmxWYWx1ZSk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIHJlc3VsdC5jb25maWdVcmwgPSBjb25maWdVcmxWYWx1ZTsKICAgICAgfQogICAgICBhcmd1bWVudCA9IGFyZ3VtZW50LnNsaWNlKDAsIGNvbmZpZ1VybElkeCkgKyAoZW5kID49IDAgPyB0YWlsLnNsaWNlKGVuZCArIDEpIDogIiIpOwogICAgfQoKICAgIHZhciBwYWlycyA9IGFyZ3VtZW50LnNwbGl0KC9bJjtdLyk7CiAgICBmb3IgKHZhciBqID0gMDsgaiA8IHBhaXJzLmxlbmd0aDsgaiArPSAxKSB7CiAgICAgIHZhciBwYXJ0ID0gcGFpcnNbal07CiAgICAgIGlmICghcGFydCkgewogICAgICAgIGNvbnRpbnVlOwogICAgICB9CiAgICAgIHZhciBlcSA9IHBhcnQuaW5kZXhPZigiPSIpOwogICAgICB2YXIga2V5ID0gZXEgPj0gMCA/IHBhcnQuc2xpY2UoMCwgZXEpIDogcGFydDsKICAgICAgdmFyIHZhbHVlID0gZXEgPj0gMCA/IHBhcnQuc2xpY2UoZXEgKyAxKSA6ICJ0cnVlIjsKICAgICAgdHJ5IHsKICAgICAgICByZXN1bHRbZGVjb2RlVVJJQ29tcG9uZW50KGtleSldID0gZGVjb2RlVVJJQ29tcG9uZW50KHZhbHVlKTsKICAgICAgfSBjYXRjaCAoZXJyMikgewogICAgICAgIHJlc3VsdFtrZXldID0gdmFsdWU7CiAgICAgIH0KICAgIH0KICAgIHJldHVybiByZXN1bHQ7CiAgfQoKICBmdW5jdGlvbiByZXNvbHZlQ29uZmlnVXJsKGFyZ3MpIHsKICAgIGFyZ3MgPSBhcmdzIHx8IHt9OwogICAgdmFyIGRpcmVjdCA9IFN0cmluZyhhcmdzLmNvbmZpZ1VybCB8fCBhcmdzLmNmZyB8fCBhcmdzLnVybCB8fCAiIikudHJpbSgpOwogICAgaWYgKGRpcmVjdCkgewogICAgICByZXR1cm4gZGlyZWN0OwogICAgfQogICAgdmFyIGhvc3QgPSBTdHJpbmcoYXJncy5jb25maWdIb3N0IHx8ICIiKS50cmltKCkucmVwbGFjZSgvXC8rJC8sICIiKTsKICAgIHZhciB0b2tlbiA9IFN0cmluZyhhcmdzLmNvbmZpZ1Rva2VuIHx8ICIiKS50cmltKCk7CiAgICBpZiAoaG9zdCAmJiB0b2tlbikgewogICAgICByZXR1cm4gaG9zdCArICIvbG9jLmpzb24/dG9rZW49IiArIGVuY29kZVVSSUNvbXBvbmVudCh0b2tlbik7CiAgICB9CiAgICByZXR1cm4gIiI7CiAgfQoKICBmdW5jdGlvbiBpc1BsYWNlaG9sZGVyVmFsdWUodmFsdWUpIHsKICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICJzdHJpbmciICYmIC9eXHtbXn1dK1x9JC8udGVzdCh2YWx1ZS50cmltKCkpOwogIH0KCiAgZnVuY3Rpb24gcmVhZFBsdWdpblN0b3JlQXJnKG5hbWUpIHsKICAgIGlmICh0eXBlb2YgJHBlcnNpc3RlbnRTdG9yZSA9PT0gInVuZGVmaW5lZCIgfHwgISRwZXJzaXN0ZW50U3RvcmUucmVhZCkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICAgIHRyeSB7CiAgICAgIHZhciB2YWx1ZSA9ICRwZXJzaXN0ZW50U3RvcmUucmVhZChuYW1lKTsKICAgICAgaWYgKHZhbHVlID09IG51bGwgfHwgdmFsdWUgPT09ICIiKSB7CiAgICAgICAgcmV0dXJuIG51bGw7CiAgICAgIH0KICAgICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBlbnJpY2hBcmdzRnJvbVBsdWdpblN0b3JlKGFyZ3MpIHsKICAgIHZhciBrZXlzID0gWwogICAgICAiZW5hYmxlZCIsCiAgICAgICJsYXRpdHVkZSIsCiAgICAgICJsb25naXR1ZGUiLAogICAgICAiYWx0aXR1ZGUiLAogICAgICAiaG9yaXpvbnRhbEFjY3VyYWN5IiwKICAgICAgInZlcnRpY2FsQWNjdXJhY3kiLAogICAgICAiYWRkcmVzcyIsCiAgICAgICJjb25maWdIb3N0IiwKICAgICAgImNvbmZpZ1Rva2VuIiwKICAgICAgImNvbmZpZ1VybCIsCiAgICAgICJkZWJ1ZyIKICAgIF07CiAgICB2YXIgaTsKICAgIGFyZ3MgPSBhcmdzIHx8IHt9OwogICAgZm9yIChpID0gMDsgaSA8IGtleXMubGVuZ3RoOyBpICs9IDEpIHsKICAgICAgdmFyIGtleSA9IGtleXNbaV07CiAgICAgIHZhciBjdXJyZW50ID0gYXJnc1trZXldOwogICAgICBpZiAoY3VycmVudCA9PSBudWxsIHx8IGN1cnJlbnQgPT09ICIiIHx8IGlzUGxhY2Vob2xkZXJWYWx1ZShjdXJyZW50KSkgewogICAgICAgIHZhciBzdG9yZWQgPSByZWFkUGx1Z2luU3RvcmVBcmcoa2V5KTsKICAgICAgICBpZiAoc3RvcmVkICE9IG51bGwgJiYgIWlzUGxhY2Vob2xkZXJWYWx1ZShzdG9yZWQpKSB7CiAgICAgICAgICBhcmdzW2tleV0gPSBzdG9yZWQ7CiAgICAgICAgfQogICAgICB9CiAgICB9CiAgICByZXR1cm4gYXJnczsKICB9CgogIGZ1bmN0aW9uIHJlYWRTY3JpcHRBcmd1bWVudHMoKSB7CiAgICB2YXIgb3V0ID0ge307CiAgICBpZiAodHlwZW9mICRhcmd1bWVudCAhPT0gInVuZGVmaW5lZCIgJiYgJGFyZ3VtZW50ICE9IG51bGwpIHsKICAgICAgaWYgKHR5cGVvZiAkYXJndW1lbnQgPT09ICJzdHJpbmciKSB7CiAgICAgICAgb3V0ID0gcGFyc2VBcmd1bWVudFN0cmluZygkYXJndW1lbnQpOwogICAgICB9IGVsc2UgaWYgKHR5cGVvZiAkYXJndW1lbnQgPT09ICJvYmplY3QiKSB7CiAgICAgICAgdmFyIGtleTsKICAgICAgICBmb3IgKGtleSBpbiAkYXJndW1lbnQpIHsKICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoJGFyZ3VtZW50LCBrZXkpKSB7CiAgICAgICAgICAgIHZhciB2YWx1ZSA9ICRhcmd1bWVudFtrZXldOwogICAgICAgICAgICBvdXRba2V5XSA9IHZhbHVlID09IG51bGwgPyAiIiA6IFN0cmluZyh2YWx1ZSk7CiAgICAgICAgICB9CiAgICAgICAgfQogICAgICB9IGVsc2UgewogICAgICAgIG91dCA9IHBhcnNlQXJndW1lbnRTdHJpbmcoU3RyaW5nKCRhcmd1bWVudCkpOwogICAgICB9CiAgICB9CiAgICByZXR1cm4gZW5yaWNoQXJnc0Zyb21QbHVnaW5TdG9yZShvdXQpOwogIH0KCiAgZnVuY3Rpb24gbG9nU2NyaXB0QXJndW1lbnRzKGRlYnVnKSB7CiAgICBpZiAoIWRlYnVnKSB7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHZhciBhcmdzID0gcmVhZFNjcmlwdEFyZ3VtZW50cygpOwogICAgdmFyIHJhdyA9CiAgICAgIHR5cGVvZiAkYXJndW1lbnQgPT09ICJ1bmRlZmluZWQiIHx8ICRhcmd1bWVudCA9PSBudWxsCiAgICAgICAgPyAiPG5vbmU+IgogICAgICAgIDogdHlwZW9mICRhcmd1bWVudCA9PT0gIm9iamVjdCIKICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoJGFyZ3VtZW50KQogICAgICAgICAgOiBTdHJpbmcoJGFyZ3VtZW50KTsKICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyICRhcmd1bWVudCByYXc6ICIgKyByYXcpOwogICAgY29uc29sZS5sb2coCiAgICAgICJMb2NhdGlvbiBzcG9vZmVyIGFyZ3MgcGFyc2VkOiBsYXQ9IiArCiAgICAgICAgYXJncy5sYXRpdHVkZSArCiAgICAgICAgIiwgbG5nPSIgKwogICAgICAgIGFyZ3MubG9uZ2l0dWRlICsKICAgICAgICAiLCBjb25maWdVcmw9IiArCiAgICAgICAgKHJlc29sdmVDb25maWdVcmwoYXJncykgfHwgIjxub25lPiIpCiAgICApOwogIH0KCiAgZnVuY3Rpb24gZGV0ZWN0UnVudGltZSgpIHsKICAgIGlmICh0eXBlb2YgJGVudmlyb25tZW50ICE9PSAidW5kZWZpbmVkIiAmJiAkZW52aXJvbm1lbnQgJiYgJGVudmlyb25tZW50LnByb2R1Y3QpIHsKICAgICAgcmV0dXJuIFN0cmluZygkZW52aXJvbm1lbnQucHJvZHVjdCk7CiAgICB9CiAgICBpZiAodHlwZW9mICRsb29uICE9PSAidW5kZWZpbmVkIikgewogICAgICByZXR1cm4gIkxvb24iOwogICAgfQogICAgcmV0dXJuICJVbmtub3duIjsKICB9CgogIGZ1bmN0aW9uIGlzTG9vblJ1bnRpbWUoKSB7CiAgICByZXR1cm4gZGV0ZWN0UnVudGltZSgpID09PSAiTG9vbiI7CiAgfQoKICBmdW5jdGlvbiBpc0d6aXBCeXRlcyhieXRlcykgewogICAgcmV0dXJuIGJ5dGVzICYmIGJ5dGVzLmxlbmd0aCA+PSAyICYmIGJ5dGVzWzBdID09PSAweDFmICYmIGJ5dGVzWzFdID09PSAweDhiOwogIH0KCiAgZnVuY3Rpb24gcmVhZEdlb2NvZGVDYWNoZSgpIHsKICAgIGlmICh0eXBlb2YgJHBlcnNpc3RlbnRTdG9yZSA9PT0gInVuZGVmaW5lZCIgfHwgISRwZXJzaXN0ZW50U3RvcmUucmVhZCkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICAgIHRyeSB7CiAgICAgIHZhciByYXcgPSAkcGVyc2lzdGVudFN0b3JlLnJlYWQoImxvY2F0aW9uX3Nwb29mZXJfZ2VvY29kZSIpOwogICAgICByZXR1cm4gcmF3ID8gSlNPTi5wYXJzZShyYXcpIDogbnVsbDsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICB9CgogIGZ1bmN0aW9uIHdyaXRlR2VvY29kZUNhY2hlKGVudHJ5KSB7CiAgICBpZiAodHlwZW9mICRwZXJzaXN0ZW50U3RvcmUgPT09ICJ1bmRlZmluZWQiIHx8ICEkcGVyc2lzdGVudFN0b3JlLndyaXRlKSB7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHRyeSB7CiAgICAgICRwZXJzaXN0ZW50U3RvcmUud3JpdGUoImxvY2F0aW9uX3Nwb29mZXJfZ2VvY29kZSIsIEpTT04uc3RyaW5naWZ5KGVudHJ5KSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgLy8gaWdub3JlIGNhY2hlIHdyaXRlIGZhaWx1cmVzCiAgICB9CiAgfQoKICBmdW5jdGlvbiBmZXRjaEVsZXZhdGlvbihsYXQsIGxuZywgY2FsbGJhY2spIHsKICAgIGlmICh0eXBlb2YgJGh0dHBDbGllbnQgPT09ICJ1bmRlZmluZWQiIHx8ICEkaHR0cENsaWVudC5nZXQpIHsKICAgICAgY2FsbGJhY2sobnVsbCk7CiAgICAgIHJldHVybjsKICAgIH0KICAgIHZhciB1cmwgPQogICAgICAiaHR0cHM6Ly9hcGkub3Blbi1tZXRlby5jb20vdjEvZWxldmF0aW9uP2xhdGl0dWRlPSIgKwogICAgICBlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKGxhdCkpICsKICAgICAgIiZsb25naXR1ZGU9IiArCiAgICAgIGVuY29kZVVSSUNvbXBvbmVudChTdHJpbmcobG5nKSk7CiAgICAkaHR0cENsaWVudC5nZXQoeyB1cmw6IHVybCwgdGltZW91dDogNDAwMCB9LCBmdW5jdGlvbiAoZXJyb3IsIHJlc3BvbnNlLCBib2R5KSB7CiAgICAgIGlmIChlcnJvciB8fCAhYm9keSkgewogICAgICAgIGNhbGxiYWNrKG51bGwpOwogICAgICAgIHJldHVybjsKICAgICAgfQogICAgICB0cnkgewogICAgICAgIHZhciBkYXRhID0gSlNPTi5wYXJzZShib2R5KTsKICAgICAgICBpZiAoZGF0YSAmJiBkYXRhLmVsZXZhdGlvbiAmJiBkYXRhLmVsZXZhdGlvbi5sZW5ndGgpIHsKICAgICAgICAgIGNhbGxiYWNrKE1hdGgucm91bmQoTnVtYmVyKGRhdGEuZWxldmF0aW9uWzBdKSkpOwogICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgLy8gaWdub3JlIHBhcnNlIGZhaWx1cmVzCiAgICAgIH0KICAgICAgY2FsbGJhY2sobnVsbCk7CiAgICB9KTsKICB9CgogIGZ1bmN0aW9uIGdlb2NvZGVBZGRyZXNzKGFkZHJlc3MsIGRlYnVnLCBjYWxsYmFjaykgewogICAgdmFyIHF1ZXJ5ID0gU3RyaW5nKGFkZHJlc3MgfHwgIiIpLnRyaW0oKTsKICAgIGlmICghcXVlcnkpIHsKICAgICAgY2FsbGJhY2sobnVsbCk7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICB2YXIgY2FjaGVkID0gcmVhZEdlb2NvZGVDYWNoZSgpOwogICAgaWYgKGNhY2hlZCAmJiBjYWNoZWQuYWRkcmVzcyA9PT0gcXVlcnkgJiYgTnVtYmVyLmlzRmluaXRlKE51bWJlcihjYWNoZWQubGF0aXR1ZGUpKSAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKGNhY2hlZC5sb25naXR1ZGUpKSkgewogICAgICBpZiAoZGVidWcpIHsKICAgICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBnZW9jb2RlIGNhY2hlIGhpdDogIiArIHF1ZXJ5ICsgIiAtPiAiICsgY2FjaGVkLmxhdGl0dWRlICsgIiwiICsgY2FjaGVkLmxvbmdpdHVkZSk7CiAgICAgIH0KICAgICAgY2FsbGJhY2soY2FjaGVkKTsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIGlmICh0eXBlb2YgJGh0dHBDbGllbnQgPT09ICJ1bmRlZmluZWQiIHx8ICEkaHR0cENsaWVudC5nZXQpIHsKICAgICAgaWYgKGRlYnVnKSB7CiAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgZ2VvY29kZSBza2lwcGVkOiAkaHR0cENsaWVudCB1bmF2YWlsYWJsZSIpOwogICAgICB9CiAgICAgIGNhbGxiYWNrKG51bGwpOwogICAgICByZXR1cm47CiAgICB9CgogICAgdmFyIHVybCA9CiAgICAgICJodHRwczovL25vbWluYXRpbS5vcGVuc3RyZWV0bWFwLm9yZy9zZWFyY2g/Zm9ybWF0PWpzb24mbGltaXQ9MSZhZGRyZXNzZGV0YWlscz0wJnE9IiArCiAgICAgIGVuY29kZVVSSUNvbXBvbmVudChxdWVyeSk7CiAgICAkaHR0cENsaWVudC5nZXQoCiAgICAgIHsKICAgICAgICB1cmw6IHVybCwKICAgICAgICB0aW1lb3V0OiA4MDAwLAogICAgICAgIGhlYWRlcnM6IHsgIlVzZXItQWdlbnQiOiAiaW9zLWxvY2F0aW9uLXNwb29mZXIvMS4wIChMb29uIHBsdWdpbikiIH0KICAgICAgfSwKICAgICAgZnVuY3Rpb24gKGVycm9yLCByZXNwb25zZSwgYm9keSkgewogICAgICAgIGlmIChlcnJvciB8fCAhYm9keSkgewogICAgICAgICAgaWYgKGRlYnVnKSB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGdlb2NvZGUgZmFpbGVkOiAiICsgKGVycm9yIHx8ICJlbXB0eSBib2R5IikpOwogICAgICAgICAgfQogICAgICAgICAgY2FsbGJhY2sobnVsbCk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIHRyeSB7CiAgICAgICAgICB2YXIgcmVzdWx0cyA9IEpTT04ucGFyc2UoYm9keSk7CiAgICAgICAgICBpZiAoIXJlc3VsdHMgfHwgIXJlc3VsdHMubGVuZ3RoKSB7CiAgICAgICAgICAgIGlmIChkZWJ1ZykgewogICAgICAgICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGdlb2NvZGUgbm8gcmVzdWx0IGZvcjogIiArIHF1ZXJ5KTsKICAgICAgICAgICAgfQogICAgICAgICAgICBjYWxsYmFjayhudWxsKTsKICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgfQogICAgICAgICAgdmFyIGhpdCA9IHJlc3VsdHNbMF07CiAgICAgICAgICB2YXIgbGF0ID0gTnVtYmVyKGhpdC5sYXQpOwogICAgICAgICAgdmFyIGxuZyA9IE51bWJlcihoaXQubG9uKTsKICAgICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGxhdCkgfHwgIU51bWJlci5pc0Zpbml0ZShsbmcpKSB7CiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwpOwogICAgICAgICAgICByZXR1cm47CiAgICAgICAgICB9CiAgICAgICAgICB2YXIgZW50cnkgPSB7CiAgICAgICAgICAgIGFkZHJlc3M6IHF1ZXJ5LAogICAgICAgICAgICBsYXRpdHVkZTogbGF0LAogICAgICAgICAgICBsb25naXR1ZGU6IGxuZywKICAgICAgICAgICAgZGlzcGxheU5hbWU6IGhpdC5kaXNwbGF5X25hbWUgfHwgcXVlcnkKICAgICAgICAgIH07CiAgICAgICAgICBmZXRjaEVsZXZhdGlvbihsYXQsIGxuZywgZnVuY3Rpb24gKGFsdGl0dWRlKSB7CiAgICAgICAgICAgIGlmIChhbHRpdHVkZSAhPSBudWxsKSB7CiAgICAgICAgICAgICAgZW50cnkuYWx0aXR1ZGUgPSBhbHRpdHVkZTsKICAgICAgICAgICAgfQogICAgICAgICAgICB3cml0ZUdlb2NvZGVDYWNoZShlbnRyeSk7CiAgICAgICAgICAgIGlmIChkZWJ1ZykgewogICAgICAgICAgICAgIGNvbnNvbGUubG9nKAogICAgICAgICAgICAgICAgIkxvY2F0aW9uIHNwb29mZXIgZ2VvY29kZSByZXNvbHZlZDogIiArCiAgICAgICAgICAgICAgICAgIHF1ZXJ5ICsKICAgICAgICAgICAgICAgICAgIiAtPiAiICsKICAgICAgICAgICAgICAgICAgbGF0ICsKICAgICAgICAgICAgICAgICAgIiwiICsKICAgICAgICAgICAgICAgICAgbG5nICsKICAgICAgICAgICAgICAgICAgKGFsdGl0dWRlICE9IG51bGwgPyAiLCBhbHQ9IiArIGFsdGl0dWRlIDogIiIpCiAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBjYWxsYmFjayhlbnRyeSk7CiAgICAgICAgICB9KTsKICAgICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICAgIGlmIChkZWJ1ZykgewogICAgICAgICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBnZW9jb2RlIHBhcnNlIGZhaWxlZDogIiArIGVyci5tZXNzYWdlKTsKICAgICAgICAgIH0KICAgICAgICAgIGNhbGxiYWNrKG51bGwpOwogICAgICAgIH0KICAgICAgfQogICAgKTsKICB9CgogIGZ1bmN0aW9uIG1lcmdlQ29uZmlnKGJhc2UsIGV4dHJhKSB7CiAgICB2YXIgb3V0ID0ge307CiAgICB2YXIga2V5OwogICAgZm9yIChrZXkgaW4gYmFzZSkgewogICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGJhc2UsIGtleSkpIHsKICAgICAgICBvdXRba2V5XSA9IGJhc2Vba2V5XTsKICAgICAgfQogICAgfQogICAgZXh0cmEgPSBleHRyYSB8fCB7fTsKICAgIGZvciAoa2V5IGluIGV4dHJhKSB7CiAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZXh0cmEsIGtleSkpIHsKICAgICAgICBvdXRba2V5XSA9IGV4dHJhW2tleV07CiAgICAgIH0KICAgIH0KICAgIHJldHVybiBvdXQ7CiAgfQoKICBmdW5jdGlvbiBkZWNvZGVCYXNlNjQodmFsdWUpIHsKICAgIGlmICh0eXBlb2YgYXRvYiA9PT0gImZ1bmN0aW9uIikgewogICAgICByZXR1cm4gYXRvYih2YWx1ZSk7CiAgICB9CiAgICBpZiAodHlwZW9mIEJ1ZmZlciAhPT0gInVuZGVmaW5lZCIpIHsKICAgICAgcmV0dXJuIEJ1ZmZlci5mcm9tKHZhbHVlLCAiYmFzZTY0IikudG9TdHJpbmcoInV0ZjgiKTsKICAgIH0KICAgIHRocm93IG5ldyBFcnJvcigiYmFzZTY0IGRlY29kZXIgdW5hdmFpbGFibGUiKTsKICB9CgogIGZ1bmN0aW9uIGNvbmZpZ0Zyb21BcmdzKGFyZ3MpIHsKICAgIHZhciBjZmcgPSB7fTsKICAgIHZhciBzY2FsYXJLZXlzID0gWwogICAgICAiZW5hYmxlZCIsCiAgICAgICJtb2RlIiwKICAgICAgImxhdGl0dWRlIiwKICAgICAgImxvbmdpdHVkZSIsCiAgICAgICJhZGRyZXNzIiwKICAgICAgImhvcml6b250YWxBY2N1cmFjeSIsCiAgICAgICJ2ZXJ0aWNhbEFjY3VyYWN5IiwKICAgICAgImFsdGl0dWRlIiwKICAgICAgInVua25vd25WYWx1ZTQiLAogICAgICAibW90aW9uQWN0aXZpdHlUeXBlIiwKICAgICAgIm1vdGlvbkFjdGl2aXR5Q29uZmlkZW5jZSIsCiAgICAgICJmYWlsT3BlbiIsCiAgICAgICJkZWJ1ZyIsCiAgICAgICJkdW1wUmF3IiwKICAgICAgImR1bXBIZWFkZXJzIiwKICAgICAgInByZXBhcmVIZWFkZXJzIiwKICAgICAgInJhd0xpbWl0IgogICAgXTsKCiAgICBpZiAoYXJncy5jb25maWcpIHsKICAgICAgY2ZnID0gbWVyZ2VDb25maWcoY2ZnLCBKU09OLnBhcnNlKGFyZ3MuY29uZmlnKSk7CiAgICB9CiAgICBpZiAoYXJncy5jb25maWdCYXNlNjQpIHsKICAgICAgY2ZnID0gbWVyZ2VDb25maWcoY2ZnLCBKU09OLnBhcnNlKGRlY29kZUJhc2U2NChhcmdzLmNvbmZpZ0Jhc2U2NCkpKTsKICAgIH0KICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2NhbGFyS2V5cy5sZW5ndGg7IGkgKz0gMSkgewogICAgICB2YXIga2V5ID0gc2NhbGFyS2V5c1tpXTsKICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChhcmdzLCBrZXkpKSB7CiAgICAgICAgY2ZnW2tleV0gPSBhcmdzW2tleV07CiAgICAgIH0KICAgIH0KICAgIHJldHVybiBjZmc7CiAgfQoKICBmdW5jdGlvbiByZWFkUmVtb3RlQ29uZmlnQ2FjaGUodXJsKSB7CiAgICBpZiAoIXVybCB8fCB0eXBlb2YgJHBlcnNpc3RlbnRTdG9yZSA9PT0gInVuZGVmaW5lZCIgfHwgISRwZXJzaXN0ZW50U3RvcmUucmVhZCkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICAgIHRyeSB7CiAgICAgIHZhciByYXcgPSAkcGVyc2lzdGVudFN0b3JlLnJlYWQoImxvY2F0aW9uX3Nwb29mZXJfcmVtb3RlX2NmZyIpOwogICAgICBpZiAoIXJhdykgewogICAgICAgIHJldHVybiBudWxsOwogICAgICB9CiAgICAgIHZhciBlbnRyeSA9IEpTT04ucGFyc2UocmF3KTsKICAgICAgaWYgKCFlbnRyeSB8fCBlbnRyeS51cmwgIT09IHVybCB8fCAhZW50cnkuZGF0YSkgewogICAgICAgIHJldHVybiBudWxsOwogICAgICB9CiAgICAgIGlmIChEYXRlLm5vdygpIC0gZW50cnkudHMgPiAzMDAwMDApIHsKICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgfQogICAgICByZXR1cm4gZW50cnkuZGF0YTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICB9CgogIGZ1bmN0aW9uIHdyaXRlUmVtb3RlQ29uZmlnQ2FjaGUodXJsLCBkYXRhKSB7CiAgICBpZiAoIXVybCB8fCB0eXBlb2YgJHBlcnNpc3RlbnRTdG9yZSA9PT0gInVuZGVmaW5lZCIgfHwgISRwZXJzaXN0ZW50U3RvcmUud3JpdGUpIHsKICAgICAgcmV0dXJuOwogICAgfQogICAgdHJ5IHsKICAgICAgJHBlcnNpc3RlbnRTdG9yZS53cml0ZSgKICAgICAgICAibG9jYXRpb25fc3Bvb2Zlcl9yZW1vdGVfY2ZnIiwKICAgICAgICBKU09OLnN0cmluZ2lmeSh7IHVybDogdXJsLCBkYXRhOiBkYXRhLCB0czogRGF0ZS5ub3coKSB9KQogICAgICApOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIC8vIGlnbm9yZSBjYWNoZSB3cml0ZSBmYWlsdXJlcwogICAgfQogIH0KCiAgZnVuY3Rpb24gZmV0Y2hSZW1vdGVDb25maWcodXJsLCB0aW1lb3V0LCBkZWJ1ZywgY2FsbGJhY2spIHsKICAgIGlmICghdXJsIHx8IHR5cGVvZiAkaHR0cENsaWVudCA9PT0gInVuZGVmaW5lZCIgfHwgISRodHRwQ2xpZW50LmdldCkgewogICAgICBjYWxsYmFjayhudWxsLCAiaHR0cCBjbGllbnQgdW5hdmFpbGFibGUiKTsKICAgICAgcmV0dXJuOwogICAgfQogICAgJGh0dHBDbGllbnQuZ2V0KHsgdXJsOiB1cmwsIHRpbWVvdXQ6IHRpbWVvdXQgfHwgMzAwMCB9LCBmdW5jdGlvbiAoZXJyb3IsIHJlc3BvbnNlLCBib2R5KSB7CiAgICAgIGlmIChlcnJvciB8fCAhYm9keSkgewogICAgICAgIGNhbGxiYWNrKG51bGwsIGVycm9yIHx8ICJlbXB0eSBib2R5Iik7CiAgICAgICAgcmV0dXJuOwogICAgICB9CiAgICAgIHRyeSB7CiAgICAgICAgY2FsbGJhY2soSlNPTi5wYXJzZShib2R5KSwgbnVsbCk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGNhbGxiYWNrKG51bGwsIGVyci5tZXNzYWdlKTsKICAgICAgfQogICAgfSk7CiAgfQoKICBmdW5jdGlvbiByZWZyZXNoUmVtb3RlQ29uZmlnQ2FjaGUodXJsLCBkZWJ1ZykgewogICAgZmV0Y2hSZW1vdGVDb25maWcodXJsLCA1MDAwLCBkZWJ1ZywgZnVuY3Rpb24gKGRhdGEsIGVycikgewogICAgICBpZiAoZGF0YSkgewogICAgICAgIHdyaXRlUmVtb3RlQ29uZmlnQ2FjaGUodXJsLCBkYXRhKTsKICAgICAgICByZXR1cm47CiAgICAgIH0KICAgICAgaWYgKGRlYnVnKSB7CiAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcmVtb3RlIGNvbmZpZyByZWZyZXNoIGZhaWxlZDogIiArIGVycik7CiAgICAgIH0KICAgIH0pOwogIH0KCiAgZnVuY3Rpb24gYXBwbHlBZGRyZXNzRnJvbUNhY2hlKGNmZywgYWRkcmVzcywgZGVidWcpIHsKICAgIGlmICghYWRkcmVzcykgewogICAgICByZXR1cm47CiAgICB9CiAgICB2YXIgY2FjaGVkID0gcmVhZEdlb2NvZGVDYWNoZSgpOwogICAgaWYgKGNhY2hlZCAmJiBjYWNoZWQuYWRkcmVzcyA9PT0gYWRkcmVzcyAmJiBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKGNhY2hlZC5sYXRpdHVkZSkpICYmIE51bWJlci5pc0Zpbml0ZShOdW1iZXIoY2FjaGVkLmxvbmdpdHVkZSkpKSB7CiAgICAgIGNmZy5sYXRpdHVkZSA9IGNhY2hlZC5sYXRpdHVkZTsKICAgICAgY2ZnLmxvbmdpdHVkZSA9IGNhY2hlZC5sb25naXR1ZGU7CiAgICAgIGlmIChjYWNoZWQuYWx0aXR1ZGUgIT0gbnVsbCkgewogICAgICAgIGNmZy5hbHRpdHVkZSA9IGNhY2hlZC5hbHRpdHVkZTsKICAgICAgfQogICAgICBpZiAoZGVidWcpIHsKICAgICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBnZW9jb2RlIGNhY2hlIGhpdDogIiArIGFkZHJlc3MpOwogICAgICB9CiAgICAgIHJldHVybjsKICAgIH0KICAgIGlmIChkZWJ1ZykgewogICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBnZW9jb2RlIGNhY2hlIG1pc3M6ICIgKyBhZGRyZXNzICsgIiAodXNlIG1hbnVhbCBsYXQvbG5nIHVudGlsIGNyb24gcmVmcmVzaGVzKSIpOwogICAgfQogIH0KCiAgZnVuY3Rpb24gbG9hZFJ1bnRpbWVDb25maWdTeW5jKCkgewogICAgdmFyIGFyZ3MgPSByZWFkU2NyaXB0QXJndW1lbnRzKCk7CiAgICB2YXIgY2ZnID0gbWVyZ2VDb25maWcoREVGQVVMVF9DT05GSUcsIGNvbmZpZ0Zyb21BcmdzKGFyZ3MpKTsKICAgIHZhciBjb25maWdVcmwgPSByZXNvbHZlQ29uZmlnVXJsKGFyZ3MpOwogICAgdmFyIGRlYnVnID0gcGFyc2VCb29sZWFuKGNmZy5kZWJ1ZywgZmFsc2UpOwogICAgdmFyIGFkZHJlc3MgPSBTdHJpbmcoYXJncy5hZGRyZXNzIHx8ICIiKS50cmltKCk7CgogICAgYXBwbHlBZGRyZXNzRnJvbUNhY2hlKGNmZywgYWRkcmVzcywgZGVidWcpOwoKICAgIGlmIChjb25maWdVcmwpIHsKICAgICAgdmFyIHJlbW90ZUNmZyA9IHJlYWRSZW1vdGVDb25maWdDYWNoZShjb25maWdVcmwpOwogICAgICBpZiAocmVtb3RlQ2ZnKSB7CiAgICAgICAgY2ZnID0gbWVyZ2VDb25maWcoY2ZnLCByZW1vdGVDZmcpOwogICAgICAgIGlmIChkZWJ1ZykgewogICAgICAgICAgY29uc29sZS5sb2coCiAgICAgICAgICAgICJMb2NhdGlvbiBzcG9vZmVyIHJlbW90ZSBjb25maWcgY2FjaGUgaGl0IC0+ICIgKwogICAgICAgICAgICAgIHJlbW90ZUNmZy5sYXRpdHVkZSArCiAgICAgICAgICAgICAgIiwiICsKICAgICAgICAgICAgICByZW1vdGVDZmcubG9uZ2l0dWRlCiAgICAgICAgICApOwogICAgICAgIH0KICAgICAgfQogICAgfQoKICAgIHJldHVybiB7IGNmZzogY2ZnLCBjb25maWdVcmw6IGNvbmZpZ1VybCwgZGVidWc6IGRlYnVnIH07CiAgfQoKICBmdW5jdGlvbiBsb2FkUnVudGltZUNvbmZpZyhjYWxsYmFjaykgewogICAgdmFyIGxvYWRlZCA9IGxvYWRSdW50aW1lQ29uZmlnU3luYygpOwogICAgdmFyIGNmZyA9IGxvYWRlZC5jZmc7CiAgICB2YXIgY29uZmlnVXJsID0gbG9hZGVkLmNvbmZpZ1VybDsKICAgIHZhciBkZWJ1ZyA9IGxvYWRlZC5kZWJ1ZzsKCiAgICBmdW5jdGlvbiBmaW5pc2goKSB7CiAgICAgIHRyeSB7CiAgICAgICAgY2FsbGJhY2sobm9ybWFsaXplQ29uZmlnKGNmZykpOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBpZiAoZGVidWcpIHsKICAgICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGNvbmZpZyBpbnZhbGlkOiAiICsgZXJyLm1lc3NhZ2UgKyAiIHwgY2ZnIGxhdC9sbmc9IiArIGNmZy5sYXRpdHVkZSArICIsIiArIGNmZy5sb25naXR1ZGUpOwogICAgICAgIH0KICAgICAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShOdW1iZXIoY2ZnLmxhdGl0dWRlKSkgfHwgIU51bWJlci5pc0Zpbml0ZShOdW1iZXIoY2ZnLmxvbmdpdHVkZSkpKSB7CiAgICAgICAgICBjZmcubGF0aXR1ZGUgPSBERUZBVUxUX0NPTkZJRy5sYXRpdHVkZTsKICAgICAgICAgIGNmZy5sb25naXR1ZGUgPSBERUZBVUxUX0NPTkZJRy5sb25naXR1ZGU7CiAgICAgICAgfQogICAgICAgIGNhbGxiYWNrKG5vcm1hbGl6ZUNvbmZpZyhjZmcpKTsKICAgICAgfQogICAgfQoKICAgIGxvZ1NjcmlwdEFyZ3VtZW50cyhkZWJ1Zyk7CgogICAgaWYgKCFjb25maWdVcmwpIHsKICAgICAgZmluaXNoKCk7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBpZiAocmVhZFJlbW90ZUNvbmZpZ0NhY2hlKGNvbmZpZ1VybCkpIHsKICAgICAgcmVmcmVzaFJlbW90ZUNvbmZpZ0NhY2hlKGNvbmZpZ1VybCwgZGVidWcpOwogICAgICBmaW5pc2goKTsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIGlmIChkZWJ1ZykgewogICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciByZW1vdGUgY29uZmlnIGZldGNoaW5nOiAiICsgY29uZmlnVXJsKTsKICAgIH0KICAgIGZldGNoUmVtb3RlQ29uZmlnKGNvbmZpZ1VybCwgMzAwMCwgZGVidWcsIGZ1bmN0aW9uIChkYXRhLCBlcnIpIHsKICAgICAgaWYgKGRhdGEpIHsKICAgICAgICB3cml0ZVJlbW90ZUNvbmZpZ0NhY2hlKGNvbmZpZ1VybCwgZGF0YSk7CiAgICAgICAgY2ZnID0gbWVyZ2VDb25maWcoY2ZnLCBkYXRhKTsKICAgICAgICBpZiAoZGVidWcpIHsKICAgICAgICAgIGNvbnNvbGUubG9nKAogICAgICAgICAgICAiTG9jYXRpb24gc3Bvb2ZlciByZW1vdGUgY29uZmlnIGxvYWRlZCAtPiAiICsgZGF0YS5sYXRpdHVkZSArICIsIiArIGRhdGEubG9uZ2l0dWRlCiAgICAgICAgICApOwogICAgICAgIH0KICAgICAgfSBlbHNlIGlmIChkZWJ1ZykgewogICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJlbW90ZSBjb25maWcgZmV0Y2ggZmFpbGVkOiAiICsgZXJyICsgIiAodXNpbmcgbWFudWFsIGxhdC9sbmcpIik7CiAgICAgIH0KICAgICAgZmluaXNoKCk7CiAgICB9KTsKICB9CgogIGZ1bmN0aW9uIHJ1bk1haW50ZW5hbmNlQ3JvbigpIHsKICAgIHZhciBhcmdzID0gcmVhZFNjcmlwdEFyZ3VtZW50cygpOwogICAgdmFyIGRlYnVnID0gcGFyc2VCb29sZWFuKGFyZ3MuZGVidWcsIGZhbHNlKTsKICAgIHZhciBwZW5kaW5nID0gMDsKCiAgICBmdW5jdGlvbiBtYXliZURvbmUoKSB7CiAgICAgIHBlbmRpbmcgLT0gMTsKICAgICAgaWYgKHBlbmRpbmcgPD0gMCkgewogICAgICAgICRkb25lKHt9KTsKICAgICAgfQogICAgfQoKICAgIHZhciBjb25maWdVcmwgPSByZXNvbHZlQ29uZmlnVXJsKGFyZ3MpOwogICAgaWYgKGNvbmZpZ1VybCkgewogICAgICBwZW5kaW5nICs9IDE7CiAgICAgIGZldGNoUmVtb3RlQ29uZmlnKGNvbmZpZ1VybCwgODAwMCwgZGVidWcsIGZ1bmN0aW9uIChkYXRhLCBlcnIpIHsKICAgICAgICBpZiAoZGF0YSkgewogICAgICAgICAgd3JpdGVSZW1vdGVDb25maWdDYWNoZShjb25maWdVcmwsIGRhdGEpOwogICAgICAgICAgaWYgKGRlYnVnKSB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKAogICAgICAgICAgICAgICJMb2NhdGlvbiBzcG9vZmVyIGNvbmZpZyBjcm9uIGNhY2hlZCAtPiAiICsgZGF0YS5sYXRpdHVkZSArICIsIiArIGRhdGEubG9uZ2l0dWRlCiAgICAgICAgICAgICk7CiAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIGlmIChkZWJ1ZykgewogICAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgY29uZmlnIGNyb24gZmFpbGVkOiAiICsgZXJyKTsKICAgICAgICB9CiAgICAgICAgbWF5YmVEb25lKCk7CiAgICAgIH0pOwogICAgfQoKICAgIHZhciBhZGRyZXNzID0gU3RyaW5nKGFyZ3MuYWRkcmVzcyB8fCAiIikudHJpbSgpOwogICAgaWYgKGFkZHJlc3MpIHsKICAgICAgcGVuZGluZyArPSAxOwogICAgICBnZW9jb2RlQWRkcmVzcyhhZGRyZXNzLCBkZWJ1ZywgZnVuY3Rpb24gKCkgewogICAgICAgIG1heWJlRG9uZSgpOwogICAgICB9KTsKICAgIH0KCiAgICBpZiAocGVuZGluZyA9PT0gMCkgewogICAgICAkZG9uZSh7fSk7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBydW5HZW9jb2RlQ3JvbigpIHsKICAgIHJ1bk1haW50ZW5hbmNlQ3JvbigpOwogIH0KCiAgZnVuY3Rpb24gaGVhZGVyc1dpdGhCaW5hcnlCb2R5KHNvdXJjZUhlYWRlcnMsIGxlbmd0aCkgewogICAgdmFyIGhlYWRlcnMgPSB7fTsKICAgIHZhciBrZXk7CiAgICBzb3VyY2VIZWFkZXJzID0gc291cmNlSGVhZGVycyB8fCB7fTsKICAgIGZvciAoa2V5IGluIHNvdXJjZUhlYWRlcnMpIHsKICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChzb3VyY2VIZWFkZXJzLCBrZXkpKSB7CiAgICAgICAgdmFyIGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKCk7CiAgICAgICAgaWYgKGxvd2VyICE9PSAiY29udGVudC1sZW5ndGgiICYmIGxvd2VyICE9PSAiY29udGVudC1lbmNvZGluZyIgJiYgbG93ZXIgIT09ICJ0cmFuc2Zlci1lbmNvZGluZyIpIHsKICAgICAgICAgIGhlYWRlcnNba2V5XSA9IHNvdXJjZUhlYWRlcnNba2V5XTsKICAgICAgICB9CiAgICAgIH0KICAgIH0KICAgIGhlYWRlcnNbIkNvbnRlbnQtVHlwZSJdID0gImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSI7CiAgICBoZWFkZXJzWyJDb250ZW50LUxlbmd0aCJdID0gU3RyaW5nKGxlbmd0aCk7CiAgICByZXR1cm4gaGVhZGVyczsKICB9CgogIGZ1bmN0aW9uIHNldEhlYWRlcihoZWFkZXJzLCBuYW1lLCB2YWx1ZSkgewogICAgaGVhZGVycyA9IGhlYWRlcnMgfHwge307CiAgICB2YXIgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7CiAgICB2YXIgZXhpc3RpbmdLZXkgPSBudWxsOwogICAgZm9yICh2YXIga2V5IGluIGhlYWRlcnMpIHsKICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChoZWFkZXJzLCBrZXkpICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikgewogICAgICAgIGV4aXN0aW5nS2V5ID0ga2V5OwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICB9CiAgICBoZWFkZXJzW2V4aXN0aW5nS2V5IHx8IG5hbWVdID0gdmFsdWU7CiAgICByZXR1cm4gaGVhZGVyczsKICB9CgogIGZ1bmN0aW9uIHByZXBhcmVSZXF1ZXN0SGVhZGVycyhoZWFkZXJzKSB7CiAgICByZXR1cm4gc2V0SGVhZGVyKGhlYWRlcnMgfHwge30sICJBY2NlcHQtRW5jb2RpbmciLCAiaWRlbnRpdHkiKTsKICB9CgogIGZ1bmN0aW9uIGRvbmVQcmVwYXJlZFJlcXVlc3RQYXNzVGhyb3VnaCgpIHsKICAgIHZhciBoZWFkZXJzID0gcHJlcGFyZVJlcXVlc3RIZWFkZXJzKCh0eXBlb2YgJHJlcXVlc3QgIT09ICJ1bmRlZmluZWQiICYmICRyZXF1ZXN0LmhlYWRlcnMpIHx8IHt9KTsKICAgICRkb25lKHsKICAgICAgaGVhZGVyczogaGVhZGVycwogICAgfSk7CiAgfQoKICAvLyBEZWNvZGUgYW4gSFRUUCByZXNwb25zZSBib2R5IHRoYXQgbWF5IGJlIGd6aXAvZGVmbGF0ZS9iciBlbmNvZGVkLgogIC8vIFNoYWRvd3JvY2tldC9TdXJnZSBleHBvc2UgJHV0aWxzLnVuZ3ppcDsgTG9vbiBmYWxscyBiYWNrIHRvIERlY29tcHJlc3Npb25TdHJlYW0uCiAgZnVuY3Rpb24gZGVjb21wcmVzc0JvZHkoYm9keSwgY29udGVudEVuY29kaW5nKSB7CiAgICBpZiAoYm9keSA9PSBudWxsKSB7CiAgICAgIHJldHVybiBib2R5OwogICAgfQogICAgdmFyIGVuYyA9IGNvbnRlbnRFbmNvZGluZyA/IFN0cmluZyhjb250ZW50RW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkgOiAiIjsKICAgIGlmIChlbmMgPT09ICJpZGVudGl0eSIgfHwgZW5jID09PSAiIikgewogICAgICByZXR1cm4gYm9keTsKICAgIH0KICAgIHRyeSB7CiAgICAgIGlmIChlbmMuaW5kZXhPZigiZ3ppcCIpID49IDAgJiYgdHlwZW9mICR1dGlscyAhPT0gInVuZGVmaW5lZCIgJiYgJHV0aWxzLnVuZ3ppcCkgewogICAgICAgIHJldHVybiAkdXRpbHMudW5nemlwKGJvZHkpOwogICAgICB9CiAgICAgIGlmIChlbmMuaW5kZXhPZigiZGVmbGF0ZSIpID49IDAgJiYgdHlwZW9mICR1dGlscyAhPT0gInVuZGVmaW5lZCIgJiYgJHV0aWxzLmluZmxhdGUpIHsKICAgICAgICByZXR1cm4gJHV0aWxzLmluZmxhdGUoYm9keSk7CiAgICAgIH0KICAgICAgaWYgKGVuYy5pbmRleE9mKCJiciIpID49IDAgJiYgdHlwZW9mICR1dGlscyAhPT0gInVuZGVmaW5lZCIgJiYgJHV0aWxzLmJyb3RsaURlY29tcHJlc3MpIHsKICAgICAgICByZXR1cm4gJHV0aWxzLmJyb3RsaURlY29tcHJlc3MoYm9keSk7CiAgICAgIH0KICAgIH0gY2F0Y2ggKGVycikgewogICAgICBpZiAodHlwZW9mIGNvbnNvbGUgIT09ICJ1bmRlZmluZWQiKSB7CiAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgZGVjb21wcmVzcyBmYWlsZWQgKCIgKyBlbmMgKyAiKTogIiArIGVyci5tZXNzYWdlKTsKICAgICAgfQogICAgfQogICAgcmV0dXJuIGJvZHk7CiAgfQoKICBmdW5jdGlvbiBwcmVwYXJlUmVzcG9uc2VCb2R5U3luYyhjb25maWcpIHsKICAgIHZhciByZXNwSGVhZGVycyA9ICgkcmVzcG9uc2UgJiYgJHJlc3BvbnNlLmhlYWRlcnMpIHx8IHt9OwogICAgdmFyIGNvbnRlbnRFbmNvZGluZyA9IGhlYWRlclZhbHVlKHJlc3BIZWFkZXJzLCAiQ29udGVudC1FbmNvZGluZyIpOwogICAgdmFyIHJhd1Jlc3BCb2R5ID0gJHJlc3BvbnNlICYmICgkcmVzcG9uc2UuYm9keSAhPSBudWxsID8gJHJlc3BvbnNlLmJvZHkgOiAkcmVzcG9uc2UuYm9keUJ5dGVzKTsKICAgIGxvZ0h0dHBEdW1wKCJyZXNwb25zZS13aXJlLW9yaWdpbmFsIiwgJHJlc3BvbnNlLCBjb25maWcpOwogICAgbG9nUmF3RHVtcCgicmVzcG9uc2Utd2lyZS1vcmlnaW5hbCIsIGJvZHlUb0J5dGVzKHJhd1Jlc3BCb2R5KSwgY29uZmlnKTsKCiAgICB2YXIgYnl0ZXMgPSBib2R5VG9CeXRlcyhyYXdSZXNwQm9keSk7CiAgICBpZiAoIWJ5dGVzIHx8IGJ5dGVzLmxlbmd0aCA8IDIpIHsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIGlmIChpc0d6aXBCeXRlcyhieXRlcykgfHwgKGNvbnRlbnRFbmNvZGluZyAmJiBTdHJpbmcoY29udGVudEVuY29kaW5nKS50b0xvd2VyQ2FzZSgpLmluZGV4T2YoImd6aXAiKSA+PSAwKSkgewogICAgICB2YXIgZGVjb2RlZCA9IGJvZHlUb0J5dGVzKGRlY29tcHJlc3NCb2R5KHJhd1Jlc3BCb2R5LCBjb250ZW50RW5jb2RpbmcgfHwgImd6aXAiKSk7CiAgICAgIGlmIChkZWNvZGVkICYmIGRlY29kZWQubGVuZ3RoID4gMiAmJiAhaXNHemlwQnl0ZXMoZGVjb2RlZCkpIHsKICAgICAgICAkcmVzcG9uc2UuYm9keSA9IGRlY29kZWQ7CiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1ZykgewogICAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgZGVjb21wcmVzc2VkIGJvZHk6ICIgKyBieXRlcy5sZW5ndGggKyAiIC0+ICIgKyBkZWNvZGVkLmxlbmd0aCArICIgYnl0ZXMiKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuOwogICAgICB9CiAgICAgIGlmIChjb25maWcuZGVidWcpIHsKICAgICAgICBjb25zb2xlLmxvZygKICAgICAgICAgICJMb2NhdGlvbiBzcG9vZmVyIGd6aXAgYm9keSBzdGlsbCBjb21wcmVzc2VkIChsZW49IiArCiAgICAgICAgICAgIGJ5dGVzLmxlbmd0aCArCiAgICAgICAgICAgICIpOyBlbnN1cmUgaHR0cC1yZXF1ZXN0IHByZXBhcmUgc2NyaXB0IGlzIGVuYWJsZWQiCiAgICAgICAgKTsKICAgICAgfQogICAgICByZXR1cm47CiAgICB9CgogICAgaWYgKGNvbnRlbnRFbmNvZGluZykgewogICAgICB2YXIgcGxhaW4gPSBib2R5VG9CeXRlcyhkZWNvbXByZXNzQm9keShyYXdSZXNwQm9keSwgY29udGVudEVuY29kaW5nKSk7CiAgICAgIGlmIChwbGFpbikgewogICAgICAgICRyZXNwb25zZS5ib2R5ID0gcGxhaW47CiAgICAgIH0KICAgIH0KICB9CgogIGZ1bmN0aW9uIGhlYWRlclZhbHVlKGhlYWRlcnMsIG5hbWUpIHsKICAgIGlmICghaGVhZGVycykgewogICAgICByZXR1cm4gdW5kZWZpbmVkOwogICAgfQogICAgdmFyIGxvd2VyID0gbmFtZS50b0xvd2VyQ2FzZSgpOwogICAgZm9yICh2YXIga2V5IGluIGhlYWRlcnMpIHsKICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChoZWFkZXJzLCBrZXkpICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikgewogICAgICAgIHJldHVybiBoZWFkZXJzW2tleV07CiAgICAgIH0KICAgIH0KICAgIHJldHVybiB1bmRlZmluZWQ7CiAgfQoKICBmdW5jdGlvbiBkb25lUGFzc1Rocm91Z2goKSB7CiAgICAkZG9uZSh7fSk7CiAgfQoKICBmdW5jdGlvbiB2YWx1ZVR5cGUodmFsdWUpIHsKICAgIGlmICh2YWx1ZSA9PSBudWxsKSB7CiAgICAgIHJldHVybiBTdHJpbmcodmFsdWUpOwogICAgfQogICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgVWludDhBcnJheSkgewogICAgICByZXR1cm4gIlVpbnQ4QXJyYXkiOwogICAgfQogICAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gInVuZGVmaW5lZCIgJiYgdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgewogICAgICByZXR1cm4gIkFycmF5QnVmZmVyIjsKICAgIH0KICAgIHJldHVybiB0eXBlb2YgdmFsdWU7CiAgfQoKICBmdW5jdGlvbiB2YWx1ZUxlbmd0aCh2YWx1ZSkgewogICAgaWYgKHZhbHVlID09IG51bGwpIHsKICAgICAgcmV0dXJuIDA7CiAgICB9CiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAic3RyaW5nIiB8fCB0eXBlb2YgdmFsdWUubGVuZ3RoID09PSAibnVtYmVyIikgewogICAgICByZXR1cm4gdmFsdWUubGVuZ3RoOwogICAgfQogICAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gInVuZGVmaW5lZCIgJiYgdmFsdWUgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikgewogICAgICByZXR1cm4gdmFsdWUuYnl0ZUxlbmd0aDsKICAgIH0KICAgIHJldHVybiAwOwogIH0KCiAgZnVuY3Rpb24gb2JqZWN0S2V5cyh2YWx1ZSkgewogICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09ICJvYmplY3QiKSB7CiAgICAgIHJldHVybiAiIjsKICAgIH0KICAgIHZhciBrZXlzID0gW107CiAgICBmb3IgKHZhciBrZXkgaW4gdmFsdWUpIHsKICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwga2V5KSkgewogICAgICAgIGtleXMucHVzaChrZXkpOwogICAgICB9CiAgICB9CiAgICByZXR1cm4ga2V5cy5qb2luKCIsIik7CiAgfQoKICBmdW5jdGlvbiBmaWVsZEhpc3RvZ3JhbShmaWVsZHMpIHsKICAgIHZhciBjb3VudHMgPSB7fTsKICAgIHZhciBvcmRlciA9IFtdOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWVsZHMubGVuZ3RoOyBpICs9IDEpIHsKICAgICAgdmFyIGtleSA9IFN0cmluZyhmaWVsZHNbaV0uZmllbGROdW1iZXIpICsgIi8iICsgU3RyaW5nKGZpZWxkc1tpXS53aXJlVHlwZSk7CiAgICAgIGlmICghY291bnRzW2tleV0pIHsKICAgICAgICBjb3VudHNba2V5XSA9IDA7CiAgICAgICAgb3JkZXIucHVzaChrZXkpOwogICAgICB9CiAgICAgIGNvdW50c1trZXldICs9IDE7CiAgICB9CiAgICB2YXIgcGFydHMgPSBbXTsKICAgIGZvciAodmFyIGogPSAwOyBqIDwgb3JkZXIubGVuZ3RoOyBqICs9IDEpIHsKICAgICAgcGFydHMucHVzaChvcmRlcltqXSArICJ4IiArIGNvdW50c1tvcmRlcltqXV0pOwogICAgfQogICAgcmV0dXJuIHBhcnRzLmpvaW4oIiwiKTsKICB9CgogIGZ1bmN0aW9uIGNvdW50RmllbGRzKGZpZWxkcywgZmllbGROdW1iZXIpIHsKICAgIHZhciBjb3VudCA9IDA7CiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZpZWxkcy5sZW5ndGg7IGkgKz0gMSkgewogICAgICBpZiAoZmllbGRzW2ldLmZpZWxkTnVtYmVyID09PSBmaWVsZE51bWJlcikgewogICAgICAgIGNvdW50ICs9IDE7CiAgICAgIH0KICAgIH0KICAgIHJldHVybiBjb3VudDsKICB9CgogIGZ1bmN0aW9uIGNvdW50Q2VsbFJlc3BvbnNlRmllbGRzKGZpZWxkcykgewogICAgdmFyIGNvdW50ID0gMDsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmllbGRzLmxlbmd0aDsgaSArPSAxKSB7CiAgICAgIGlmIChpc0NlbGxSZXNwb25zZUZpZWxkKGZpZWxkc1tpXS5maWVsZE51bWJlcikpIHsKICAgICAgICBjb3VudCArPSAxOwogICAgICB9CiAgICB9CiAgICByZXR1cm4gY291bnQ7CiAgfQoKICBmdW5jdGlvbiBhcHBsZVdMb2NQYXlsb2FkSW5zcGVjdChwYXlsb2FkKSB7CiAgICB0cnkgewogICAgICB2YXIgZmllbGRzID0gcGFyc2VGaWVsZHMocGF5bG9hZCk7CiAgICAgIHZhciBwYXJ0cyA9IFsKICAgICAgICAicGF5bG9hZExlbj0iICsgcGF5bG9hZC5sZW5ndGgsCiAgICAgICAgImZpZWxkcz0iICsgZmllbGRIaXN0b2dyYW0oZmllbGRzKSwKICAgICAgICAid2lmaT0iICsgY291bnRGaWVsZHMoZmllbGRzLCAyKSwKICAgICAgICAiY2VsbFJlc3A9IiArIGNvdW50Q2VsbFJlc3BvbnNlRmllbGRzKGZpZWxkcyksCiAgICAgICAgImNlbGxSZXE9IiArIGNvdW50RmllbGRzKGZpZWxkcywgMjUpLAogICAgICAgICJoYXNDb3VudHM9IiArIChjb3VudEZpZWxkcyhmaWVsZHMsIDMpICsgIi8iICsgY291bnRGaWVsZHMoZmllbGRzLCA0KSksCiAgICAgICAgImRldmljZVR5cGU9IiArIGNvdW50RmllbGRzKGZpZWxkcywgMzMpLAogICAgICAgIHBhdGNoZWRQYXlsb2FkU3VtbWFyeShwYXlsb2FkKQogICAgICBdOwogICAgICByZXR1cm4gcGFydHMuam9pbigiLCAiKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICByZXR1cm4gInBheWxvYWQgcGFyc2UgZmFpbGVkOiAiICsgZXJyLm1lc3NhZ2U7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBsb2dSYXdEdW1wKGxhYmVsLCBieXRlcywgY29uZmlnKSB7CiAgICBpZiAoIWNvbmZpZy5kdW1wUmF3IHx8ICFieXRlcykgewogICAgICByZXR1cm47CiAgICB9CiAgICB2YXIgbGltaXQgPSBjb25maWcucmF3TGltaXQgfHwgMDsKICAgIHZhciBlbWl0dGVkID0gbGltaXQgPiAwICYmIGJ5dGVzLmxlbmd0aCA+IGxpbWl0ID8gYnl0ZXMuc2xpY2UoMCwgbGltaXQpIDogYnl0ZXM7CiAgICB2YXIgZW5jb2RlZCA9IGJ5dGVzVG9CYXNlNjQoZW1pdHRlZCk7CiAgICB2YXIgY2h1bmtTaXplID0gMzAwMDsKICAgIHZhciBjaHVua3MgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwoZW5jb2RlZC5sZW5ndGggLyBjaHVua1NpemUpKTsKICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJhdyAiICsgbGFiZWwgKyAiIGJhc2U2NCBiZWdpbjogbGVuPSIgKyBieXRlcy5sZW5ndGggKyAiLCBlbWl0dGVkPSIgKyBlbWl0dGVkLmxlbmd0aCArICIsIGNodW5rcz0iICsgY2h1bmtzICsgIiwgdHJ1bmNhdGVkPSIgKyAoZW1pdHRlZC5sZW5ndGggIT09IGJ5dGVzLmxlbmd0aCkpOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBlbmNvZGVkLmxlbmd0aDsgaSArPSBjaHVua1NpemUpIHsKICAgICAgdmFyIGNodW5rSW5kZXggPSBNYXRoLmZsb29yKGkgLyBjaHVua1NpemUpICsgMTsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcmF3ICIgKyBsYWJlbCArICIgYmFzZTY0IGNodW5rICIgKyBjaHVua0luZGV4ICsgIi8iICsgY2h1bmtzICsgIjogIiArIGVuY29kZWQuc2xpY2UoaSwgaSArIGNodW5rU2l6ZSkpOwogICAgfQogICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcmF3ICIgKyBsYWJlbCArICIgYmFzZTY0IGVuZCIpOwogIH0KCiAgZnVuY3Rpb24ganNvblN0cmluZyh2YWx1ZSkgewogICAgdHJ5IHsKICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlIHx8IHt9KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICByZXR1cm4gIjxqc29uLWZhaWxlZDoiICsgZXJyLm1lc3NhZ2UgKyAiPiI7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBsb2dIdHRwRHVtcChsYWJlbCwgbWVzc2FnZSwgY29uZmlnKSB7CiAgICBpZiAoIWNvbmZpZy5kdW1wSGVhZGVycyAmJiAhY29uZmlnLmR1bXBSYXcpIHsKICAgICAgcmV0dXJuOwogICAgfQogICAgbWVzc2FnZSA9IG1lc3NhZ2UgfHwge307CiAgICB2YXIgcmVxdWVzdCA9IHR5cGVvZiAkcmVxdWVzdCAhPT0gInVuZGVmaW5lZCIgPyAkcmVxdWVzdCA6IHt9OwogICAgdmFyIG1ldGhvZCA9IG1lc3NhZ2UubWV0aG9kIHx8IHJlcXVlc3QubWV0aG9kIHx8ICI8bm9uZT4iOwogICAgdmFyIHVybCA9IG1lc3NhZ2UudXJsIHx8IHJlcXVlc3QudXJsIHx8ICI8bm9uZT4iOwogICAgdmFyIHN0YXR1cyA9IG1lc3NhZ2Uuc3RhdHVzIHx8IG1lc3NhZ2Uuc3RhdHVzQ29kZSB8fCAiPG5vbmU+IjsKICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJhdyAiICsgbGFiZWwgKyAiIG1ldGE6IG1ldGhvZD0iICsgbWV0aG9kICsgIiwgdXJsPSIgKyB1cmwgKyAiLCBzdGF0dXM9IiArIHN0YXR1cyk7CiAgICBpZiAoY29uZmlnLmR1bXBIZWFkZXJzKSB7CiAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJhdyAiICsgbGFiZWwgKyAiIGhlYWRlcnM6ICIgKyBqc29uU3RyaW5nKG1lc3NhZ2UuaGVhZGVycyB8fCB7fSkpOwogICAgfQogIH0KCiAgZnVuY3Rpb24gaW5zcGVjdFJlc3BvbnNlQnl0ZXMoYnl0ZXMsIGNvbmZpZykgewogICAgaWYgKCFieXRlcykgewogICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBpbnNwZWN0IHJlc3BvbnNlIGJvZHkgdW5hdmFpbGFibGUiKTsKICAgICAgcmV0dXJuOwogICAgfQogICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgaW5zcGVjdCByZXNwb25zZSBib2R5OiBsZW49IiArIGJ5dGVzLmxlbmd0aCArICIsIGhlYWQ9IiArIGhleFByZXZpZXcoYnl0ZXMsIDQ4KSk7CiAgICBsb2dSYXdEdW1wKCJyZXNwb25zZSIsIGJ5dGVzLCBjb25maWcpOwogICAgdHJ5IHsKICAgICAgdmFyIGV4dHJhY3Rpb24gPSBleHRyYWN0QXBwbGVXTG9jUGF5bG9hZChieXRlcyk7CiAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGluc3BlY3QgcmVzcG9uc2UgZXh0cmFjdGlvbjoga2luZD0iICsgZXh0cmFjdGlvbi5raW5kICsgIiwgcHJlZml4PSIgKyAoZXh0cmFjdGlvbi5wcmVmaXggPyBoZXhQcmV2aWV3KGV4dHJhY3Rpb24ucHJlZml4LCA4KSA6ICI8bm9uZT4iKSArICIsIHBheWxvYWRMZW49IiArIGV4dHJhY3Rpb24ucGF5bG9hZC5sZW5ndGggKyAiLCBzdWZmaXhMZW49IiArIChleHRyYWN0aW9uLnN1ZmZpeCA/IGV4dHJhY3Rpb24uc3VmZml4Lmxlbmd0aCA6IDApKTsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgaW5zcGVjdCByZXNwb25zZSBwYXlsb2FkOiAiICsgYXBwbGVXTG9jUGF5bG9hZEluc3BlY3QoZXh0cmFjdGlvbi5wYXlsb2FkKSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgaW5zcGVjdCByZXNwb25zZSBleHRyYWN0aW9uIGZhaWxlZDogIiArIGVyci5tZXNzYWdlKTsKICAgICAgdmFyIGRpcmVjdEZpZWxkcyA9IHRyeVBhcnNlRmllbGRzKGJ5dGVzKTsKICAgICAgaWYgKGRpcmVjdEZpZWxkcykgewogICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGluc3BlY3QgcmVzcG9uc2UgZGlyZWN0IGZpZWxkczogIiArIGZpZWxkSGlzdG9ncmFtKGRpcmVjdEZpZWxkcykpOwogICAgICB9CiAgICB9CiAgfQoKICBmdW5jdGlvbiBpbnNwZWN0UmVxdWVzdEJ5dGVzKGJ5dGVzLCBjb25maWcpIHsKICAgIGlmICghYnl0ZXMpIHsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgaW5zcGVjdCByZXF1ZXN0IGJvZHkgdW5hdmFpbGFibGUiKTsKICAgICAgcmV0dXJuOwogICAgfQogICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgaW5zcGVjdCByZXF1ZXN0IGJvZHk6IGxlbj0iICsgYnl0ZXMubGVuZ3RoICsgIiwgaGVhZD0iICsgaGV4UHJldmlldyhieXRlcywgNDgpKTsKICAgIGxvZ1Jhd0R1bXAoInJlcXVlc3QiLCBieXRlcywgY29uZmlnKTsKICAgIHRyeSB7CiAgICAgIHZhciBhcnBjID0gcGFyc2VBcnBjKGJ5dGVzKTsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgaW5zcGVjdCByZXF1ZXN0IGFycGM6IHZlcnNpb249IiArIGFycGMudmVyc2lvbiArICIsIGZ1bmN0aW9uSWQ9IiArIGFycGMuZnVuY3Rpb25JZCArICIsIGxvY2FsZT0iICsgYXJwYy5sb2NhbGUgKyAiLCBhcHA9IiArIGFycGMuYXBwSWRlbnRpZmllciArICIsIG9zPSIgKyBhcnBjLm9zVmVyc2lvbiArICIsIHBheWxvYWRMZW49IiArIGFycGMucGF5bG9hZC5sZW5ndGgpOwogICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBpbnNwZWN0IHJlcXVlc3QgcGF5bG9hZDogIiArIGFwcGxlV0xvY1BheWxvYWRJbnNwZWN0KGFycGMucGF5bG9hZCkpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGluc3BlY3QgcmVxdWVzdCBhcnBjIGZhaWxlZDogIiArIGVyci5tZXNzYWdlKTsKICAgICAgdmFyIGRpcmVjdEZpZWxkcyA9IHRyeVBhcnNlRmllbGRzKGJ5dGVzKTsKICAgICAgaWYgKGRpcmVjdEZpZWxkcykgewogICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIGluc3BlY3QgcmVxdWVzdCBkaXJlY3QgZmllbGRzOiAiICsgZmllbGRIaXN0b2dyYW0oZGlyZWN0RmllbGRzKSk7CiAgICAgIH0KICAgIH0KICB9CgogIGZ1bmN0aW9uIGRvbmVJbnNwZWN0KGNvbmZpZywgaGFzUmVzcG9uc2UpIHsKICAgIGlmIChoYXNSZXNwb25zZSkgewogICAgICBsb2dIdHRwRHVtcCgicmVzcG9uc2UiLCAkcmVzcG9uc2UsIGNvbmZpZyk7CiAgICAgIGluc3BlY3RSZXNwb25zZUJ5dGVzKG1lc3NhZ2VCb2R5VG9CeXRlcygkcmVzcG9uc2UpLCBjb25maWcpOwogICAgfSBlbHNlIHsKICAgICAgbG9nSHR0cER1bXAoInJlcXVlc3QiLCAkcmVxdWVzdCwgY29uZmlnKTsKICAgICAgaW5zcGVjdFJlcXVlc3RCeXRlcyhtZXNzYWdlQm9keVRvQnl0ZXMoJHJlcXVlc3QpLCBjb25maWcpOwogICAgICBpZiAoY29uZmlnLnByZXBhcmVIZWFkZXJzKSB7CiAgICAgICAgZG9uZVByZXBhcmVkUmVxdWVzdFBhc3NUaHJvdWdoKCk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CiAgICB9CiAgICBkb25lUGFzc1Rocm91Z2goKTsKICB9CgogIGZ1bmN0aW9uIGRvbmVSZXNwb25zZVByb2JlKGNvbmZpZykgewogICAgdmFyIHJlc3BvbnNlID0gdHlwZW9mICRyZXNwb25zZSAhPT0gInVuZGVmaW5lZCIgPyAkcmVzcG9uc2UgOiB7fTsKICAgIHZhciBoZWFkZXJzID0gcmVzcG9uc2UuaGVhZGVycyB8fCB7fTsKICAgIGlmIChjb25maWcuZGVidWcpIHsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcHJvYmUgcmVzcG9uc2Uga2V5czogIiArIG9iamVjdEtleXMocmVzcG9uc2UpKTsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcHJvYmUgaGVhZGVyczogc3RhdHVzPSIgKyAocmVzcG9uc2Uuc3RhdHVzIHx8IHJlc3BvbnNlLnN0YXR1c0NvZGUgfHwgIjxub25lPiIpICsgIiwgY29udGVudC1sZW5ndGg9IiArIChoZWFkZXJWYWx1ZShoZWFkZXJzLCAiQ29udGVudC1MZW5ndGgiKSB8fCAiPG5vbmU+IikgKyAiLCBjb250ZW50LXR5cGU9IiArIChoZWFkZXJWYWx1ZShoZWFkZXJzLCAiQ29udGVudC1UeXBlIikgfHwgIjxub25lPiIpICsgIiwgY29udGVudC1lbmNvZGluZz0iICsgKGhlYWRlclZhbHVlKGhlYWRlcnMsICJDb250ZW50LUVuY29kaW5nIikgfHwgIm5vbmUiKSk7CiAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHByb2JlIGJvZHkgc2xvdHM6IGJvZHk9IiArIHZhbHVlVHlwZShyZXNwb25zZS5ib2R5KSArICIvIiArIHZhbHVlTGVuZ3RoKHJlc3BvbnNlLmJvZHkpICsgIiwgYm9keUJ5dGVzPSIgKyB2YWx1ZVR5cGUocmVzcG9uc2UuYm9keUJ5dGVzKSArICIvIiArIHZhbHVlTGVuZ3RoKHJlc3BvbnNlLmJvZHlCeXRlcykgKyAiLCByYXdCb2R5PSIgKyB2YWx1ZVR5cGUocmVzcG9uc2UucmF3Qm9keSkgKyAiLyIgKyB2YWx1ZUxlbmd0aChyZXNwb25zZS5yYXdCb2R5KSArICIsIGJpbmFyeUJvZHk9IiArIHZhbHVlVHlwZShyZXNwb25zZS5iaW5hcnlCb2R5KSArICIvIiArIHZhbHVlTGVuZ3RoKHJlc3BvbnNlLmJpbmFyeUJvZHkpKTsKICAgICAgdmFyIGJ5dGVzID0gbWVzc2FnZUJvZHlUb0J5dGVzKHJlc3BvbnNlKTsKICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcHJvYmUgc2VsZWN0ZWQgYm9keTogIiArIChieXRlcyA/IGJ5dGVzLmxlbmd0aCA6IDApICsgIiBieXRlcywgaGVhZD0iICsgKGJ5dGVzID8gaGV4UHJldmlldyhieXRlcywgMzIpIDogIjxub25lPiIpKTsKICAgIH0KICAgIGRvbmVQYXNzVGhyb3VnaCgpOwogIH0KCiAgZnVuY3Rpb24gZG9uZVN5bnRoZXRpY1Jlc3BvbnNlKGJ5dGVzLCBpbmZvKSB7CiAgICB2YXIgaGVhZGVycyA9IGhlYWRlcnNXaXRoQmluYXJ5Qm9keSh7fSwgYnl0ZXMubGVuZ3RoKTsKICAgIGlmIChpbmZvICYmIGluZm8uZGVidWcpIHsKICAgICAgaGVhZGVyc1siWC1Mb2NhdGlvbi1TcG9vZmVyLVdpZmktQ291bnQiXSA9IFN0cmluZyhpbmZvLndpZmlDb3VudCk7CiAgICAgIGhlYWRlcnNbIlgtTG9jYXRpb24tU3Bvb2Zlci1DZWxsLUNvdW50Il0gPSBTdHJpbmcoaW5mby5jZWxsQ291bnQgfHwgMCk7CiAgICB9CiAgICBpZiAoaXNMb29uUnVudGltZSgpKSB7CiAgICAgICRkb25lKHsKICAgICAgICBzdGF0dXM6IDIwMCwKICAgICAgICBoZWFkZXJzOiBoZWFkZXJzLAogICAgICAgIGJvZHk6IGJ5dGVzCiAgICAgIH0pOwogICAgICByZXR1cm47CiAgICB9CiAgICAkZG9uZSh7CiAgICAgIHJlc3BvbnNlOiB7CiAgICAgICAgc3RhdHVzOiAyMDAsCiAgICAgICAgaGVhZGVyczogaGVhZGVycywKICAgICAgICBib2R5OiBieXRlcwogICAgICB9CiAgICB9KTsKICB9CgogIGZ1bmN0aW9uIGRvbmVSZXdyaXRlUmVzcG9uc2UoYnl0ZXMsIGluZm8pIHsKICAgIHZhciBzb3VyY2VIZWFkZXJzID0gdHlwZW9mICRyZXNwb25zZSAhPT0gInVuZGVmaW5lZCIgPyAkcmVzcG9uc2UuaGVhZGVycyA6IHt9OwogICAgdmFyIGhlYWRlcnMgPSBoZWFkZXJzV2l0aEJpbmFyeUJvZHkoc291cmNlSGVhZGVycywgYnl0ZXMubGVuZ3RoKTsKICAgIGlmIChpbmZvICYmIGluZm8uZGVidWcpIHsKICAgICAgaGVhZGVyc1siWC1Mb2NhdGlvbi1TcG9vZmVyLVdpZmktQ291bnQiXSA9IFN0cmluZyhpbmZvLndpZmlDb3VudCk7CiAgICAgIGhlYWRlcnNbIlgtTG9jYXRpb24tU3Bvb2Zlci1DZWxsLUNvdW50Il0gPSBTdHJpbmcoaW5mby5jZWxsQ291bnQgfHwgMCk7CiAgICB9CiAgICBpZiAoaW5mbyAmJiBpbmZvLnRhcmdldExhdCAhPSBudWxsICYmIGluZm8udGFyZ2V0TG5nICE9IG51bGwpIHsKICAgICAgaGVhZGVyc1siWC1Mb2NhdGlvbi1TcG9vZmVyLVRhcmdldCJdID0gU3RyaW5nKGluZm8udGFyZ2V0TGF0KSArICIsIiArIFN0cmluZyhpbmZvLnRhcmdldExuZyk7CiAgICB9CiAgICBpZiAoaXNMb29uUnVudGltZSgpKSB7CiAgICAgICRkb25lKHsKICAgICAgICBzdGF0dXM6ICgkcmVzcG9uc2UgJiYgJHJlc3BvbnNlLnN0YXR1cykgfHwgMjAwLAogICAgICAgIGhlYWRlcnM6IGhlYWRlcnMsCiAgICAgICAgYm9keTogYnl0ZXMKICAgICAgfSk7CiAgICAgIHJldHVybjsKICAgIH0KICAgICRkb25lKHsKICAgICAgaGVhZGVyczogaGVhZGVycywKICAgICAgYm9keTogYnl0ZXMKICAgIH0pOwogIH0KCiAgZnVuY3Rpb24gY29udGludWVSZXNwb25zZVJld3JpdGUoY29uZmlnKSB7CiAgICB2YXIgcmVzcG9uc2VCb2R5ID0gbWVzc2FnZUJvZHlUb0J5dGVzKCRyZXNwb25zZSk7CiAgICBpZiAoIXJlc3BvbnNlQm9keSB8fCByZXNwb25zZUJvZHkubGVuZ3RoIDwgMikgewogICAgICBpZiAoY29uZmlnLmRlYnVnKSB7CiAgICAgICAgY29uc29sZS5sb2coCiAgICAgICAgICAiTG9jYXRpb24gc3Bvb2ZlciByZXNwb25zZSBib2R5IHRvbyBzaG9ydDogIiArCiAgICAgICAgICAgIChyZXNwb25zZUJvZHkgPyByZXNwb25zZUJvZHkubGVuZ3RoIDogMCkgKwogICAgICAgICAgICAiIGJ5dGVzLCBoZWFkPSIgKwogICAgICAgICAgICAocmVzcG9uc2VCb2R5ID8gaGV4UHJldmlldyhyZXNwb25zZUJvZHkpIDogIjxub25lPiIpCiAgICAgICAgKTsKICAgICAgfQogICAgICBkb25lUGFzc1Rocm91Z2goKTsKICAgICAgcmV0dXJuOwogICAgfQogICAgaWYgKGNvbmZpZy5kZWJ1ZykgewogICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciByZXNwb25zZSBib2R5OiAiICsgcmVzcG9uc2VCb2R5Lmxlbmd0aCArICIgYnl0ZXMsIGhlYWQ9IiArIGhleFByZXZpZXcocmVzcG9uc2VCb2R5LCAzMikpOwogICAgICBpZiAoaXNMb29uUnVudGltZSgpKSB7CiAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcnVudGltZTogTG9vbiIpOwogICAgICB9CiAgICB9CiAgICBsb2dIdHRwRHVtcCgicmVzcG9uc2Utb3JpZ2luYWwiLCAkcmVzcG9uc2UsIGNvbmZpZyk7CiAgICBsb2dSYXdEdW1wKCJyZXNwb25zZS1vcmlnaW5hbCIsIHJlc3BvbnNlQm9keSwgY29uZmlnKTsKICAgIHZhciByZXNwb25zZVJlc3VsdCA9IHNwb29mQXBwbGVSZXNwb25zZShyZXNwb25zZUJvZHksIGNvbmZpZyk7CiAgICBpZiAoY29uZmlnLmRlYnVnKSB7CiAgICAgIGNvbnNvbGUubG9nKAogICAgICAgICJMb2NhdGlvbiBzcG9vZmVyIHBhdGNoZWQgIiArCiAgICAgICAgICByZXNwb25zZVJlc3VsdC53aWZpQ291bnQgKwogICAgICAgICAgIiB3aWZpIGRldmljZXMsICIgKwogICAgICAgICAgcmVzcG9uc2VSZXN1bHQuY2VsbENvdW50ICsKICAgICAgICAgICIgY2VsbCB0b3dlcnMsIGtpbmQ9IiArCiAgICAgICAgICByZXNwb25zZVJlc3VsdC5raW5kICsKICAgICAgICAgICIsIHByZWZpeD0iICsKICAgICAgICAgIChyZXNwb25zZVJlc3VsdC5wcmVmaXggfHwgIjxub25lPiIpICsKICAgICAgICAgICIsIHJlc3BvbnNlPSIgKwogICAgICAgICAgcmVzcG9uc2VSZXN1bHQucmVzcG9uc2UubGVuZ3RoICsKICAgICAgICAgICIgYnl0ZXMiCiAgICAgICk7CiAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHBhdGNoZWQgbG9jYXRpb25zOiAiICsgcGF0Y2hlZFBheWxvYWRTdW1tYXJ5KHJlc3BvbnNlUmVzdWx0LnBheWxvYWQpKTsKICAgIH0KICAgIGxvZ1Jhd0R1bXAoInJlc3BvbnNlLXBhdGNoZWQiLCByZXNwb25zZVJlc3VsdC5yZXNwb25zZSwgY29uZmlnKTsKICAgIGRvbmVSZXdyaXRlUmVzcG9uc2UocmVzcG9uc2VSZXN1bHQucmVzcG9uc2UsIHsKICAgICAgd2lmaUNvdW50OiByZXNwb25zZVJlc3VsdC53aWZpQ291bnQsCiAgICAgIGNlbGxDb3VudDogcmVzcG9uc2VSZXN1bHQuY2VsbENvdW50LAogICAgICBkZWJ1ZzogY29uZmlnLmRlYnVnLAogICAgICB0YXJnZXRMYXQ6IGNvbmZpZy5sYXRpdHVkZSwKICAgICAgdGFyZ2V0TG5nOiBjb25maWcubG9uZ2l0dWRlCiAgICB9KTsKICB9CgogIGZ1bmN0aW9uIHByZXBhcmVSZXNwb25zZUJvZHkoY29uZmlnKSB7CiAgICBwcmVwYXJlUmVzcG9uc2VCb2R5U3luYyhjb25maWcpOwogIH0KCiAgZnVuY3Rpb24gcnVuU2hhZG93cm9ja2V0KCkgewogICAgdmFyIGhhc1JlcXVlc3QgPSB0eXBlb2YgJHJlcXVlc3QgIT09ICJ1bmRlZmluZWQiICYmICRyZXF1ZXN0ICE9IG51bGw7CiAgICB2YXIgaGFzUmVzcG9uc2UgPSB0eXBlb2YgJHJlc3BvbnNlICE9PSAidW5kZWZpbmVkIiAmJiAkcmVzcG9uc2UgIT0gbnVsbDsKCiAgICBpZiAoIWhhc1JlcXVlc3QgJiYgIWhhc1Jlc3BvbnNlKSB7CiAgICAgIHJ1bk1haW50ZW5hbmNlQ3JvbigpOwogICAgICByZXR1cm47CiAgICB9CgogICAgaWYgKGhhc1JlcXVlc3QgJiYgIWhhc1Jlc3BvbnNlKSB7CiAgICAgIHZhciBwcmVwQXJncyA9IHJlYWRTY3JpcHRBcmd1bWVudHMoKTsKICAgICAgaWYgKHBhcnNlQm9vbGVhbihwcmVwQXJncy5kZWJ1ZywgZmFsc2UpKSB7CiAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcHJlcGFyZSAtPiBBY2NlcHQtRW5jb2Rpbmc6IGlkZW50aXR5Iik7CiAgICAgIH0KICAgICAgZG9uZVByZXBhcmVkUmVxdWVzdFBhc3NUaHJvdWdoKCk7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBsb2FkUnVudGltZUNvbmZpZyhmdW5jdGlvbiAoY29uZmlnKSB7CiAgICAgIHRyeSB7CiAgICAgICAgaWYgKCFjb25maWcuZW5hYmxlZCkgewogICAgICAgICAgZG9uZVBhc3NUaHJvdWdoKCk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQoKICAgICAgICBpZiAoY29uZmlnLm1vZGUgPT09ICJpbnNwZWN0IikgewogICAgICAgICAgZG9uZUluc3BlY3QoY29uZmlnLCBoYXNSZXNwb25zZSk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQoKICAgICAgICBpZiAoaGFzUmVzcG9uc2UpIHsKICAgICAgICAgIGlmIChjb25maWcuZGVidWcpIHsKICAgICAgICAgICAgY29uc29sZS5sb2coCiAgICAgICAgICAgICAgIkxvY2F0aW9uIHNwb29mZXIgaW50ZXJjZXB0IC0+IGxhdD0iICsKICAgICAgICAgICAgICAgIGNvbmZpZy5sYXRpdHVkZSArCiAgICAgICAgICAgICAgICAiLCBsbmc9IiArCiAgICAgICAgICAgICAgICBjb25maWcubG9uZ2l0dWRlICsKICAgICAgICAgICAgICAgICIsIHVybD0iICsKICAgICAgICAgICAgICAgICgoJHJlcXVlc3QgJiYgJHJlcXVlc3QudXJsKSB8fCAiPG5vbmU+IikKICAgICAgICAgICAgKTsKICAgICAgICAgIH0KICAgICAgICAgIGlmIChjb25maWcubW9kZSA9PT0gInByb2JlIikgewogICAgICAgICAgICBkb25lUmVzcG9uc2VQcm9iZShjb25maWcpOwogICAgICAgICAgICByZXR1cm47CiAgICAgICAgICB9CiAgICAgICAgICBpZiAoY29uZmlnLm1vZGUgIT09ICJyZXNwb25zZSIpIHsKICAgICAgICAgICAgZG9uZVBhc3NUaHJvdWdoKCk7CiAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgIH0KICAgICAgICAgIHByZXBhcmVSZXNwb25zZUJvZHkoY29uZmlnKTsKICAgICAgICAgIGNvbnRpbnVlUmVzcG9uc2VSZXdyaXRlKGNvbmZpZyk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQoKICAgICAgICBpZiAoY29uZmlnLm1vZGUgIT09ICJyZXF1ZXN0IikgewogICAgICAgICAgZG9uZVBhc3NUaHJvdWdoKCk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIHZhciByZXF1ZXN0Qm9keSA9IG1lc3NhZ2VCb2R5VG9CeXRlcygkcmVxdWVzdCk7CiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1ZykgewogICAgICAgICAgY29uc29sZS5sb2coIkxvY2F0aW9uIHNwb29mZXIgcmVxdWVzdCBtb2RlIGJvZHkgbGVuZ3RoOiAiICsgKHJlcXVlc3RCb2R5ID8gcmVxdWVzdEJvZHkubGVuZ3RoIDogMCkpOwogICAgICAgIH0KICAgICAgICBpZiAoIXJlcXVlc3RCb2R5KSB7CiAgICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJlcXVlc3QgYm9keSB1bmF2YWlsYWJsZSIpOwogICAgICAgICAgfQogICAgICAgICAgZG9uZVBhc3NUaHJvdWdoKCk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQogICAgICAgIGlmIChyZXF1ZXN0Qm9keS5sZW5ndGggPCAyKSB7CiAgICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSB7CiAgICAgICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJlcXVlc3QgYm9keSB0b28gc2hvcnQ6ICIgKyByZXF1ZXN0Qm9keS5sZW5ndGggKyAiIGJ5dGVzLCBoZWFkPSIgKyBoZXhQcmV2aWV3KHJlcXVlc3RCb2R5KSk7CiAgICAgICAgICB9CiAgICAgICAgICBkb25lUGFzc1Rocm91Z2goKTsKICAgICAgICAgIHJldHVybjsKICAgICAgICB9CiAgICAgICAgbG9nSHR0cER1bXAoInJlcXVlc3Qtb3JpZ2luYWwiLCAkcmVxdWVzdCwgY29uZmlnKTsKICAgICAgICBsb2dSYXdEdW1wKCJyZXF1ZXN0LW9yaWdpbmFsIiwgcmVxdWVzdEJvZHksIGNvbmZpZyk7CiAgICAgICAgdmFyIHJlcXVlc3RSZXN1bHQgPSBzcG9vZkFycGNSZXF1ZXN0KHJlcXVlc3RCb2R5LCBjb25maWcpOwogICAgICAgIGlmIChjb25maWcuZGVidWcpIHsKICAgICAgICAgIGNvbnNvbGUubG9nKCJMb2NhdGlvbiBzcG9vZmVyIHJlcXVlc3Qgc3ludGhldGljIHJlc3BvbnNlOiBwYXRjaGVkICIgKyByZXF1ZXN0UmVzdWx0LndpZmlDb3VudCArICIgd2lmaSBkZXZpY2VzLCAiICsgcmVxdWVzdFJlc3VsdC5jZWxsQ291bnQgKyAiIGNlbGwgdG93ZXJzLCByZXNwb25zZT0iICsgcmVxdWVzdFJlc3VsdC5yZXNwb25zZS5sZW5ndGggKyAiIGJ5dGVzIik7CiAgICAgICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBwYXRjaGVkIGxvY2F0aW9uczogIiArIHBhdGNoZWRQYXlsb2FkU3VtbWFyeShyZXF1ZXN0UmVzdWx0LnBheWxvYWQpKTsKICAgICAgICB9CiAgICAgICAgbG9nUmF3RHVtcCgicmVxdWVzdC1zeW50aGV0aWMtcmVzcG9uc2UiLCByZXF1ZXN0UmVzdWx0LnJlc3BvbnNlLCBjb25maWcpOwogICAgICAgIGRvbmVTeW50aGV0aWNSZXNwb25zZShyZXF1ZXN0UmVzdWx0LnJlc3BvbnNlLCB7CiAgICAgICAgICB3aWZpQ291bnQ6IHJlcXVlc3RSZXN1bHQud2lmaUNvdW50LAogICAgICAgICAgY2VsbENvdW50OiByZXF1ZXN0UmVzdWx0LmNlbGxDb3VudCwKICAgICAgICAgIGRlYnVnOiBjb25maWcuZGVidWcKICAgICAgICB9KTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1ZykgewogICAgICAgICAgdmFyIGRpYWdCb2R5ID0gaGFzUmVzcG9uc2UgPyBtZXNzYWdlQm9keVRvQnl0ZXMoJHJlc3BvbnNlKSA6IG1lc3NhZ2VCb2R5VG9CeXRlcygkcmVxdWVzdCk7CiAgICAgICAgICBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBmYWlsZWQ6ICIgKyBlcnIubWVzc2FnZSArICIgfCBib2R5TGVuPSIgKyAoZGlhZ0JvZHkgPyBkaWFnQm9keS5sZW5ndGggOiAwKSArICIgaGVhZD0iICsgKGRpYWdCb2R5ID8gaGV4UHJldmlldyhkaWFnQm9keSwgMzIpIDogIjxub25lPiIpKTsKICAgICAgICB9CiAgICAgICAgaWYgKGNvbmZpZy5mYWlsT3BlbiAhPT0gZmFsc2UpIHsKICAgICAgICAgIGRvbmVQYXNzVGhyb3VnaCgpOwogICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KICAgICAgICAkZG9uZSh7CiAgICAgICAgICByZXNwb25zZTogewogICAgICAgICAgICBzdGF0dXM6ICJIVFRQLzEuMSA1MDAgSW50ZXJuYWwgU2VydmVyIEVycm9yIiwKICAgICAgICAgICAgaGVhZGVyczogeyAiQ29udGVudC1UeXBlIjogInRleHQvcGxhaW4iIH0sCiAgICAgICAgICAgIGJvZHk6ICJsb2NhdGlvbiBzcG9vZmVyIGZhaWxlZDogIiArIGVyci5tZXNzYWdlCiAgICAgICAgICB9CiAgICAgICAgfSk7CiAgICAgIH0KICAgIH0pOwogIH0KCiAgdmFyIGFwaSA9IHsKICAgIERFRkFVTFRfQ09ORklHOiBERUZBVUxUX0NPTkZJRywKICAgIEFQUExFX1dMT0NfUFJFRklYOiBBUFBMRV9XTE9DX1BSRUZJWCwKICAgIEFQUExFX1dMT0NfTUFSS0VSOiBBUFBMRV9XTE9DX01BUktFUiwKICAgIGJvZHlUb0J5dGVzOiBib2R5VG9CeXRlcywKICAgIG1lc3NhZ2VCb2R5VG9CeXRlczogbWVzc2FnZUJvZHlUb0J5dGVzLAogICAgaGV4UHJldmlldzogaGV4UHJldmlldywKICAgIGJ5dGVzVG9CaW5hcnlTdHJpbmc6IGJ5dGVzVG9CaW5hcnlTdHJpbmcsCiAgICBieXRlc1RvQmFzZTY0OiBieXRlc1RvQmFzZTY0LAogICAgYmluYXJ5U3RyaW5nVG9CeXRlczogYmluYXJ5U3RyaW5nVG9CeXRlcywKICAgIGNvbmNhdEJ5dGVzOiBjb25jYXRCeXRlcywKICAgIHJlYWRVSW50MTZCRTogcmVhZFVJbnQxNkJFLAogICAgd3JpdGVVSW50MTZCRTogd3JpdGVVSW50MTZCRSwKICAgIGVuY29kZVZhcmludFVuc2lnbmVkOiBlbmNvZGVWYXJpbnRVbnNpZ25lZCwKICAgIGVuY29kZVZhcmludFNpZ25lZEludDY0OiBlbmNvZGVWYXJpbnRTaWduZWRJbnQ2NCwKICAgIGRlY29kZVZhcmludDogZGVjb2RlVmFyaW50LAogICAgbWFrZVZhcmludEZpZWxkOiBtYWtlVmFyaW50RmllbGQsCiAgICBtYWtlTGVuZ3RoRGVsaW1pdGVkRmllbGQ6IG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZCwKICAgIHBhcnNlRmllbGRzOiBwYXJzZUZpZWxkcywKICAgIHRyeVBhcnNlRmllbGRzOiB0cnlQYXJzZUZpZWxkcywKICAgIGZpcnN0RmllbGRCeU51bWJlcjogZmlyc3RGaWVsZEJ5TnVtYmVyLAogICAgbG9jYXRpb25TdW1tYXJ5OiBsb2NhdGlvblN1bW1hcnksCiAgICBwYXRjaGVkUGF5bG9hZFN1bW1hcnk6IHBhdGNoZWRQYXlsb2FkU3VtbWFyeSwKICAgIGNvb3JkVG9JbnQ6IGNvb3JkVG9JbnQsCiAgICBub3JtYWxpemVDb25maWc6IG5vcm1hbGl6ZUNvbmZpZywKICAgIHBhdGNoTG9jYXRpb246IHBhdGNoTG9jYXRpb24sCiAgICBwYXRjaFdpZmlEZXZpY2U6IHBhdGNoV2lmaURldmljZSwKICAgIHBhdGNoQ2VsbFRvd2VyOiBwYXRjaENlbGxUb3dlciwKICAgIHBhdGNoQXBwbGVXTG9jUGF5bG9hZDogcGF0Y2hBcHBsZVdMb2NQYXlsb2FkLAogICAgcGFyc2VBcnBjOiBwYXJzZUFycGMsCiAgICBzZXJpYWxpemVBcnBjOiBzZXJpYWxpemVBcnBjLAogICAgYnVpbGRBcHBsZVdMb2NSZXNwb25zZTogYnVpbGRBcHBsZVdMb2NSZXNwb25zZSwKICAgIGV4dHJhY3RBcHBsZVdMb2NQYXlsb2FkOiBleHRyYWN0QXBwbGVXTG9jUGF5bG9hZCwKICAgIHNwb29mQXJwY1JlcXVlc3Q6IHNwb29mQXJwY1JlcXVlc3QsCiAgICBzcG9vZkFwcGxlUmVzcG9uc2U6IHNwb29mQXBwbGVSZXNwb25zZSwKICAgIHBhcnNlQXJndW1lbnRTdHJpbmc6IHBhcnNlQXJndW1lbnRTdHJpbmcsCiAgICByZWFkU2NyaXB0QXJndW1lbnRzOiByZWFkU2NyaXB0QXJndW1lbnRzLAogICAgZ2VvY29kZUFkZHJlc3M6IGdlb2NvZGVBZGRyZXNzLAogICAgcHJlcGFyZVJlcXVlc3RIZWFkZXJzOiBwcmVwYXJlUmVxdWVzdEhlYWRlcnMKICB9OwoKICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gInVuZGVmaW5lZCIgJiYgbW9kdWxlLmV4cG9ydHMpIHsKICAgIG1vZHVsZS5leHBvcnRzID0gYXBpOwogIH0gZWxzZSB7CiAgICBydW5TaGFkb3dyb2NrZXQoKTsKICB9Cn0oKSk7Cg==";
const LOCATION_SETTINGS_B64 = "LyoKICogbG9jYXRpb24tc2V0dGluZ3MuanMg4oCUIHN0YXRlbGVzcyBzYXZlLWludGVyY2VwdG9yIGZvciBpT1MgTG9jYXRpb24gU3Bvb2Zlci4KICoKICogUnVucyBhcyBhbiBodHRwLVJFUVVFU1Qgc2NyaXB0IG9uIGdzLWxvYy5hcHBsZS5jb20vaWxzLXNldHRpbmdzL+KApiBhbmQgYW5zd2VycyB0aGUKICogcmVxdWVzdCBpdHNlbGYgKG5ldmVyIGhpdHMgQXBwbGUpLiBJdCB3cml0ZXMgdGhlIHBpY2tlZCBwb2ludCBpbnRvIFRISVMgZGV2aWNlJ3Mgb3duCiAqICRwZXJzaXN0ZW50U3RvcmUsIHVzaW5nIHRoZSBleGFjdCBrZXlzIGxvY2F0aW9uLXNwb29mZXIuanMgYWxyZWFkeSByZWFkcyB2aWEKICogZW5yaWNoQXJnc0Zyb21QbHVnaW5TdG9yZTogYGxhdGl0dWRlYCwgYGxvbmdpdHVkZWAsIGBhbHRpdHVkZWAsIGBlbmFibGVkYC4KICoKICogTm90aGluZyBpcyBzdG9yZWQgc2VydmVyLXNpZGUsIHNvIG9uZSBwdWJsaWMgcGlja2VyIHBhZ2UgY2FuIGJlIHNoYXJlZCBieSBhbnkgbnVtYmVyIG9mCiAqIHBlb3BsZSDigJQgZWFjaCBwZXJzb24gd3JpdGVzIG9ubHkgdGhlaXIgb3duIGRldmljZS4gYGVuYWJsZWRgIGdhdGVzIHNwb29maW5nOiBjbGVhcmVkIC8KICogbmV2ZXItcGlja2VkIOKGkiBlbmFibGVkPWZhbHNlIOKGkiBsb2NhdGlvbi1zcG9vZmVyLmpzIHBhc3NlcyB0aHJvdWdoIHRoZSByZWFsIGxvY2F0aW9uCiAqICh0aGlzIHBhaXJzIHdpdGggREVGQVVMVF9DT05GSUcuZW5hYmxlZD1mYWxzZSBpbiBsb2NhdGlvbi1zcG9vZmVyLmpzKS4KICoKICogICBHRVQg4oCmL2lscy1zZXR0aW5ncy9zYXZlP2xhdD0mbG9uPSZhbHQ9ICAg4oaSIHN0b3JlIGNvb3JkcyAoK2FsdGl0dWRlKSBhbmQgZW5hYmxlCiAqICAgR0VUIOKApi9pbHMtc2V0dGluZ3Mvc2F2ZT9hY3Rpb249cXVlcnkgICAgICDihpIgcmV0dXJuIHRoZSBkZXZpY2UncyBjdXJyZW50IHN0b3JlZCBwb2ludAogKiAgIEdFVCDigKYvaWxzLXNldHRpbmdzL3NhdmU/YWN0aW9uPWNsZWFyICAgICAg4oaSIGVuYWJsZWQ9ZmFsc2UgKHJlc3RvcmUgcmVhbCBsb2NhdGlvbikKICoKICogU3VwcG9ydGVkIGNsaWVudHM6IFN1cmdlIC8gU2hhZG93cm9ja2V0IC8gTG9vbiAvIFN0YXNoIC8gRWdlcm4gKCRwZXJzaXN0ZW50U3RvcmUpIGFuZAogKiBRdWFudHVtdWx0IFggKCRwcmVmcykuCiAqLwooZnVuY3Rpb24gKCkgewogICJ1c2Ugc3RyaWN0IjsKCiAgdmFyIGlzUXVhblggPSB0eXBlb2YgJHRhc2sgIT09ICJ1bmRlZmluZWQiOwoKICBmdW5jdGlvbiByZWFkS2V5KGspIHsKICAgIHRyeSB7CiAgICAgIHJldHVybiBpc1F1YW5YID8gJHByZWZzLnZhbHVlRm9yS2V5KGspIDogJHBlcnNpc3RlbnRTdG9yZS5yZWFkKGspOwogICAgfSBjYXRjaCAoZSkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICB9CiAgZnVuY3Rpb24gd3JpdGVLZXkoaywgdikgewogICAgdHJ5IHsKICAgICAgcmV0dXJuIGlzUXVhblggPyAkcHJlZnMuc2V0VmFsdWVGb3JLZXkoU3RyaW5nKHYpLCBrKSA6ICRwZXJzaXN0ZW50U3RvcmUud3JpdGUoU3RyaW5nKHYpLCBrKTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgcmV0dXJuIGZhbHNlOwogICAgfQogIH0KCiAgZnVuY3Rpb24gcGFyc2VRdWVyeSh1cmwpIHsKICAgIHZhciBvdXQgPSB7fTsKICAgIHZhciBxaSA9IHVybC5pbmRleE9mKCI/Iik7CiAgICBpZiAocWkgPCAwKSByZXR1cm4gb3V0OwogICAgdmFyIHBhcnRzID0gdXJsLnNsaWNlKHFpICsgMSkuc3BsaXQoIiYiKTsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpICs9IDEpIHsKICAgICAgaWYgKCFwYXJ0c1tpXSkgY29udGludWU7CiAgICAgIHZhciBlcSA9IHBhcnRzW2ldLmluZGV4T2YoIj0iKTsKICAgICAgdmFyIGsgPSBlcSA8IDAgPyBwYXJ0c1tpXSA6IHBhcnRzW2ldLnNsaWNlKDAsIGVxKTsKICAgICAgdmFyIHYgPSBlcSA8IDAgPyAiIiA6IHBhcnRzW2ldLnNsaWNlKGVxICsgMSk7CiAgICAgIHRyeSB7IGsgPSBkZWNvZGVVUklDb21wb25lbnQoay5yZXBsYWNlKC9cKy9nLCAiICIpKTsgfSBjYXRjaCAoZSkge30KICAgICAgdHJ5IHsgdiA9IGRlY29kZVVSSUNvbXBvbmVudCh2LnJlcGxhY2UoL1wrL2csICIgIikpOyB9IGNhdGNoIChlKSB7fQogICAgICBpZiAoIShrIGluIG91dCkpIG91dFtrXSA9IHY7CiAgICB9CiAgICByZXR1cm4gb3V0OwogIH0KCiAgZnVuY3Rpb24gZmluaXRlTnVtKHMpIHsKICAgIGlmIChzID09IG51bGwgfHwgcyA9PT0gIiIpIHJldHVybiBOYU47CiAgICB2YXIgbiA9IHBhcnNlRmxvYXQocyk7CiAgICByZXR1cm4gaXNGaW5pdGUobikgPyBuIDogTmFOOwogIH0KCiAgdmFyIHVybCA9ICh0eXBlb2YgJHJlcXVlc3QgIT09ICJ1bmRlZmluZWQiICYmICRyZXF1ZXN0ICYmICRyZXF1ZXN0LnVybCkgfHwgIiI7CiAgdmFyIHEgPSBwYXJzZVF1ZXJ5KHVybCk7CiAgdmFyIGFjdGlvbiA9IHEuYWN0aW9uIHx8ICJzYXZlIjsKICB2YXIgcmVzdWx0OwoKICBpZiAoYWN0aW9uID09PSAicXVlcnkiKSB7CiAgICB2YXIgcWxhdCA9IHJlYWRLZXkoImxhdGl0dWRlIik7CiAgICB2YXIgcWxvbiA9IHJlYWRLZXkoImxvbmdpdHVkZSIpOwogICAgdmFyIHFhbHQgPSByZWFkS2V5KCJhbHRpdHVkZSIpOwogICAgdmFyIHFlbiA9IHJlYWRLZXkoImVuYWJsZWQiKTsKICAgIHZhciBxaGFjYyA9IHJlYWRLZXkoImhvcml6b250YWxBY2N1cmFjeSIpOwogICAgdmFyIHF2YWNjID0gcmVhZEtleSgidmVydGljYWxBY2N1cmFjeSIpOwogICAgaWYgKHFsYXQgIT0gbnVsbCAmJiBxbGF0ICE9PSAiIiAmJiBxbG9uICE9IG51bGwgJiYgcWxvbiAhPT0gIiIpIHsKICAgICAgcmVzdWx0ID0gewogICAgICAgIHN1Y2Nlc3M6IHRydWUsCiAgICAgICAgbGF0aXR1ZGU6IE51bWJlcihxbGF0KSwKICAgICAgICBsb25naXR1ZGU6IE51bWJlcihxbG9uKSwKICAgICAgICBhbHRpdHVkZTogcWFsdCAhPSBudWxsICYmIHFhbHQgIT09ICIiID8gTnVtYmVyKHFhbHQpIDogbnVsbCwKICAgICAgICBob3Jpem9udGFsQWNjdXJhY3k6IHFoYWNjICE9IG51bGwgJiYgcWhhY2MgIT09ICIiID8gTnVtYmVyKHFoYWNjKSA6IG51bGwsCiAgICAgICAgdmVydGljYWxBY2N1cmFjeTogcXZhY2MgIT0gbnVsbCAmJiBxdmFjYyAhPT0gIiIgPyBOdW1iZXIocXZhY2MpIDogbnVsbCwKICAgICAgICBlbmFibGVkOiBTdHJpbmcocWVuKSA9PT0gInRydWUiCiAgICAgIH07CiAgICB9IGVsc2UgewogICAgICByZXN1bHQgPSB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogIk5vIHNhdmVkIGNvb3JkaW5hdGVzIiB9OwogICAgfQogIH0gZWxzZSBpZiAoYWN0aW9uID09PSAiY2xlYXIiKSB7CiAgICB3cml0ZUtleSgiZW5hYmxlZCIsICJmYWxzZSIpOwogICAgcmVzdWx0ID0geyBzdWNjZXNzOiB0cnVlIH07CiAgfSBlbHNlIHsKICAgIHZhciBsb24gPSBmaW5pdGVOdW0ocS5sb24gIT0gbnVsbCA/IHEubG9uIDogcS5sb25naXR1ZGUpOwogICAgdmFyIGxhdCA9IGZpbml0ZU51bShxLmxhdCAhPSBudWxsID8gcS5sYXQgOiBxLmxhdGl0dWRlKTsKICAgIHZhciBhbHQgPSBmaW5pdGVOdW0ocS5hbHQgIT0gbnVsbCA/IHEuYWx0IDogcS5hbHRpdHVkZSk7CiAgICB2YXIgaGFjYyA9IGZpbml0ZU51bShxLmhhY2MgIT0gbnVsbCA/IHEuaGFjYyA6IHEuaG9yaXpvbnRhbEFjY3VyYWN5KTsKICAgIHZhciB2YWNjID0gZmluaXRlTnVtKHEudmFjYyAhPSBudWxsID8gcS52YWNjIDogcS52ZXJ0aWNhbEFjY3VyYWN5KTsKICAgIGlmIChpc0Zpbml0ZShsb24pICYmIGlzRmluaXRlKGxhdCkpIHsKICAgICAgd3JpdGVLZXkoImxhdGl0dWRlIiwgU3RyaW5nKGxhdCkpOwogICAgICB3cml0ZUtleSgibG9uZ2l0dWRlIiwgU3RyaW5nKGxvbikpOwogICAgICBpZiAoaXNGaW5pdGUoYWx0KSkgd3JpdGVLZXkoImFsdGl0dWRlIiwgU3RyaW5nKE1hdGgucm91bmQoYWx0KSkpOwogICAgICBpZiAoaXNGaW5pdGUoaGFjYykpIHdyaXRlS2V5KCJob3Jpem9udGFsQWNjdXJhY3kiLCBTdHJpbmcoTWF0aC5yb3VuZChoYWNjKSkpOwogICAgICBpZiAoaXNGaW5pdGUodmFjYykpIHdyaXRlS2V5KCJ2ZXJ0aWNhbEFjY3VyYWN5IiwgU3RyaW5nKE1hdGgucm91bmQodmFjYykpKTsKICAgICAgd3JpdGVLZXkoImVuYWJsZWQiLCAidHJ1ZSIpOwogICAgICByZXN1bHQgPSB7IHN1Y2Nlc3M6IHRydWUsIGxhdGl0dWRlOiBsYXQsIGxvbmdpdHVkZTogbG9uIH07CiAgICAgIGlmIChpc0Zpbml0ZShhbHQpKSByZXN1bHQuYWx0aXR1ZGUgPSBNYXRoLnJvdW5kKGFsdCk7CiAgICAgIGlmIChpc0Zpbml0ZShoYWNjKSkgcmVzdWx0Lmhvcml6b250YWxBY2N1cmFjeSA9IE1hdGgucm91bmQoaGFjYyk7CiAgICAgIGlmIChpc0Zpbml0ZSh2YWNjKSkgcmVzdWx0LnZlcnRpY2FsQWNjdXJhY3kgPSBNYXRoLnJvdW5kKHZhY2MpOwogICAgfSBlbHNlIHsKICAgICAgcmVzdWx0ID0geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICJtaXNzaW5nIGxhdC9sb24gcGFyYW1ldGVycyIgfTsKICAgIH0KICB9CgogIHZhciBoZWFkZXJzID0gewogICAgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiwKICAgICJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4iOiAiKiIsCiAgICAiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyI6ICJHRVQsIE9QVElPTlMiCiAgfTsKICB2YXIgYm9keSA9IEpTT04uc3RyaW5naWZ5KHJlc3VsdCk7CgogIGlmIChpc1F1YW5YKSB7CiAgICAkZG9uZSh7IHN0YXR1czogIkhUVFAvMS4xIDIwMCBPSyIsIGhlYWRlcnM6IGhlYWRlcnMsIGJvZHk6IGJvZHkgfSk7CiAgfSBlbHNlIHsKICAgICRkb25lKHsgcmVzcG9uc2U6IHsgc3RhdHVzOiAyMDAsIGhlYWRlcnM6IGhlYWRlcnMsIGJvZHk6IGJvZHkgfSB9KTsKICB9Cn0pKCk7Cg==";
const LOCATION_SPOOFER_QX_B64 = "LyoKICogUVgg55qEICRyZXNwb25zZS5ib2R5IOe7meeahOaYryBiYXNlNjQg5a2X56ym5Liy77yI5LiN5pivIFVpbnQ4QXJyYXnvvInvvIwKICog5omA5Lul6L+Z54mI5aSa5LqG5LiA5q2lIGJhc2U2NCDihpQgYnl0ZXMg55qE6L2s5o2i77yM5YW25LuW6YC76L6R5ZKM5Li754mI5LiA5qC344CCCiAqLwooZnVuY3Rpb24gKCkgewogICJ1c2Ugc3RyaWN0IjsKCiAgdmFyIERFRkFVTFRfQ09ORklHID0gewogICAgLy8gU3RhdGVsZXNzIGRlZmF1bHQ6IE9GRiB1bnRpbCB0aGUgcGlja2VyIHdyaXRlcyBjb29yZGluYXRlcyB0byB0aGlzIGRldmljZSdzIG93bgogICAgLy8gJHByZWZzLiAiTm90aGluZyBwaWNrZWQgeWV0IiB0aGVuIGZhbGxzIHRocm91Z2ggdG8gdGhlIHJlYWwgbG9jYXRpb24uCiAgICBlbmFibGVkOiBmYWxzZSwKICAgIGxhdGl0dWRlOiAzNy4zMzQ5LAogICAgbG9uZ2l0dWRlOiAtMTIyLjAwOTAyLAogICAgaG9yaXpvbnRhbEFjY3VyYWN5OiAzOSwKICAgIHZlcnRpY2FsQWNjdXJhY3k6IDEwMDAsCiAgICBhbHRpdHVkZTogNTMwLAogICAgdW5rbm93blZhbHVlNDogMywKICAgIG1vdGlvbkFjdGl2aXR5VHlwZTogNjMsCiAgICBtb3Rpb25BY3Rpdml0eUNvbmZpZGVuY2U6IDQ2NywKICAgIGZhaWxPcGVuOiB0cnVlLAogICAgZGVidWc6IGZhbHNlCiAgfTsKCiAgdmFyIEFQUExFX1dMT0NfUFJFRklYID0gbmV3IFVpbnQ4QXJyYXkoWzB4MDAsIDB4MDEsIDB4MDAsIDB4MDAsIDB4MDAsIDB4MDEsIDB4MDAsIDB4MDBdKTsKICB2YXIgQVBQTEVfV0xPQ19NQVJLRVIgPSBuZXcgVWludDhBcnJheShbMHgwMCwgMHgwMCwgMHgwMCwgMHgwMSwgMHgwMCwgMHgwMF0pOwogIHZhciBST09UX0RST1BfRklFTERTID0geyAzOiB0cnVlLCA0OiB0cnVlLCAzMzogdHJ1ZSB9OwogIHZhciBDRUxMX1JFU1BPTlNFX0ZJRUxEUyA9IHsgMjI6IHRydWUsIDI0OiB0cnVlIH07CiAgdmFyIExPQ0FUSU9OX1JFUExBQ0VEX0ZJRUxEUyA9IHsgMTogdHJ1ZSwgMjogdHJ1ZSwgMzogdHJ1ZSwgNDogdHJ1ZSwgNTogdHJ1ZSwgNjogdHJ1ZSwgMTE6IHRydWUsIDEyOiB0cnVlIH07CgogIC8vID09PT09PT09PT0gQnl0ZSBVdGlsaXRpZXMgPT09PT09PT09PQoKICBmdW5jdGlvbiBjb25jYXRCeXRlcyhwYXJ0cykgewogICAgdmFyIHRvdGFsID0gMCwgaTsKICAgIGZvciAoaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykgdG90YWwgKz0gcGFydHNbaV0ubGVuZ3RoOwogICAgdmFyIG91dCA9IG5ldyBVaW50OEFycmF5KHRvdGFsKSwgb2Zmc2V0ID0gMDsKICAgIGZvciAoaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykgeyBvdXQuc2V0KHBhcnRzW2ldLCBvZmZzZXQpOyBvZmZzZXQgKz0gcGFydHNbaV0ubGVuZ3RoOyB9CiAgICByZXR1cm4gb3V0OwogIH0KCiAgZnVuY3Rpb24gZmluZEJ5dGVzKGJ5dGVzLCBtYXJrZXIpIHsKICAgIGlmICghYnl0ZXMgfHwgIW1hcmtlciB8fCBtYXJrZXIubGVuZ3RoID09PSAwKSByZXR1cm4gLTE7CiAgICBmb3IgKHZhciBpID0gMDsgaSA8PSBieXRlcy5sZW5ndGggLSBtYXJrZXIubGVuZ3RoOyBpKyspIHsKICAgICAgdmFyIG9rID0gdHJ1ZTsKICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBtYXJrZXIubGVuZ3RoOyBqKyspIHsgaWYgKGJ5dGVzW2kgKyBqXSAhPT0gbWFya2VyW2pdKSB7IG9rID0gZmFsc2U7IGJyZWFrOyB9IH0KICAgICAgaWYgKG9rKSByZXR1cm4gaTsKICAgIH0KICAgIHJldHVybiAtMTsKICB9CgogIGZ1bmN0aW9uIGhleFByZXZpZXcoYnl0ZXMsIGxpbWl0KSB7CiAgICBpZiAoIWJ5dGVzKSByZXR1cm4gIjxub25lPiI7CiAgICB2YXIgb3V0ID0gW10sIG1heCA9IE1hdGgubWluKGJ5dGVzLmxlbmd0aCwgbGltaXQgfHwgMTYpOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYXg7IGkrKykgb3V0LnB1c2goKCIwIiArIGJ5dGVzW2ldLnRvU3RyaW5nKDE2KSkuc2xpY2UoLTIpKTsKICAgIHJldHVybiBvdXQuam9pbigiIik7CiAgfQoKICAvLyA9PT09PT09PT09IEJhc2U2NCAoUVgg5LiT55SoKSA9PT09PT09PT09CgogIGZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMoYjY0KSB7CiAgICB2YXIgYWxwaGFiZXQgPSAiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyI7CiAgICB2YXIgbG9va3VwID0ge30sIGk7CiAgICBmb3IgKGkgPSAwOyBpIDwgYWxwaGFiZXQubGVuZ3RoOyBpKyspIGxvb2t1cFthbHBoYWJldFtpXV0gPSBpOwogICAgYjY0ID0gYjY0LnJlcGxhY2UoL1teQS1aYS16MC05XCtcL10vZywgIiIpOwogICAgdmFyIGxlbiA9IGI2NC5sZW5ndGgsIG91dCA9IFtdLCBwYWRkaW5nID0gMDsKICAgIGlmIChsZW4gPiAwICYmIGI2NFtsZW4gLSAxXSA9PT0gIj0iKSBwYWRkaW5nKys7CiAgICBpZiAobGVuID4gMSAmJiBiNjRbbGVuIC0gMl0gPT09ICI9IikgcGFkZGluZysrOwogICAgdmFyIGJ1ZkxlbiA9IChsZW4gLyA0KSAqIDMgLSBwYWRkaW5nOwogICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KGJ1ZkxlbiksIHBvcyA9IDA7CiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpICs9IDQpIHsKICAgICAgdmFyIGVuYzEgPSBsb29rdXBbYjY0W2ldXSwgZW5jMiA9IGxvb2t1cFtiNjRbaSArIDFdXSwgZW5jMyA9IGxvb2t1cFtiNjRbaSArIDJdXSwgZW5jNCA9IGxvb2t1cFtiNjRbaSArIDNdXTsKICAgICAgdmFyIGNocjEgPSAoZW5jMSA8PCAyKSB8IChlbmMyID4+IDQpOwogICAgICB2YXIgY2hyMiA9ICgoZW5jMiAmIDE1KSA8PCA0KSB8IChlbmMzID4+IDIpOwogICAgICB2YXIgY2hyMyA9ICgoZW5jMyAmIDMpIDw8IDYpIHwgZW5jNDsKICAgICAgYnVmW3BvcysrXSA9IGNocjE7CiAgICAgIGlmIChlbmMzICE9PSA2NCkgYnVmW3BvcysrXSA9IGNocjI7CiAgICAgIGlmIChlbmM0ICE9PSA2NCkgYnVmW3BvcysrXSA9IGNocjM7CiAgICB9CiAgICByZXR1cm4gYnVmOwogIH0KCiAgZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NChieXRlcykgewogICAgdmFyIGFscGhhYmV0ID0gIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8iOwogICAgdmFyIG91dCA9ICIiOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMykgewogICAgICB2YXIgYjAgPSBieXRlc1tpXSwgYjEgPSBpICsgMSA8IGJ5dGVzLmxlbmd0aCA/IGJ5dGVzW2kgKyAxXSA6IDAsIGIyID0gaSArIDIgPCBieXRlcy5sZW5ndGggPyBieXRlc1tpICsgMl0gOiAwOwogICAgICB2YXIgdHJpcGxldCA9IChiMCA8PCAxNikgfCAoYjEgPDwgOCkgfCBiMjsKICAgICAgb3V0ICs9IGFscGhhYmV0Wyh0cmlwbGV0ID4+IDE4KSAmIDB4M2ZdICsgYWxwaGFiZXRbKHRyaXBsZXQgPj4gMTIpICYgMHgzZl07CiAgICAgIG91dCArPSBpICsgMSA8IGJ5dGVzLmxlbmd0aCA/IGFscGhhYmV0Wyh0cmlwbGV0ID4+IDYpICYgMHgzZl0gOiAiPSI7CiAgICAgIG91dCArPSBpICsgMiA8IGJ5dGVzLmxlbmd0aCA/IGFscGhhYmV0W3RyaXBsZXQgJiAweDNmXSA6ICI9IjsKICAgIH0KICAgIHJldHVybiBvdXQ7CiAgfQoKICAvLyA9PT09PT09PT09IFZhcmludCAvIFByb3RvYnVmID09PT09PT09PT0KCiAgZnVuY3Rpb24gZW5jb2RlVmFyaW50VW5zaWduZWQodmFsdWUpIHsKICAgIHZhciB2ID0gdHlwZW9mIHZhbHVlID09PSAiYmlnaW50IiA/IHZhbHVlIDogQmlnSW50KHZhbHVlKTsKICAgIGlmICh2IDwgMG4pIHRocm93IG5ldyBFcnJvcigibmVnYXRpdmUgdW5zaWduZWQgdmFyaW50Iik7CiAgICB2YXIgb3V0ID0gW107CiAgICB3aGlsZSAodiA+PSAweDgwbikgeyBvdXQucHVzaChOdW1iZXIoKHYgJiAweDdmbikgfCAweDgwbikpOyB2ID4+PSA3bjsgfQogICAgb3V0LnB1c2goTnVtYmVyKHYpKTsKICAgIHJldHVybiBuZXcgVWludDhBcnJheShvdXQpOwogIH0KCiAgZnVuY3Rpb24gZW5jb2RlVmFyaW50U2lnbmVkSW50NjQodmFsdWUpIHsKICAgIHZhciB2ID0gdHlwZW9mIHZhbHVlID09PSAiYmlnaW50IiA/IHZhbHVlIDogQmlnSW50KE1hdGgudHJ1bmModmFsdWUpKTsKICAgIGlmICh2IDwgMG4pIHYgPSBCaWdJbnQuYXNVaW50Tig2NCwgdik7CiAgICByZXR1cm4gZW5jb2RlVmFyaW50VW5zaWduZWQodik7CiAgfQoKICBmdW5jdGlvbiBkZWNvZGVWYXJpbnQoYnl0ZXMsIG9mZnNldCkgewogICAgdmFyIHJlc3VsdCA9IDBuLCBzaGlmdCA9IDBuLCBjdXJyZW50ID0gb2Zmc2V0OwogICAgd2hpbGUgKGN1cnJlbnQgPCBieXRlcy5sZW5ndGgpIHsKICAgICAgdmFyIGIgPSBieXRlc1tjdXJyZW50XTsgY3VycmVudCArPSAxOwogICAgICByZXN1bHQgfD0gQmlnSW50KGIgJiAweDdmKSA8PCBzaGlmdDsKICAgICAgaWYgKChiICYgMHg4MCkgPT09IDApIHJldHVybiB7IHZhbHVlOiByZXN1bHQsIG9mZnNldDogY3VycmVudCB9OwogICAgICBzaGlmdCArPSA3bjsKICAgICAgaWYgKHNoaWZ0ID4gNzBuKSB0aHJvdyBuZXcgRXJyb3IoInZhcmludCB0b28gbG9uZyIpOwogICAgfQogICAgdGhyb3cgbmV3IEVycm9yKCJ1bnRlcm1pbmF0ZWQgdmFyaW50Iik7CiAgfQoKICBmdW5jdGlvbiBtYWtlS2V5KGZpZWxkTnVtYmVyLCB3aXJlVHlwZSkgewogICAgcmV0dXJuIGVuY29kZVZhcmludFVuc2lnbmVkKChCaWdJbnQoZmllbGROdW1iZXIpIDw8IDNuKSB8IEJpZ0ludCh3aXJlVHlwZSkpOwogIH0KCiAgZnVuY3Rpb24gbWFrZVZhcmludEZpZWxkKGZpZWxkTnVtYmVyLCB2YWx1ZSkgewogICAgcmV0dXJuIGNvbmNhdEJ5dGVzKFttYWtlS2V5KGZpZWxkTnVtYmVyLCAwKSwgZW5jb2RlVmFyaW50U2lnbmVkSW50NjQodmFsdWUpXSk7CiAgfQoKICBmdW5jdGlvbiBtYWtlTGVuZ3RoRGVsaW1pdGVkRmllbGQoZmllbGROdW1iZXIsIHBheWxvYWQpIHsKICAgIHJldHVybiBjb25jYXRCeXRlcyhbbWFrZUtleShmaWVsZE51bWJlciwgMiksIGVuY29kZVZhcmludFVuc2lnbmVkKHBheWxvYWQubGVuZ3RoKSwgcGF5bG9hZF0pOwogIH0KCiAgZnVuY3Rpb24gcGFyc2VGaWVsZHMoYnl0ZXMpIHsKICAgIHZhciBmaWVsZHMgPSBbXSwgb2Zmc2V0ID0gMDsKICAgIHdoaWxlIChvZmZzZXQgPCBieXRlcy5sZW5ndGgpIHsKICAgICAgdmFyIGtleVN0YXJ0ID0gb2Zmc2V0OwogICAgICB2YXIga2V5ID0gZGVjb2RlVmFyaW50KGJ5dGVzLCBvZmZzZXQpOwogICAgICBvZmZzZXQgPSBrZXkub2Zmc2V0OwogICAgICB2YXIgZmllbGROdW1iZXIgPSBOdW1iZXIoa2V5LnZhbHVlID4+IDNuKSwgd2lyZVR5cGUgPSBOdW1iZXIoa2V5LnZhbHVlICYgMHg3bik7CiAgICAgIGlmIChmaWVsZE51bWJlciA9PT0gMCkgdGhyb3cgbmV3IEVycm9yKCJwcm90b2J1ZiBmaWVsZCBudW1iZXIgMCIpOwogICAgICB2YXIgdmFsdWVTdGFydCA9IG9mZnNldCwgdmFsdWVFbmQ7CiAgICAgIGlmICh3aXJlVHlwZSA9PT0gMCkgeyB2YWx1ZUVuZCA9IGRlY29kZVZhcmludChieXRlcywgb2Zmc2V0KS5vZmZzZXQ7IH0KICAgICAgZWxzZSBpZiAod2lyZVR5cGUgPT09IDEpIHsgdmFsdWVFbmQgPSBvZmZzZXQgKyA4OyB9CiAgICAgIGVsc2UgaWYgKHdpcmVUeXBlID09PSAyKSB7IHZhciBsZW5JbmZvID0gZGVjb2RlVmFyaW50KGJ5dGVzLCBvZmZzZXQpOyB2YWx1ZVN0YXJ0ID0gbGVuSW5mby5vZmZzZXQ7IHZhbHVlRW5kID0gdmFsdWVTdGFydCArIE51bWJlcihsZW5JbmZvLnZhbHVlKTsgfQogICAgICBlbHNlIGlmICh3aXJlVHlwZSA9PT0gNSkgeyB2YWx1ZUVuZCA9IG9mZnNldCArIDQ7IH0KICAgICAgZWxzZSB0aHJvdyBuZXcgRXJyb3IoInVuc3VwcG9ydGVkIHdpcmUgdHlwZTogIiArIHdpcmVUeXBlKTsKICAgICAgaWYgKHZhbHVlRW5kID4gYnl0ZXMubGVuZ3RoKSB0aHJvdyBuZXcgRXJyb3IoImZpZWxkIGV4Y2VlZHMgYnVmZmVyIik7CiAgICAgIGZpZWxkcy5wdXNoKHsgZmllbGROdW1iZXI6IGZpZWxkTnVtYmVyLCB3aXJlVHlwZTogd2lyZVR5cGUsIGtleVN0YXJ0OiBrZXlTdGFydCwgdmFsdWVTdGFydDogdmFsdWVTdGFydCwgdmFsdWVFbmQ6IHZhbHVlRW5kLCByYXc6IGJ5dGVzLnNsaWNlKGtleVN0YXJ0LCB2YWx1ZUVuZCksIHZhbHVlQnl0ZXM6IGJ5dGVzLnNsaWNlKHZhbHVlU3RhcnQsIHZhbHVlRW5kKSB9KTsKICAgICAgb2Zmc2V0ID0gdmFsdWVFbmQ7CiAgICB9CiAgICByZXR1cm4gZmllbGRzOwogIH0KCiAgZnVuY3Rpb24gZmlyc3RGaWVsZEJ5TnVtYmVyKGZpZWxkcywgZmllbGROdW1iZXIpIHsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmllbGRzLmxlbmd0aDsgaSsrKSB7IGlmIChmaWVsZHNbaV0uZmllbGROdW1iZXIgPT09IGZpZWxkTnVtYmVyKSByZXR1cm4gZmllbGRzW2ldOyB9CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGZ1bmN0aW9uIHNpZ25lZFZhcmludEZpZWxkVmFsdWUoZmllbGQpIHsKICAgIGlmICghZmllbGQgfHwgZmllbGQud2lyZVR5cGUgIT09IDApIHJldHVybiBudWxsOwogICAgcmV0dXJuIEJpZ0ludC5hc0ludE4oNjQsIGRlY29kZVZhcmludChmaWVsZC52YWx1ZUJ5dGVzLCAwKS52YWx1ZSk7CiAgfQoKICBmdW5jdGlvbiB0cnlQYXJzZUZpZWxkcyhieXRlcykgewogICAgdHJ5IHsgaWYgKCFieXRlcyB8fCBieXRlcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsOyB2YXIgZiA9IHBhcnNlRmllbGRzKGJ5dGVzKTsgcmV0dXJuIGYubGVuZ3RoID4gMCA/IGYgOiBudWxsOyB9CiAgICBjYXRjaCAoZSkgeyByZXR1cm4gbnVsbDsgfQogIH0KCiAgZnVuY3Rpb24gaXNDZWxsUmVzcG9uc2VGaWVsZChmaWVsZE51bWJlcikgeyByZXR1cm4gQ0VMTF9SRVNQT05TRV9GSUVMRFNbZmllbGROdW1iZXJdID09PSB0cnVlOyB9CgogIC8vID09PT09PT09PT0gQVJQQyA9PT09PT09PT09CgogIGZ1bmN0aW9uIHJlYWRVSW50MTZCRShieXRlcywgb2Zmc2V0KSB7IHJldHVybiAoYnl0ZXNbb2Zmc2V0XSA8PCA4KSB8IGJ5dGVzW29mZnNldCArIDFdOyB9CiAgZnVuY3Rpb24gcmVhZFVJbnQzMkJFKGJ5dGVzLCBvZmZzZXQpIHsgcmV0dXJuICgoYnl0ZXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgKyAoKGJ5dGVzW29mZnNldCArIDFdIDw8IDE2KSB8IChieXRlc1tvZmZzZXQgKyAyXSA8PCA4KSB8IGJ5dGVzW29mZnNldCArIDNdKSkgPj4+IDA7IH0KICBmdW5jdGlvbiB3cml0ZVVJbnQxNkJFKHZhbHVlKSB7IHJldHVybiBuZXcgVWludDhBcnJheShbKHZhbHVlID4+IDgpICYgMHhmZiwgdmFsdWUgJiAweGZmXSk7IH0KICBmdW5jdGlvbiB3cml0ZVVJbnQzMkJFKHZhbHVlKSB7IHJldHVybiBuZXcgVWludDhBcnJheShbKHZhbHVlID4+PiAyNCkgJiAweGZmLCAodmFsdWUgPj4+IDE2KSAmIDB4ZmYsICh2YWx1ZSA+Pj4gOCkgJiAweGZmLCB2YWx1ZSAmIDB4ZmZdKTsgfQoKICBmdW5jdGlvbiBhc2NpaUJ5dGVzKHZhbHVlKSB7CiAgICB2YXIgb3V0ID0gbmV3IFVpbnQ4QXJyYXkodmFsdWUubGVuZ3RoKTsKICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdmFsdWUubGVuZ3RoOyBpKyspIG91dFtpXSA9IHZhbHVlLmNoYXJDb2RlQXQoaSkgJiAweDdmOwogICAgcmV0dXJuIG91dDsKICB9CgogIGZ1bmN0aW9uIHJlYWRQYXNjYWxTdHJpbmcoYnl0ZXMsIHN0YXRlKSB7CiAgICB2YXIgbGVuZ3RoID0gcmVhZFVJbnQxNkJFKGJ5dGVzLCBzdGF0ZS5vZmZzZXQpOyBzdGF0ZS5vZmZzZXQgKz0gMjsKICAgIHZhciBjaGFycyA9IFtdOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykgY2hhcnMucHVzaChTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW3N0YXRlLm9mZnNldCArIGldKSk7CiAgICBzdGF0ZS5vZmZzZXQgKz0gbGVuZ3RoOwogICAgcmV0dXJuIGNoYXJzLmpvaW4oIiIpOwogIH0KCiAgZnVuY3Rpb24gd3JpdGVQYXNjYWxTdHJpbmcodmFsdWUpIHsgcmV0dXJuIGNvbmNhdEJ5dGVzKFt3cml0ZVVJbnQxNkJFKHZhbHVlLmxlbmd0aCksIGFzY2lpQnl0ZXModmFsdWUpXSk7IH0KCiAgZnVuY3Rpb24gcGFyc2VBcnBjKGJ5dGVzKSB7CiAgICB2YXIgc3RhdGUgPSB7IG9mZnNldDogMCB9OwogICAgdmFyIHZlcnNpb24gPSByZWFkVUludDE2QkUoYnl0ZXMsIHN0YXRlLm9mZnNldCk7IHN0YXRlLm9mZnNldCArPSAyOwogICAgdmFyIGxvY2FsZSA9IHJlYWRQYXNjYWxTdHJpbmcoYnl0ZXMsIHN0YXRlKTsKICAgIHZhciBhcHBJZGVudGlmaWVyID0gcmVhZFBhc2NhbFN0cmluZyhieXRlcywgc3RhdGUpOwogICAgdmFyIG9zVmVyc2lvbiA9IHJlYWRQYXNjYWxTdHJpbmcoYnl0ZXMsIHN0YXRlKTsKICAgIHZhciBmdW5jdGlvbklkID0gcmVhZFVJbnQzMkJFKGJ5dGVzLCBzdGF0ZS5vZmZzZXQpOyBzdGF0ZS5vZmZzZXQgKz0gNDsKICAgIHZhciBwYXlsb2FkTGVuZ3RoID0gcmVhZFVJbnQzMkJFKGJ5dGVzLCBzdGF0ZS5vZmZzZXQpOyBzdGF0ZS5vZmZzZXQgKz0gNDsKICAgIGlmIChzdGF0ZS5vZmZzZXQgKyBwYXlsb2FkTGVuZ3RoID4gYnl0ZXMubGVuZ3RoKSB0aHJvdyBuZXcgRXJyb3IoIkFSUEMgcGF5bG9hZCBleGNlZWRzIGJ1ZmZlciIpOwogICAgcmV0dXJuIHsgdmVyc2lvbjogdmVyc2lvbiwgbG9jYWxlOiBsb2NhbGUsIGFwcElkZW50aWZpZXI6IGFwcElkZW50aWZpZXIsIG9zVmVyc2lvbjogb3NWZXJzaW9uLCBmdW5jdGlvbklkOiBmdW5jdGlvbklkLCBwYXlsb2FkOiBieXRlcy5zbGljZShzdGF0ZS5vZmZzZXQsIHN0YXRlLm9mZnNldCArIHBheWxvYWRMZW5ndGgpIH07CiAgfQoKICBmdW5jdGlvbiBzZXJpYWxpemVBcnBjKGFycGMpIHsKICAgIHJldHVybiBjb25jYXRCeXRlcyhbd3JpdGVVSW50MTZCRShhcnBjLnZlcnNpb24pLCB3cml0ZVBhc2NhbFN0cmluZyhhcnBjLmxvY2FsZSksIHdyaXRlUGFzY2FsU3RyaW5nKGFycGMuYXBwSWRlbnRpZmllciksIHdyaXRlUGFzY2FsU3RyaW5nKGFycGMub3NWZXJzaW9uKSwgd3JpdGVVSW50MzJCRShhcnBjLmZ1bmN0aW9uSWQpLCB3cml0ZVVJbnQzMkJFKGFycGMucGF5bG9hZC5sZW5ndGgpLCBhcnBjLnBheWxvYWRdKTsKICB9CgogIC8vID09PT09PT09PT0gTG9jYXRpb24gUGF0Y2hpbmcgPT09PT09PT09PQoKICBmdW5jdGlvbiBjb29yZFRvSW50KHZhbHVlKSB7IHJldHVybiBNYXRoLnRydW5jKE51bWJlcih2YWx1ZSkgKiAxMDAwMDAwMDApOyB9CgogIGZ1bmN0aW9uIHBhdGNoTG9jYXRpb24obG9jYXRpb25QYXlsb2FkLCBjb25maWcpIHsKICAgIHZhciBwYXJ0cyA9IFtdLCBmaWVsZHMgPSBsb2NhdGlvblBheWxvYWQubGVuZ3RoID8gcGFyc2VGaWVsZHMobG9jYXRpb25QYXlsb2FkKSA6IFtdOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWVsZHMubGVuZ3RoOyBpKyspIHsgaWYgKCFMT0NBVElPTl9SRVBMQUNFRF9GSUVMRFNbZmllbGRzW2ldLmZpZWxkTnVtYmVyXSkgcGFydHMucHVzaChmaWVsZHNbaV0ucmF3KTsgfQogICAgcGFydHMucHVzaChtYWtlVmFyaW50RmllbGQoMSwgY29vcmRUb0ludChjb25maWcubGF0aXR1ZGUpKSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCgyLCBjb29yZFRvSW50KGNvbmZpZy5sb25naXR1ZGUpKSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCgzLCBjb25maWcuaG9yaXpvbnRhbEFjY3VyYWN5KSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCg0LCBjb25maWcudW5rbm93blZhbHVlNCkpOwogICAgcGFydHMucHVzaChtYWtlVmFyaW50RmllbGQoNSwgY29uZmlnLmFsdGl0dWRlKSk7CiAgICBwYXJ0cy5wdXNoKG1ha2VWYXJpbnRGaWVsZCg2LCBjb25maWcudmVydGljYWxBY2N1cmFjeSkpOwogICAgcGFydHMucHVzaChtYWtlVmFyaW50RmllbGQoMTEsIGNvbmZpZy5tb3Rpb25BY3Rpdml0eVR5cGUpKTsKICAgIHBhcnRzLnB1c2gobWFrZVZhcmludEZpZWxkKDEyLCBjb25maWcubW90aW9uQWN0aXZpdHlDb25maWRlbmNlKSk7CiAgICByZXR1cm4gY29uY2F0Qnl0ZXMocGFydHMpOwogIH0KCiAgZnVuY3Rpb24gcGF0Y2hXaWZpRGV2aWNlKHdpZmlQYXlsb2FkLCBjb25maWcpIHsKICAgIHZhciBmaWVsZHMgPSBwYXJzZUZpZWxkcyh3aWZpUGF5bG9hZCksIHBhcnRzID0gW10sIHBhdGNoZWRMb2NhdGlvbiA9IGZhbHNlOwogICAgZm9yICh2YXIgaSA9IDA7IGkgPCBmaWVsZHMubGVuZ3RoOyBpKyspIHsKICAgICAgaWYgKGZpZWxkc1tpXS5maWVsZE51bWJlciA9PT0gMiAmJiBmaWVsZHNbaV0ud2lyZVR5cGUgPT09IDIpIHsKICAgICAgICBwYXJ0cy5wdXNoKG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZCgyLCBwYXRjaExvY2F0aW9uKGZpZWxkc1tpXS52YWx1ZUJ5dGVzLCBjb25maWcpKSk7IHBhdGNoZWRMb2NhdGlvbiA9IHRydWU7CiAgICAgIH0gZWxzZSBwYXJ0cy5wdXNoKGZpZWxkc1tpXS5yYXcpOwogICAgfQogICAgaWYgKCFwYXRjaGVkTG9jYXRpb24pIHBhcnRzLnB1c2gobWFrZUxlbmd0aERlbGltaXRlZEZpZWxkKDIsIHBhdGNoTG9jYXRpb24obmV3IFVpbnQ4QXJyYXkoW10pLCBjb25maWcpKSk7CiAgICByZXR1cm4gY29uY2F0Qnl0ZXMocGFydHMpOwogIH0KCiAgZnVuY3Rpb24gcGF0Y2hDZWxsVG93ZXIoY2VsbFBheWxvYWQsIGNvbmZpZykgewogICAgdmFyIGZpZWxkcyA9IHBhcnNlRmllbGRzKGNlbGxQYXlsb2FkKSwgcGFydHMgPSBbXSwgcGF0Y2hlZExvY2F0aW9uID0gZmFsc2U7CiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZpZWxkcy5sZW5ndGg7IGkrKykgewogICAgICBpZiAoZmllbGRzW2ldLmZpZWxkTnVtYmVyID09PSA1ICYmIGZpZWxkc1tpXS53aXJlVHlwZSA9PT0gMikgewogICAgICAgIHBhcnRzLnB1c2gobWFrZUxlbmd0aERlbGltaXRlZEZpZWxkKDUsIHBhdGNoTG9jYXRpb24oZmllbGRzW2ldLnZhbHVlQnl0ZXMsIGNvbmZpZykpKTsgcGF0Y2hlZExvY2F0aW9uID0gdHJ1ZTsKICAgICAgfSBlbHNlIHBhcnRzLnB1c2goZmllbGRzW2ldLnJhdyk7CiAgICB9CiAgICBpZiAoIXBhdGNoZWRMb2NhdGlvbikgcGFydHMucHVzaChtYWtlTGVuZ3RoRGVsaW1pdGVkRmllbGQoNSwgcGF0Y2hMb2NhdGlvbihuZXcgVWludDhBcnJheShbXSksIGNvbmZpZykpKTsKICAgIHJldHVybiBjb25jYXRCeXRlcyhwYXJ0cyk7CiAgfQoKICBmdW5jdGlvbiBwYXRjaEFwcGxlV0xvY1BheWxvYWQocGF5bG9hZCwgY29uZmlnKSB7CiAgICB2YXIgZmllbGRzID0gcGFyc2VGaWVsZHMocGF5bG9hZCksIHBhcnRzID0gW10sIHdpZmlDb3VudCA9IDAsIGNlbGxDb3VudCA9IDA7CiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZpZWxkcy5sZW5ndGg7IGkrKykgewogICAgICB2YXIgZmllbGQgPSBmaWVsZHNbaV07CiAgICAgIGlmIChmaWVsZC5maWVsZE51bWJlciA9PT0gMiAmJiBmaWVsZC53aXJlVHlwZSA9PT0gMikgeyBwYXJ0cy5wdXNoKG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZCgyLCBwYXRjaFdpZmlEZXZpY2UoZmllbGQudmFsdWVCeXRlcywgY29uZmlnKSkpOyB3aWZpQ291bnQgKz0gMTsgfQogICAgICBlbHNlIGlmIChpc0NlbGxSZXNwb25zZUZpZWxkKGZpZWxkLmZpZWxkTnVtYmVyKSAmJiBmaWVsZC53aXJlVHlwZSA9PT0gMikgeyBwYXJ0cy5wdXNoKG1ha2VMZW5ndGhEZWxpbWl0ZWRGaWVsZChmaWVsZC5maWVsZE51bWJlciwgcGF0Y2hDZWxsVG93ZXIoZmllbGQudmFsdWVCeXRlcywgY29uZmlnKSkpOyBjZWxsQ291bnQgKz0gMTsgfQogICAgICBlbHNlIGlmICghUk9PVF9EUk9QX0ZJRUxEU1tmaWVsZC5maWVsZE51bWJlcl0pIHBhcnRzLnB1c2goZmllbGQucmF3KTsKICAgIH0KICAgIHJldHVybiB7IHBheWxvYWQ6IGNvbmNhdEJ5dGVzKHBhcnRzKSwgd2lmaUNvdW50OiB3aWZpQ291bnQsIGNlbGxDb3VudDogY2VsbENvdW50IH07CiAgfQoKICAvLyA9PT09PT09PT09IFJlc3BvbnNlIEV4dHJhY3Rpb24gPT09PT09PT09PQoKICBmdW5jdGlvbiBleHRyYWN0UHJlZml4ZWRBcHBsZVdMb2NQYXlsb2FkKHJlc3BvbnNlQnl0ZXMpIHsKICAgIGlmICghcmVzcG9uc2VCeXRlcyB8fCByZXNwb25zZUJ5dGVzLmxlbmd0aCA8IDEwKSByZXR1cm4gbnVsbDsKICAgIGlmIChyZXNwb25zZUJ5dGVzWzBdICE9PSAweDAwIHx8IHJlc3BvbnNlQnl0ZXNbMV0gIT09IDB4MDEpIHJldHVybiBudWxsOwogICAgaWYgKHJlc3BvbnNlQnl0ZXNbNl0gIT09IDB4MDAgfHwgcmVzcG9uc2VCeXRlc1s3XSAhPT0gMHgwMCkgcmV0dXJuIG51bGw7CiAgICB2YXIgcGF5bG9hZExlbmd0aCA9IHJlYWRVSW50MTZCRShyZXNwb25zZUJ5dGVzLCA4KSwgcGF5bG9hZE9mZnNldCA9IDEwOwogICAgaWYgKHBheWxvYWRMZW5ndGggPD0gMCB8fCBwYXlsb2FkT2Zmc2V0ICsgcGF5bG9hZExlbmd0aCA+IHJlc3BvbnNlQnl0ZXMubGVuZ3RoKSByZXR1cm4gbnVsbDsKICAgIHZhciBwYXlsb2FkID0gcmVzcG9uc2VCeXRlcy5zbGljZShwYXlsb2FkT2Zmc2V0LCBwYXlsb2FkT2Zmc2V0ICsgcGF5bG9hZExlbmd0aCk7CiAgICBpZiAodHJ5UGFyc2VGaWVsZHMocGF5bG9hZCkgPT09IG51bGwpIHJldHVybiBudWxsOwogICAgcmV0dXJuIHsga2luZDogInN5bnRoZXRpYyIsIHBheWxvYWQ6IHBheWxvYWQsIHByZWZpeDogcmVzcG9uc2VCeXRlcy5zbGljZSgwLCA4KSwgc3VmZml4OiByZXNwb25zZUJ5dGVzLnNsaWNlKHBheWxvYWRPZmZzZXQgKyBwYXlsb2FkTGVuZ3RoKSB9OwogIH0KCiAgZnVuY3Rpb24gZXh0cmFjdEFwcGxlV0xvY1BheWxvYWQocmVzcG9uc2VCeXRlcykgewogICAgaWYgKCFyZXNwb25zZUJ5dGVzIHx8IHJlc3BvbnNlQnl0ZXMubGVuZ3RoIDwgMikgdGhyb3cgbmV3IEVycm9yKCJBcHBsZSBXTG9jIHJlc3BvbnNlIHRvbyBzaG9ydCIpOwogICAgdmFyIHByZWZpeGVkID0gZXh0cmFjdFByZWZpeGVkQXBwbGVXTG9jUGF5bG9hZChyZXNwb25zZUJ5dGVzKTsKICAgIGlmIChwcmVmaXhlZCkgcmV0dXJuIHByZWZpeGVkOwogICAgdHJ5IHsKICAgICAgdmFyIGFycGMgPSBwYXJzZUFycGMocmVzcG9uc2VCeXRlcyk7CiAgICAgIGlmIChhcnBjLnBheWxvYWQubGVuZ3RoID4gMCAmJiB0cnlQYXJzZUZpZWxkcyhhcnBjLnBheWxvYWQpICE9PSBudWxsKSByZXR1cm4geyBraW5kOiAiYXJwYyIsIHBheWxvYWQ6IGFycGMucGF5bG9hZCwgYXJwYzogYXJwYyB9OwogICAgfSBjYXRjaCAoZSkge30KICAgIHZhciBtYXJrZXJJZHggPSBmaW5kQnl0ZXMocmVzcG9uc2VCeXRlcywgQVBQTEVfV0xPQ19NQVJLRVIpOwogICAgaWYgKG1hcmtlcklkeCA+PSAwKSB7CiAgICAgIHZhciBsZW5PZmZzZXQgPSBtYXJrZXJJZHggKyBBUFBMRV9XTE9DX01BUktFUi5sZW5ndGg7CiAgICAgIGlmIChsZW5PZmZzZXQgKyAyIDw9IHJlc3BvbnNlQnl0ZXMubGVuZ3RoKSB7CiAgICAgICAgdmFyIHJlYWxMZW4gPSByZWFkVUludDE2QkUocmVzcG9uc2VCeXRlcywgbGVuT2Zmc2V0KSwgcmVhbFBheWxvYWRPZmZzZXQgPSBsZW5PZmZzZXQgKyAyOwogICAgICAgIGlmIChyZWFsTGVuID4gMCAmJiByZWFsUGF5bG9hZE9mZnNldCArIHJlYWxMZW4gPD0gcmVzcG9uc2VCeXRlcy5sZW5ndGgpIHsKICAgICAgICAgIHZhciBjYW5kaWRhdGVQYXlsb2FkID0gcmVzcG9uc2VCeXRlcy5zbGljZShyZWFsUGF5bG9hZE9mZnNldCwgcmVhbFBheWxvYWRPZmZzZXQgKyByZWFsTGVuKTsKICAgICAgICAgIGlmICh0cnlQYXJzZUZpZWxkcyhjYW5kaWRhdGVQYXlsb2FkKSAhPT0gbnVsbCkgcmV0dXJuIHsga2luZDogIm1hcmtlciIsIHBheWxvYWQ6IGNhbmRpZGF0ZVBheWxvYWQsIHByZWZpeDogcmVzcG9uc2VCeXRlcy5zbGljZSgwLCBtYXJrZXJJZHgpLCBtYXJrZXJBbmRMZW46IHJlc3BvbnNlQnl0ZXMuc2xpY2UobWFya2VySWR4LCByZWFsUGF5bG9hZE9mZnNldCksIHN1ZmZpeDogcmVzcG9uc2VCeXRlcy5zbGljZShyZWFsUGF5bG9hZE9mZnNldCArIHJlYWxMZW4pIH07CiAgICAgICAgfQogICAgICB9CiAgICB9CiAgICBpZiAocmVzcG9uc2VCeXRlcy5sZW5ndGggPiAwKSB7IHZhciB0YWcgPSByZXNwb25zZUJ5dGVzWzBdOyB2YXIgZm4gPSB0YWcgPj4gMywgd3QgPSB0YWcgJiAweDc7IGlmIChmbiA+IDAgJiYgKHd0ID09PSAwIHx8IHd0ID09PSAyKSkgcmV0dXJuIHsga2luZDogImJhcmUiLCBwYXlsb2FkOiByZXNwb25zZUJ5dGVzIH07IH0KICAgIHRocm93IG5ldyBFcnJvcigibWlzc2luZyBBcHBsZSBXTG9jIHJlc3BvbnNlIHByZWZpeCIpOwogIH0KCiAgZnVuY3Rpb24gYnVpbGRBcHBsZVdMb2NSZXNwb25zZShwYXlsb2FkLCBwcmVmaXgpIHsKICAgIHJldHVybiBjb25jYXRCeXRlcyhbcHJlZml4IHx8IEFQUExFX1dMT0NfUFJFRklYLCB3cml0ZVVJbnQxNkJFKHBheWxvYWQubGVuZ3RoKSwgcGF5bG9hZF0pOwogIH0KCiAgZnVuY3Rpb24gc3Bvb2ZBcHBsZVJlc3BvbnNlKHJlc3BvbnNlQnl0ZXMsIGNvbmZpZykgewogICAgdmFyIGV4dHJhY3Rpb24gPSBleHRyYWN0QXBwbGVXTG9jUGF5bG9hZChyZXNwb25zZUJ5dGVzKTsKICAgIHZhciBwYXRjaGVkID0gcGF0Y2hBcHBsZVdMb2NQYXlsb2FkKGV4dHJhY3Rpb24ucGF5bG9hZCwgY29uZmlnKTsKICAgIHZhciByZXNwb25zZTsKICAgIGlmIChleHRyYWN0aW9uLmtpbmQgPT09ICJhcnBjIikgewogICAgICByZXNwb25zZSA9IHNlcmlhbGl6ZUFycGMoeyB2ZXJzaW9uOiBleHRyYWN0aW9uLmFycGMudmVyc2lvbiwgbG9jYWxlOiBleHRyYWN0aW9uLmFycGMubG9jYWxlLCBhcHBJZGVudGlmaWVyOiBleHRyYWN0aW9uLmFycGMuYXBwSWRlbnRpZmllciwgb3NWZXJzaW9uOiBleHRyYWN0aW9uLmFycGMub3NWZXJzaW9uLCBmdW5jdGlvbklkOiBleHRyYWN0aW9uLmFycGMuZnVuY3Rpb25JZCwgcGF5bG9hZDogcGF0Y2hlZC5wYXlsb2FkIH0pOwogICAgfSBlbHNlIGlmIChleHRyYWN0aW9uLmtpbmQgPT09ICJtYXJrZXIiKSB7CiAgICAgIHZhciBuZXdMZW5CeXRlcyA9IHdyaXRlVUludDE2QkUocGF0Y2hlZC5wYXlsb2FkLmxlbmd0aCk7CiAgICAgIHJlc3BvbnNlID0gY29uY2F0Qnl0ZXMoW2V4dHJhY3Rpb24ucHJlZml4LCBleHRyYWN0aW9uLm1hcmtlckFuZExlbi5zbGljZSgwLCBBUFBMRV9XTE9DX01BUktFUi5sZW5ndGgpLCBuZXdMZW5CeXRlcywgcGF0Y2hlZC5wYXlsb2FkLCBleHRyYWN0aW9uLnN1ZmZpeF0pOwogICAgfSBlbHNlIHsKICAgICAgcmVzcG9uc2UgPSBidWlsZEFwcGxlV0xvY1Jlc3BvbnNlKHBhdGNoZWQucGF5bG9hZCwgZXh0cmFjdGlvbi5wcmVmaXgpOwogICAgfQogICAgcmV0dXJuIHsgcmVzcG9uc2U6IHJlc3BvbnNlLCBwYXlsb2FkOiBwYXRjaGVkLnBheWxvYWQsIHdpZmlDb3VudDogcGF0Y2hlZC53aWZpQ291bnQsIGNlbGxDb3VudDogcGF0Y2hlZC5jZWxsQ291bnQsIGtpbmQ6IGV4dHJhY3Rpb24ua2luZCB9OwogIH0KCiAgZnVuY3Rpb24gcGF0Y2hlZFBheWxvYWRTdW1tYXJ5KHBheWxvYWQpIHsKICAgIHRyeSB7CiAgICAgIHZhciByb290RmllbGRzID0gcGFyc2VGaWVsZHMocGF5bG9hZCksIHBhcnRzID0gW107CiAgICAgIHZhciB3aWZpID0gZmlyc3RGaWVsZEJ5TnVtYmVyKHJvb3RGaWVsZHMsIDIpOwogICAgICBpZiAod2lmaSAmJiB3aWZpLndpcmVUeXBlID09PSAyKSB7CiAgICAgICAgdmFyIHdpZmlMb2MgPSBmaXJzdEZpZWxkQnlOdW1iZXIocGFyc2VGaWVsZHMod2lmaS52YWx1ZUJ5dGVzKSwgMik7CiAgICAgICAgcGFydHMucHVzaCgiZmlyc3RXaWZpPSIgKyAod2lmaUxvYyA/IChOdW1iZXIoc2lnbmVkVmFyaW50RmllbGRWYWx1ZShmaXJzdEZpZWxkQnlOdW1iZXIocGFyc2VGaWVsZHMod2lmaUxvYy52YWx1ZUJ5dGVzKSwgMSkpKSAvIDEwMDAwMDAwMCkudG9GaXhlZCg4KSArICIsIiArIChOdW1iZXIoc2lnbmVkVmFyaW50RmllbGRWYWx1ZShmaXJzdEZpZWxkQnlOdW1iZXIocGFyc2VGaWVsZHMod2lmaUxvYy52YWx1ZUJ5dGVzKSwgMikpKSAvIDEwMDAwMDAwMCkudG9GaXhlZCg4KSA6ICI8bWlzc2luZz4iKSk7CiAgICAgIH0KICAgICAgcmV0dXJuIHBhcnRzLmxlbmd0aCA/IHBhcnRzLmpvaW4oIiwgIikgOiAibm8gbG9jYXRpb24gZmllbGRzIjsKICAgIH0gY2F0Y2ggKGVycikgeyByZXR1cm4gInN1bW1hcnkgZmFpbGVkOiAiICsgZXJyLm1lc3NhZ2U7IH0KICB9CgogIC8vID09PT09PT09PT0gQ29uZmlnID09PT09PT09PT0KCiAgZnVuY3Rpb24gbm9ybWFsaXplQ29uZmlnKGlucHV0KSB7CiAgICB2YXIgY2ZnID0ge30sIGtleTsKICAgIGZvciAoa2V5IGluIERFRkFVTFRfQ09ORklHKSB7IGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoREVGQVVMVF9DT05GSUcsIGtleSkpIGNmZ1trZXldID0gREVGQVVMVF9DT05GSUdba2V5XTsgfQogICAgaW5wdXQgPSBpbnB1dCB8fCB7fTsKICAgIGZvciAoa2V5IGluIGlucHV0KSB7IGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaW5wdXQsIGtleSkpIGNmZ1trZXldID0gaW5wdXRba2V5XTsgfQogICAgY2ZnLmVuYWJsZWQgPSAhKGNmZy5lbmFibGVkID09PSBmYWxzZSB8fCBjZmcuZW5hYmxlZCA9PT0gImZhbHNlIiB8fCBjZmcuZW5hYmxlZCA9PT0gIjAiIHx8IGNmZy5lbmFibGVkID09PSAib2ZmIiB8fCBjZmcuZW5hYmxlZCA9PT0gIm5vIiB8fCBjZmcuZW5hYmxlZCA9PT0gMCk7CiAgICBjZmcubGF0aXR1ZGUgPSBOdW1iZXIoY2ZnLmxhdGl0dWRlKTsgY2ZnLmxvbmdpdHVkZSA9IE51bWJlcihjZmcubG9uZ2l0dWRlKTsKICAgIGNmZy5ob3Jpem9udGFsQWNjdXJhY3kgPSBNYXRoLnRydW5jKE51bWJlcihjZmcuaG9yaXpvbnRhbEFjY3VyYWN5KSk7CiAgICBjZmcudmVydGljYWxBY2N1cmFjeSA9IE1hdGgudHJ1bmMoTnVtYmVyKGNmZy52ZXJ0aWNhbEFjY3VyYWN5KSk7CiAgICBjZmcuYWx0aXR1ZGUgPSBNYXRoLnRydW5jKE51bWJlcihjZmcuYWx0aXR1ZGUpKTsKICAgIGNmZy51bmtub3duVmFsdWU0ID0gTWF0aC50cnVuYyhOdW1iZXIoY2ZnLnVua25vd25WYWx1ZTQpKTsKICAgIGNmZy5tb3Rpb25BY3Rpdml0eVR5cGUgPSBNYXRoLnRydW5jKE51bWJlcihjZmcubW90aW9uQWN0aXZpdHlUeXBlKSk7CiAgICBjZmcubW90aW9uQWN0aXZpdHlDb25maWRlbmNlID0gTWF0aC50cnVuYyhOdW1iZXIoY2ZnLm1vdGlvbkFjdGl2aXR5Q29uZmlkZW5jZSkpOwogICAgY2ZnLmZhaWxPcGVuID0gY2ZnLmZhaWxPcGVuICE9PSBmYWxzZTsKICAgIGNmZy5kZWJ1ZyA9IGNmZy5kZWJ1ZyA9PT0gdHJ1ZSB8fCBTdHJpbmcoY2ZnLmRlYnVnKS50b0xvd2VyQ2FzZSgpID09PSAidHJ1ZSI7CiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShjZmcubGF0aXR1ZGUpIHx8IGNmZy5sYXRpdHVkZSA8IC05MCB8fCBjZmcubGF0aXR1ZGUgPiA5MCkgdGhyb3cgbmV3IEVycm9yKCJpbnZhbGlkIGxhdGl0dWRlIik7CiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShjZmcubG9uZ2l0dWRlKSB8fCBjZmcubG9uZ2l0dWRlIDwgLTE4MCB8fCBjZmcubG9uZ2l0dWRlID4gMTgwKSB0aHJvdyBuZXcgRXJyb3IoImludmFsaWQgbG9uZ2l0dWRlIik7CiAgICByZXR1cm4gY2ZnOwogIH0KCiAgZnVuY3Rpb24gbG9hZENvbmZpZygpIHsKICAgIC8vIOaXoOeKtuaAge+8muS7juacrOacuiAkcHJlZnMg6K+75Y+W6YCJ54K56aG15YaZ5YWl55qE5Z2Q5qCH77yI5LiN5Y+R6LW35Lu75L2V5aSW6YOo572R57uc6K+35rGC77yJ44CCCiAgICAvLyDplK7kuI4gbG9jYXRpb24tc2V0dGluZ3MuanMg5YaZ5YWl55qE5LiA6Ie077yaZW5hYmxlZC9sYXRpdHVkZS9sb25naXR1ZGUvYWx0aXR1ZGUvaG9yaXpvbnRhbEFjY3VyYWN5L3ZlcnRpY2FsQWNjdXJhY3njgIIKICAgIHZhciBjZmcgPSB7fTsKICAgIGZvciAodmFyIGsgaW4gREVGQVVMVF9DT05GSUcpIHsgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChERUZBVUxUX0NPTkZJRywgaykpIGNmZ1trXSA9IERFRkFVTFRfQ09ORklHW2tdOyB9CiAgICB2YXIga2V5cyA9IFsiZW5hYmxlZCIsICJsYXRpdHVkZSIsICJsb25naXR1ZGUiLCAiYWx0aXR1ZGUiLCAiaG9yaXpvbnRhbEFjY3VyYWN5IiwgInZlcnRpY2FsQWNjdXJhY3kiXTsKICAgIGlmICh0eXBlb2YgJHByZWZzICE9PSAidW5kZWZpbmVkIiAmJiAkcHJlZnMudmFsdWVGb3JLZXkpIHsKICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgaSsrKSB7CiAgICAgICAgdmFyIHYgPSAkcHJlZnMudmFsdWVGb3JLZXkoa2V5c1tpXSk7CiAgICAgICAgaWYgKHYgIT0gbnVsbCAmJiB2ICE9PSAiIikgY2ZnW2tleXNbaV1dID0gdjsKICAgICAgfQogICAgfQogICAgcmV0dXJuIG5vcm1hbGl6ZUNvbmZpZyhjZmcpOwogIH0KCiAgZnVuY3Rpb24gbWVyZ2VDb25maWcoYmFzZSwgZXh0cmEpIHsKICAgIHZhciBvdXQgPSB7fSwga2V5OwogICAgZm9yIChrZXkgaW4gYmFzZSkgeyBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKGJhc2UsIGtleSkpIG91dFtrZXldID0gYmFzZVtrZXldOyB9CiAgICBleHRyYSA9IGV4dHJhIHx8IHt9OwogICAgZm9yIChrZXkgaW4gZXh0cmEpIHsgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChleHRyYSwga2V5KSkgb3V0W2tleV0gPSBleHRyYVtrZXldOyB9CiAgICByZXR1cm4gb3V0OwogIH0KCiAgLy8gPT09PT09PT09PSBRWCBFbnRyeSBQb2ludCA9PT09PT09PT09CgogIGZ1bmN0aW9uIHJ1blFYKCkgewogICAgdmFyIGhhc1Jlc3BvbnNlID0gdHlwZW9mICRyZXNwb25zZSAhPT0gInVuZGVmaW5lZCI7CgogICAgaWYgKGhhc1Jlc3BvbnNlKSB7CiAgICAgIHZhciBjb25maWcgPSBsb2FkQ29uZmlnKCk7CiAgICAgIHRyeSB7CiAgICAgICAgaWYgKCFjb25maWcuZW5hYmxlZCkgeyAkZG9uZSh7fSk7IHJldHVybjsgfQogICAgICAgIC8vIFFYIHYxLjAuMTkrIOi1t+S6jOi/m+WItuWTjeW6lOi1sCAkcmVzcG9uc2UuYm9keUJ5dGVzKEFycmF5QnVmZmVyKe+8jAogICAgICAgIC8vICRyZXNwb25zZS5ib2R5IOWvueS6jOi/m+WItuaYr+epui/kubHnoIHmlofmnKzjgILor6bop4EgY3Jvc3N1dGlsaXR5L1F1YW50dW11bHQtWAogICAgICAgIC8vIOeahCBzYW1wbGUtYnl0ZXMtcmV3cml0ZS5qc+OAggogICAgICAgIHZhciByYXdCdWYgPSAkcmVzcG9uc2UuYm9keUJ5dGVzOwogICAgICAgIGlmICghcmF3QnVmIHx8IChyYXdCdWYuYnl0ZUxlbmd0aCAhPT0gdW5kZWZpbmVkICYmIHJhd0J1Zi5ieXRlTGVuZ3RoID09PSAwKSkgewogICAgICAgICAgJGRvbmUoe30pOwogICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KICAgICAgICB2YXIgcmVzcG9uc2VCeXRlcyA9IHJhd0J1ZiBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkgPyByYXdCdWYgOiBuZXcgVWludDhBcnJheShyYXdCdWYpOwogICAgICAgIGlmIChyZXNwb25zZUJ5dGVzLmxlbmd0aCA8IDIpIHsgJGRvbmUoe30pOyByZXR1cm47IH0KICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBRWCByZXNwb25zZTogIiArIHJlc3BvbnNlQnl0ZXMubGVuZ3RoICsgIiBieXRlcywgaGVhZD0iICsgaGV4UHJldmlldyhyZXNwb25zZUJ5dGVzLCAzMikpOwogICAgICAgIHZhciByZXN1bHQgPSBzcG9vZkFwcGxlUmVzcG9uc2UocmVzcG9uc2VCeXRlcywgY29uZmlnKTsKICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBwYXRjaGVkICIgKyByZXN1bHQud2lmaUNvdW50ICsgIiB3aWZpLCAiICsgcmVzdWx0LmNlbGxDb3VudCArICIgY2VsbCwga2luZD0iICsgcmVzdWx0LmtpbmQgKyAiLCByZXNwb25zZT0iICsgcmVzdWx0LnJlc3BvbnNlLmxlbmd0aCArICIgYnl0ZXMiKTsKICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBsb2NhdGlvbnM6ICIgKyBwYXRjaGVkUGF5bG9hZFN1bW1hcnkocmVzdWx0LnBheWxvYWQpKTsKICAgICAgICAvLyBRWDog5LqM6L+b5Yi25pS55ZCO5ZON5bqU5b+F6aG755SoICRkb25lKHtib2R5Qnl0ZXM6IEFycmF5QnVmZmVyfSkg5Zue5YaZCiAgICAgICAgJGRvbmUoewogICAgICAgICAgYm9keUJ5dGVzOiByZXN1bHQucmVzcG9uc2UuYnVmZmVyLnNsaWNlKAogICAgICAgICAgICByZXN1bHQucmVzcG9uc2UuYnl0ZU9mZnNldCwKICAgICAgICAgICAgcmVzdWx0LnJlc3BvbnNlLmJ5dGVPZmZzZXQgKyByZXN1bHQucmVzcG9uc2UuYnl0ZUxlbmd0aAogICAgICAgICAgKQogICAgICAgIH0pOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSBjb25zb2xlLmxvZygiTG9jYXRpb24gc3Bvb2ZlciBmYWlsZWQ6ICIgKyBlcnIubWVzc2FnZSk7CiAgICAgICAgJGRvbmUoe30pOwogICAgICB9CiAgICB9IGVsc2UgewogICAgICAkZG9uZSh7fSk7CiAgICB9CiAgfQoKICB2YXIgYXBpID0gewogICAgREVGQVVMVF9DT05GSUc6IERFRkFVTFRfQ09ORklHLAogICAgYmFzZTY0VG9CeXRlczogYmFzZTY0VG9CeXRlcywKICAgIGJ5dGVzVG9CYXNlNjQ6IGJ5dGVzVG9CYXNlNjQsCiAgICBwYXRjaEFwcGxlV0xvY1BheWxvYWQ6IHBhdGNoQXBwbGVXTG9jUGF5bG9hZCwKICAgIHNwb29mQXBwbGVSZXNwb25zZTogc3Bvb2ZBcHBsZVJlc3BvbnNlLAogICAgZXh0cmFjdEFwcGxlV0xvY1BheWxvYWQ6IGV4dHJhY3RBcHBsZVdMb2NQYXlsb2FkLAogICAgcGFyc2VBcnBjOiBwYXJzZUFycGMsCiAgICBjb29yZFRvSW50OiBjb29yZFRvSW50CiAgfTsKCiAgaWYgKHR5cGVvZiBtb2R1bGUgIT09ICJ1bmRlZmluZWQiICYmIG1vZHVsZS5leHBvcnRzKSB7CiAgICBtb2R1bGUuZXhwb3J0cyA9IGFwaTsKICB9IGVsc2UgewogICAgcnVuUVgoKTsKICB9Cn0oKSk7Cg==";

/* ==== inlined from src/page.js ==== */

function getPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>iOS Location Spoofer</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="iOSLoc">
<meta name="theme-color" content="#0a0c11">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
:root {
  --bg:#0a0c11; --card:#12161d; --card2:#191e28; --line:#242b38; --inset:rgba(255,255,255,.045);
  --cyan:#17c3cf; --cyan2:#0e97a1; --green:#22c55e; --red:#ff5b60; --orange:#f5a623;
  --txt:#eef2f8; --muted:#8a93a5; --mono:#7fe3ea;
  /* legacy aliases kept so inline styles / JS class hooks keep working */
  --blue:#17c3cf; --gray:#8a93a5;
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family:-apple-system,system-ui,"SF Pro","Helvetica Neue",sans-serif;
  color:var(--txt);
  background:
    radial-gradient(900px 380px at 50% -120px, rgba(23,195,207,.14), transparent 70%),
    radial-gradient(600px 300px at 92% 6%, rgba(34,197,94,.07), transparent 65%),
    var(--bg);
  background-attachment:fixed;
}
::placeholder { color:#5d6675; }
::-webkit-scrollbar { width:6px; height:6px; }
::-webkit-scrollbar-thumb { background:#2b3342; border-radius:3px; }

/* ---- top bar: sticky glass ---- */
.topbar { position:sticky; top:0; z-index:1200; display:flex; align-items:center; gap:10px; padding:9px 12px; background:rgba(10,12,17,.82); -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px); border-bottom:1px solid var(--line); font-size:11px; color:var(--muted); }
.topbar .back { flex:none; color:var(--cyan); font-weight:700; text-decoration:none; }
.topbar .topcredit { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.topbar .topcredit a { color:#8fe0e6; text-decoration:none; font-weight:700; }
.topbar .topcredit .ytname { font-size:13.5px; font-weight:800; color:#ff6b70; text-shadow:0 0 14px rgba(255,91,96,.4); }
.topbar .topcredit .forkline { font-size:10.5px; color:#6b7484; }
.topbar .tg { flex:none; color:#5cb8e8; font-weight:700; text-decoration:none; padding:3px 9px; border:1px solid rgba(42,171,238,.45); border-radius:20px; }
.topbar .tg:active { background:rgba(42,171,238,.14); }

/* ---- video tutorial CTA ---- */
.vidbtn { display:flex; align-items:center; justify-content:center; gap:8px; margin:12px 12px 0; padding:15px; border-radius:13px; background:transparent; color:#ff6b70; border:1.5px solid rgba(255,91,96,.6); font-size:16px; font-weight:800; text-decoration:none; letter-spacing:.3px; transition:all .12s; }
.vidbtn:active { background:rgba(255,91,96,.12); transform:scale(.98); }

/* ---- anti-resale box: red bar + tint (matches landing) ---- */
.redbox { margin:12px 12px 0; padding:14px 16px; background:linear-gradient(180deg,rgba(255,91,96,.16),rgba(255,91,96,.06)); border:1px solid rgba(255,91,96,.5); border-left:5px solid var(--red); border-radius:12px; }
.redbox .rt { color:#ff6b70; font-size:17px; font-weight:800; line-height:1.4; letter-spacing:.3px; }
.redbox .rb { color:#ffdcdc; font-size:13.5px; font-weight:700; line-height:1.7; margin-top:8px; }

/* ---- map + its glass controls ---- */
#map { height:50vh; width:100%; min-height:250px; background:#0a0c11; border-bottom:1px solid var(--line); }
.leaflet-container { background:#0a0c11; }
.leaflet-control-zoom a { background:rgba(18,22,29,.9)!important; color:var(--txt)!important; border-color:var(--line)!important; -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); }
.leaflet-control-zoom a:hover { background:var(--card2)!important; }
.leaflet-bar { border:1px solid var(--line)!important; box-shadow:0 4px 18px rgba(0,0,0,.5)!important; }
.leaflet-control-attribution { background:rgba(10,12,17,.7)!important; color:#6b7484!important; }
.leaflet-control-attribution a { color:#8a93a5!important; }

.panel { padding:16px; max-width:600px; margin:0 auto; padding-bottom:calc(16px + env(safe-area-inset-bottom)); }

/* ---- glass cards ---- */
.card { background:linear-gradient(180deg,rgba(25,30,40,.72),rgba(18,22,29,.72)); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:16px; padding:16px; margin-bottom:12px; box-shadow:0 8px 28px rgba(0,0,0,.34); }
.card h3 { font-size:15px; font-weight:700; margin-bottom:12px; color:var(--txt); display:flex; align-items:center; gap:8px; }
.card h3::before { content:""; width:3px; height:14px; border-radius:2px; background:linear-gradient(180deg,var(--cyan),var(--green)); flex:none; }

.coords { font-family:"SF Mono",ui-monospace,monospace; font-size:13.5px; color:var(--muted); padding:10px 12px; background:var(--inset); border:1px solid var(--line); border-radius:10px; word-break:break-all; }
.crow { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--inset); border:1px solid var(--line); border-radius:10px; margin-bottom:6px; }
.crow .ck { font-size:11px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:var(--cyan); width:34px; flex:none; }
.crow .cv { flex:1; min-width:0; font-family:"SF Mono",ui-monospace,monospace; font-size:14px; color:var(--mono); word-break:break-all; }
.copybtn { flex:none; }

/* ---- buttons (positions unchanged, look upgraded) ---- */
.row { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
.btn { flex:1; min-width:100px; padding:12px 16px; border:none; border-radius:11px; font-size:14px; font-weight:700; cursor:pointer; transition:all .15s; }
.btn-primary { background:linear-gradient(135deg,var(--cyan),var(--cyan2)); color:#022a2d; box-shadow:0 6px 18px rgba(23,195,207,.28); }
.btn-primary:active { filter:brightness(1.12); transform:scale(.97); }
.btn-secondary { background:var(--card2); color:#c3ccdb; border:1px solid var(--line); font-weight:600; }
.btn-secondary:active { background:#2a3140; transform:scale(.97); }
.btn-danger { background:transparent; color:#ff6b70; border:1px solid rgba(255,91,96,.55); }
.btn-danger:active { background:rgba(255,91,96,.12); transform:scale(.97); }
.btn.success { background:linear-gradient(135deg,#2ee06a,#129a44); color:#04240f; border:none; box-shadow:0 6px 18px rgba(34,197,94,.3); }
.btn-sm { flex:none; min-width:auto; padding:6px 12px; font-size:12px; border-radius:8px; }

/* ---- inputs ---- */
.input-row { display:flex; gap:8px; margin-top:10px; }
.input-row input { flex:1; padding:10px 12px; background:var(--inset); border:1px solid var(--line); border-radius:10px; font-size:14px; color:var(--txt); outline:none; min-width:0; -webkit-appearance:none; transition:border-color .15s,box-shadow .15s; }
.cvi { flex:1; min-width:0; width:100%; font-family:"SF Mono",ui-monospace,monospace; font-size:14px; color:var(--mono); padding:6px 10px; background:var(--inset); border:1px solid var(--line); border-radius:8px; outline:none; -webkit-appearance:none; transition:border-color .15s,box-shadow .15s; }
.accfield input { width:100%; padding:8px 10px; background:var(--inset); border:1px solid var(--line); border-radius:8px; font-size:14px; color:var(--txt); outline:none; -webkit-appearance:none; transition:border-color .15s,box-shadow .15s; }
.input-row input:focus, .cvi:focus, .accfield input:focus, .modal input:focus { border-color:var(--cyan); box-shadow:0 0 0 3px rgba(23,195,207,.16); }
.acc-row { display:flex; gap:8px; margin-bottom:6px; }
.accfield { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.acclbl { font-size:11px; color:var(--muted); }

.status { font-size:12px; color:var(--muted); margin-top:8px; text-align:center; }
.hint { font-size:11px; color:#6b7484; margin-top:8px; line-height:1.6; }
.accnote { margin-top:10px; padding:11px 13px; background:var(--inset); border:1px solid var(--line); border-left:3px solid var(--cyan); border-radius:9px; font-size:11.5px; color:#a8b1c0; line-height:1.85; }
.accnote b { display:block; color:var(--cyan); font-weight:800; font-size:12px; margin-bottom:6px; letter-spacing:.3px; }
.accnote code { font-family:"SF Mono",ui-monospace,monospace; color:var(--mono); font-size:11px; }
.accnote em { color:var(--txt); font-style:normal; font-weight:800; }
.accnote .src { display:block; margin-top:7px; color:#5d6675; font-size:10.5px; }

/* ---- lists ---- */
.search-results { margin-top:8px; max-height:260px; overflow-y:auto; }
.search-item { padding:10px 12px; background:var(--inset); border:1px solid var(--line); border-radius:10px; margin-bottom:6px; cursor:pointer; transition:all .15s; }
.search-item:active { background:#232a37; border-color:var(--cyan); }
.search-item .si-name { font-size:14px; color:var(--txt); font-weight:600; }
.search-item .si-sub { font-size:11px; color:var(--muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.error-banner { background:linear-gradient(180deg,rgba(255,91,96,.18),rgba(255,91,96,.08)); border:1px solid rgba(255,91,96,.5); border-left:4px solid var(--red); color:#ffdcdc; padding:14px 16px; border-radius:12px; margin-bottom:12px; font-size:13.5px; line-height:1.6; display:none; }
.error-banner b { display:block; margin-bottom:4px; color:#ff6b70; font-size:14.5px; }

/* --- tiled diagonal watermark (continuous, self-restoring, never blocks the map) --- */
.wm { position:fixed; inset:0; z-index:9998; pointer-events:none; overflow:hidden; user-select:none; -webkit-user-select:none; }
.wm-i { position:absolute; inset:-60%; display:flex; flex-wrap:wrap; align-content:flex-start; transform:rotate(-24deg); opacity:.11; }
.wm-i span { flex:none; padding:26px 30px; font-size:17.5px; font-weight:800; white-space:nowrap; color:#8fe0e6; letter-spacing:.4px; text-shadow:0 1px 3px rgba(0,0,0,.5); }

.toast { position:fixed; top:60px; left:50%; transform:translateX(-50%); background:rgba(8,10,14,.92); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); border:1px solid var(--line); color:#fff; padding:11px 20px; border-radius:22px; font-size:14px; opacity:0; transition:opacity .3s; pointer-events:none; z-index:9999; max-width:90vw; text-align:center; box-shadow:0 8px 28px rgba(0,0,0,.5); }
.toast.show { opacity:1; }

.active-loc { background:var(--inset); border:1px solid var(--line); border-radius:10px; padding:11px 12px; font-size:13px; color:var(--txt); }
.active-loc .label { font-size:11px; color:var(--muted); margin-bottom:5px; }
.active-loc .value { font-family:"SF Mono",ui-monospace,monospace; font-size:13px; color:var(--mono); }

.fav-list { max-height:240px; overflow-y:auto; }
.fav-item { display:flex; align-items:center; gap:8px; padding:10px 12px; background:var(--inset); border:1px solid var(--line); border-radius:10px; margin-bottom:6px; cursor:pointer; transition:all .15s; }
.fav-item:active { background:#232a37; border-color:var(--cyan); }
.fav-item .fav-info { flex:1; min-width:0; }
.fav-item .fav-name { font-size:14px; font-weight:600; color:var(--txt); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fav-item .fav-coords { font-size:11px; color:var(--muted); font-family:"SF Mono",ui-monospace,monospace; margin-top:2px; }
.fav-item .fav-active { font-size:10px; color:var(--green); font-weight:700; margin-top:2px; }
.fav-item .fav-del { flex:none; width:28px; height:28px; border:none; border-radius:50%; background:transparent; color:var(--red); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .15s; }
.fav-item .fav-del:hover { background:rgba(255,91,96,.14); }
.fav-empty { text-align:center; color:var(--muted); font-size:13px; padding:16px 0; }
.fav-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.fav-header h3 { margin-bottom:0; }

/* ---- modal ---- */
.modal-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(4,6,10,.66); -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); z-index:10000; display:none; align-items:center; justify-content:center; padding:20px; }
.modal-overlay.show { display:flex; }
.modal { background:linear-gradient(180deg,#1a1f29,#12161d); border:1px solid var(--line); border-radius:18px; padding:20px; width:100%; max-width:340px; box-shadow:0 20px 60px rgba(0,0,0,.6); }
.modal h3 { font-size:17px; font-weight:700; margin-bottom:16px; text-align:center; color:var(--txt); }
.modal input { width:100%; padding:12px; background:var(--inset); border:1px solid var(--line); border-radius:10px; font-size:15px; color:var(--txt); outline:none; margin-bottom:12px; -webkit-appearance:none; transition:border-color .15s,box-shadow .15s; }
.modal .modal-btns { display:flex; gap:8px; }
.modal .modal-btns .btn { padding:12px; }

/* ---- map overlay switches: dark glass pills ---- */
.layer-switch { position:absolute; top:10px; right:10px; z-index:1000; display:flex; gap:4px; background:rgba(10,12,17,.74); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:10px; padding:4px; box-shadow:0 4px 18px rgba(0,0,0,.45); }
.layer-btn { border:none; background:transparent; padding:6px 10px; border-radius:7px; font-size:12px; font-weight:600; color:#a8b1c0; cursor:pointer; transition:all .15s; white-space:nowrap; }
.layer-btn.active { background:linear-gradient(135deg,var(--cyan),var(--cyan2)); color:#022a2d; font-weight:700; }
.layer-btn:active { transform:scale(.95); }
.lang-switch { position:absolute; top:10px; left:10px; z-index:1000; display:flex; gap:2px; background:rgba(10,12,17,.74); -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:10px; padding:4px; box-shadow:0 4px 18px rgba(0,0,0,.45); }
.lang-btn { border:none; background:transparent; padding:6px 11px; border-radius:7px; font-size:12px; font-weight:700; color:#a8b1c0; cursor:pointer; transition:all .15s; }
.lang-btn.active { background:linear-gradient(135deg,var(--cyan),var(--cyan2)); color:#022a2d; }
.lang-btn:active { transform:scale(.95); }

@media(max-width:480px) { #map { height:44vh; } .panel { padding:12px; } .layer-btn { padding:5px 7px; font-size:11px; } }
</style>
</head>
<body>
<div class="topbar">
  <a class="back" href="/">← 主页</a>
  <span class="topcredit">📺 <a class="ytname" href="https://www.youtube.com/@CyberHandyman/videos" target="_blank" rel="noopener">YouTube CyberHandyman 赛博工具人</a><span class="forkline"> · fork from 鸣谢贡献者: Yu9191 / mekos2772 / acheong08</span></span>
  <a class="tg" href="https://t.me/cyberhandymancngroup" target="_blank" rel="noopener">✈️ TG群</a>
</div>
<div class="redbox">
  <div class="rt">⚠️ 免费开源 · 禁止售卖</div>
  <div class="rb"><b>如果你是通过付款来到本页面，请立即联系退款。</b>任何售卖本项目/模块的都是骗子，一经发现立即删库，血本无归！！！！<br>仅供学习研究，禁止违法用途，后果自负、与作者无关，与 Apple 无关。</div>
</div>
<a class="vidbtn" href="https://youtu.be/EspuRlKWUxc" target="_blank" rel="noopener" data-i18n="video_btn">▶️ 视频教程（YouTube）</a>
<div style="position:relative">
<div id="map"></div>
<div class="lang-switch">
  <button class="lang-btn" data-lang="zh" onclick="setLang('zh')">中</button>
  <button class="lang-btn" data-lang="en" onclick="setLang('en')">EN</button>
</div>
<div class="layer-switch">
  <button class="layer-btn active" data-layer="satellite" data-i18n="layer_satellite" onclick="switchLayer('satellite')">Satellite</button>
  <button class="layer-btn" data-layer="wgs84" onclick="switchLayer('wgs84')">WGS84</button>
  <button class="layer-btn" data-layer="amap" data-i18n="layer_amap" onclick="switchLayer('amap')">Amap</button>
  <button class="layer-btn" data-layer="voyager" data-i18n="layer_color" onclick="switchLayer('voyager')">Color</button>
  <button class="layer-btn" data-layer="standard" data-i18n="layer_standard" onclick="switchLayer('standard')">Standard</button>
  <button class="layer-btn" data-layer="dark" data-i18n="layer_dark" onclick="switchLayer('dark')">Dark</button>
</div>
</div>
<div class="panel">
  <div class="error-banner" id="errorBanner" data-i18n-html="err_html"></div>
  <div class="card">
    <h3 data-i18n="choose_title">Choose target location</h3>
    <div class="coords" id="coords" data-i18n="coords_hint">Tap the map or use the tools below to pick a location</div>
    <div id="coordGrid" style="display:none">
      <div class="crow"><span class="ck" data-i18n="lat">Lat</span><span class="cv" id="cvLat"></span><button class="btn btn-sm btn-secondary copybtn" data-i18n="copy" onclick="copyField('lat',this)">Copy</button></div>
      <div class="crow"><span class="ck" data-i18n="lon">Lon</span><span class="cv" id="cvLon"></span><button class="btn btn-sm btn-secondary copybtn" data-i18n="copy" onclick="copyField('lon',this)">Copy</button></div>
      <div class="crow"><span class="ck" data-i18n="alt">Alt</span><input class="cvi" id="altInput" type="number" inputmode="decimal" step="1" /><button class="btn btn-sm btn-secondary copybtn" data-i18n="copy" onclick="copyField('alt',this)">Copy</button></div>
      <div class="acc-row">
        <div class="accfield"><span class="acclbl" data-i18n="hacc">H. accuracy</span><input id="haccInput" type="number" inputmode="numeric" step="1" min="1" value="39" /></div>
        <div class="accfield"><span class="acclbl" data-i18n="vacc">V. accuracy</span><input id="vaccInput" type="number" inputmode="numeric" step="1" min="1" value="1000" /></div>
      </div>
    </div>
    <div class="row">
      <button class="btn btn-primary" id="saveBtn" data-i18n="save" onclick="save()">Save to Device</button>
      <button class="btn btn-secondary" data-i18n="restore" onclick="restoreReal()">Restore real</button>
    </div>
    <div class="row">
      <button class="btn btn-secondary" data-i18n="copy_params" onclick="copyParams(this)">Copy module params</button>
      <button class="btn btn-secondary" data-i18n="add_fav" onclick="addFav()">Add Favorite</button>
      <button class="btn btn-secondary" data-i18n="locate" onclick="locateMe()">Current Location</button>
    </div>
    <div class="hint" data-i18n="alt_hint">Altitude is auto-filled from Open-Meteo (WGS-84) and editable. It is written to the device on Save and applied by the module.</div>
    <div class="accnote" data-i18n-html="acc_note_html"></div>
  </div>
  <div class="card">
    <div class="fav-header">
      <h3 data-i18n="fav_title">Favorites</h3>
      <button class="btn btn-sm btn-secondary" data-i18n="clear_all" onclick="clearAllFav()" id="clearAllBtn" style="display:none">Clear All</button>
    </div>
    <div id="favList" class="fav-list"></div>
  </div>
  <div class="card">
    <h3 data-i18n="active_title">Active coordinates</h3>
    <div class="active-loc" id="activeLoc">
      <div class="label" data-i18n="active_label">On-device coordinates (latitude/longitude/altitude)</div>
      <div class="value" id="activeValue">Querying...</div>
    </div>
    <div class="row">
      <button class="btn btn-sm btn-secondary" data-i18n="refresh" onclick="queryActive()">Refresh</button>
      <button class="btn btn-sm btn-danger" data-i18n="clear_data" onclick="clearActive()">Clear Data</button>
    </div>
  </div>
  <div class="card">
    <h3 data-i18n="paste_title">Paste map link</h3>
    <div class="input-row">
      <input id="urlInput" data-i18n-ph="paste_ph" placeholder="Apple/Google/Amap/Baidu map link or coordinates" />
      <button class="btn btn-secondary" style="flex:none;min-width:56px" data-i18n="parse" onclick="parseUrl()">Parse</button>
    </div>
    <div style="font-size:11px;color:var(--gray);margin-top:6px" data-i18n="paste_hint">Supports Apple Maps · Google Maps · Amap · Baidu · coordinate text (auto-converted to WGS-84)</div>
  </div>
  <div class="card">
    <h3 data-i18n="search_title">Search place</h3>
    <div class="input-row">
      <input id="searchInput" data-i18n-ph="search_ph" placeholder="Search a place, Enter to list candidates (preview only)" />
      <button class="btn btn-secondary" style="flex:none;min-width:56px" data-i18n="search" onclick="searchPlace()">Search</button>
    </div>
    <div id="searchResults" class="search-results"></div>
  </div>
  <div class="status" id="status">Pick a location, then tap "Save to Device" to write it to your proxy tool</div>
</div>
<div class="wm" id="wm" aria-hidden="true"><div class="wm-i" id="wmi"></div></div>
<div class="toast" id="toast"></div>
<div class="modal-overlay" id="favModal">
  <div class="modal">
    <h3 data-i18n="modal_title">Add this location to favorites</h3>
    <input id="favNameInput" data-i18n-ph="modal_ph" placeholder="Enter a label (e.g. Office, Home)" maxlength="30" />
    <div style="font-size:12px;color:var(--gray);margin-bottom:12px;text-align:center" id="favModalCoords"></div>
    <div class="modal-btns">
      <button class="btn btn-secondary" data-i18n="cancel" onclick="closeFavModal()">Cancel</button>
      <button class="btn btn-primary" data-i18n="save_short" onclick="confirmFav()">Save</button>
    </div>
  </div>
</div>
<script>
const SAVE_API = 'https://gs-loc.apple.com/ils-settings/save';
const PARSE_API = '/api/parse';
const ELEV_API = 'https://api.open-meteo.com/v1/elevation';
const FAV_KEY = 'ils_favorites';
const LANG_KEY = 'ils_lang';
let lat = 0, lon = 0;          // no hard-coded home city: nothing is "default" until the user picks
let didInitialCenter = false;  // auto-center once, only if the device already has coordinates
let selected = false;
let elev = null, elevState = 'idle'; // idle | loading | ok | fail
let elevSeq = 0, elevTimer = null;
const elevCache = new Map();
let activeLon = null, activeLat = null, activeAcc = null, activeAlt = null, activeStatus = 'querying';
let savedLon = null, savedLat = null, savedTimeStr = '';

/* ---- i18n ---- */
const I18N = {
  zh: {
    title: 'iOS 虚拟定位',
    layer_satellite: '卫星', layer_amap: '高德', layer_color: '彩色', layer_standard: '标准', layer_dark: '暗色',
    err_html: '<b>模块未生效</b>请检查以下配置：<br>1. 已安装并启用 iOS Location Spoofer 模块<br>2. MITM 已开启且信任证书<br>3. MITM 主机名包含 gs-loc.apple.com<br>4. 当前网络已走代理',
    choose_title: '选择目标位置',
    coords_hint: '点击地图或使用下方工具选择位置',
    save: '储存到设备', add_fav: '收藏位置', locate: '当前位置',
    copy: '复制', copy_params: '复制模块参数',
    lat: '纬度', lon: '经度', alt: '海拔',
    alt_querying: '海拔查询中…', alt_na: '海拔不可用',
    alt_hint: '海拔由 Open-Meteo 自动查询（WGS-84），储存到设备时随经纬度一并写入，由 iOS Location Spoofer 模块生效。',
    acc_note_html: '<b>精度参数怎么填</b>' +
      '<code>horizontalAccuracy</code> 水平精度（米），默认 <em>39</em>，越小越「精准」—— 想更像 GPS 可设 <em>5~15</em>；保持 <em>39</em> 也正常。<br>' +
      '<code>verticalAccuracy</code> 垂直精度（米），默认 <em>1000</em> —— 本页已自动填入目标点真实海拔，可调小到 <em>10~30</em>，让海拔显得更可信。' +
      '<span class="src">参数建议来自上游项目 mekos2772 / ios-location-spoofer</span>',
    fav_title: '收藏的位置', clear_all: '清空全部',
    active_title: '当前生效坐标', active_label: '设备本地坐标 (latitude/longitude/altitude)',
    refresh: '刷新', clear_data: '清除数据',
    paste_title: '粘贴地图链接', paste_ph: 'Apple/Google/高德/百度地图链接 或 经纬度', parse: '解析',
    paste_hint: '支持 Apple Maps · Google Maps · 高德 · 百度 · 坐标文本（自动换算为 WGS-84）',
    search_title: '搜索地点', search_ph: '搜地名，回车列出候选（只预览，不改定位）', search: '搜索',
    status_hint: '选好位置后点击「储存到设备」写入代理工具',
    modal_title: '收藏此位置', modal_ph: '输入备注名称（如: 公司、家）', cancel: '取消', save_short: '保存',
    acc: '精度', restore: '恢复真实定位', restored: '✓ 虚拟定位已清除，定位服务开关关闭后，关掉代理开关，等待至少 10 秒钟，再次开启生效', hacc: '水平精度', vacc: '垂直精度',
    querying: '查询中...', no_saved: '无已保存的坐标', query_failed: '查询失败 (需要代理模块支持)', cleared: '已清除',
    fav_empty: '暂无收藏，选好位置后点击「收藏位置」',
    active_now: '✓ 当前生效', del: '删除',
    pick_first: '请先在地图上选择一个位置',
    enter_label: '请输入备注名称',
    added: function(n){ return '已收藏: ' + n; },
    deleted: function(n){ return '已删除: ' + n; },
    clear_fav_confirm: '确定清空所有收藏？', all_cleared: '已清空所有收藏',
    clear_confirm: '确定清除设备上已保存的坐标？清除后将使用模块默认参数或停止修改定位。',
    dev_cleared: '已清除设备坐标',
    clear_failed: function(e){ return '清除失败: ' + e; },
    clear_failed_cfg: '清除失败 - 请检查模块配置',
    saving: '储存中...', saved: '✓ 已储存',
    written: function(lo, la, ts){ return '✓ 已写入: ' + lo.toFixed(6) + ', ' + la.toFixed(6) + ' · ' + ts; },
    saved_toast: '✓ 坐标已成功写入模块，定位服务关闭开关，等待至少 10 秒钟，再次开启生效',
    video_btn: '▶️ 视频教程（YouTube）',
    save_failed: '✗ 储存失败 - 请检查模块配置', write_failed: '写入失败',
    no_geo: '浏览器不支持定位', getting_loc: '获取位置中...', got_loc: '已获取当前位置',
    loc_failed: function(m){ return '定位失败: ' + m; },
    paste_first: '请粘贴地图链接或坐标', parse_failed: '无法解析坐标，请检查链接格式', parsing: '解析中...',
    parsed: function(lo, la){ return '已解析: ' + lo.toFixed(4) + ', ' + la.toFixed(4); },
    enter_place: '请输入地名', searching: '搜索中...',
    not_found: function(q){ return '未找到: ' + q; }, search_failed: '搜索失败',
    copied: function(x){ return '已复制: ' + x; }, copy_failed: '复制失败，请手动选择',
    alt_unknown_copy: '海拔尚未获取，仅复制经纬度'
  },
  en: {
    title: 'iOS Location Spoofer',
    layer_satellite: 'Satellite', layer_amap: 'Amap', layer_color: 'Color', layer_standard: 'Standard', layer_dark: 'Dark',
    err_html: '<b>Module not active</b>Please check the following:<br>1. The iOS Location Spoofer module is installed and enabled<br>2. MITM is on and the certificate is trusted<br>3. The MITM hostname list includes gs-loc.apple.com<br>4. The current network is routed through the proxy',
    choose_title: 'Choose target location',
    coords_hint: 'Tap the map or use the tools below to pick a location',
    save: 'Save to Device', add_fav: 'Add Favorite', locate: 'Current Location',
    copy: 'Copy', copy_params: 'Copy module params',
    lat: 'Lat', lon: 'Lon', alt: 'Alt',
    alt_querying: 'querying altitude…', alt_na: 'altitude unavailable',
    alt_hint: 'Altitude is auto-filled from Open-Meteo (WGS-84), written to the device on Save, and applied by the iOS Location Spoofer module.',
    acc_note_html: '<b>Choosing the accuracy values</b>' +
      '<code>horizontalAccuracy</code> in metres, default <em>39</em> — the smaller, the more "precise" it looks. Set <em>5–15</em> to look more like GPS; <em>39</em> is perfectly fine too.<br>' +
      '<code>verticalAccuracy</code> in metres, default <em>1000</em> — this page already fills in the target\\'s real altitude, so lowering it to <em>10–30</em> makes that altitude look more credible.' +
      '<span class="src">Guidance from the upstream project mekos2772 / ios-location-spoofer</span>',
    fav_title: 'Favorites', clear_all: 'Clear All',
    active_title: 'Active coordinates', active_label: 'On-device coordinates (latitude/longitude/altitude)',
    refresh: 'Refresh', clear_data: 'Clear Data',
    paste_title: 'Paste map link', paste_ph: 'Apple / Google / Amap / Baidu map link or coordinates', parse: 'Parse',
    paste_hint: 'Supports Apple Maps · Google Maps · Amap · Baidu · coordinate text (auto-converted to WGS-84)',
    search_title: 'Search place', search_ph: 'Search a place, Enter to list candidates (preview only)', search: 'Search',
    status_hint: 'Pick a location, then tap "Save to Device" to write it to your proxy tool',
    modal_title: 'Add this location to favorites', modal_ph: 'Enter a label (e.g. Office, Home)', cancel: 'Cancel', save_short: 'Save',
    acc: 'Accuracy', restore: 'Restore real location', restored: '✓ Spoofed location cleared. Turn Location Services OFF, switch your proxy off, wait at least 10 seconds, then turn it back ON to take effect.', hacc: 'H. accuracy', vacc: 'V. accuracy',
    querying: 'Querying...', no_saved: 'No saved coordinates', query_failed: 'Query failed (requires the proxy module)', cleared: 'Cleared',
    fav_empty: 'No favorites yet. Pick a location and tap "Add Favorite".',
    active_now: '✓ Active now', del: 'Delete',
    pick_first: 'Please pick a location on the map first',
    enter_label: 'Please enter a label',
    added: function(n){ return 'Added: ' + n; },
    deleted: function(n){ return 'Deleted: ' + n; },
    clear_fav_confirm: 'Clear all favorites?', all_cleared: 'All favorites cleared',
    clear_confirm: 'Clear the coordinates saved on the device? After clearing, the module default parameters will be used or location spoofing will stop.',
    dev_cleared: 'Device coordinates cleared',
    clear_failed: function(e){ return 'Clear failed: ' + e; },
    clear_failed_cfg: 'Clear failed - please check the module configuration',
    saving: 'Saving...', saved: '✓ Saved',
    written: function(lo, la, ts){ return '✓ Written: ' + lo.toFixed(6) + ', ' + la.toFixed(6) + ' · ' + ts; },
    saved_toast: '✓ Coordinates written to the module. Turn Location Services OFF, wait at least 10 seconds, then turn it back ON to take effect.',
    video_btn: '▶️ Video tutorial (YouTube)',
    save_failed: '✗ Save failed - please check the module configuration', write_failed: 'Write failed',
    no_geo: 'Browser does not support geolocation', getting_loc: 'Getting location...', got_loc: 'Current location acquired',
    loc_failed: function(m){ return 'Location failed: ' + m; },
    paste_first: 'Please paste a map link or coordinates', parse_failed: 'Could not parse coordinates, please check the link format', parsing: 'Parsing...',
    parsed: function(lo, la){ return 'Parsed: ' + lo.toFixed(4) + ', ' + la.toFixed(4); },
    enter_place: 'Please enter a place name', searching: 'Searching...',
    not_found: function(q){ return 'Not found: ' + q; }, search_failed: 'Search failed',
    copied: function(x){ return 'Copied: ' + x; }, copy_failed: 'Copy failed, please select manually',
    alt_unknown_copy: 'Altitude not ready, copied lat/lon only'
  }
};

function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch(e) {}
  return 'zh'; // default to Chinese; tap EN to switch (remembered per browser)
}
let lang = detectLang();

function t(key) {
  const v = I18N[lang][key];
  if (typeof v === 'function') return v.apply(null, Array.prototype.slice.call(arguments, 1));
  return v === undefined ? key : v;
}

function applyI18n() {
  document.documentElement.lang = (lang === 'zh' ? 'zh-CN' : 'en');
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach(function(el){ el.textContent = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function(el){ el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  document.querySelectorAll('[data-i18n-html]').forEach(function(el){ el.innerHTML = t(el.getAttribute('data-i18n-html')); });
  document.querySelectorAll('.lang-btn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-lang') === lang); });
  updateCoords();
  updateStatus();
  renderActive();
  renderFavs();
}

function setLang(l) {
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch(e) {}
  applyI18n();
}

const map = L.map('map').setView([20, 0], 2);  // neutral world view — implies no default location
const tiles = {
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'ArcGIS'}),
  wgs84: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'ArcGIS WGS84'}),
  standard: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'\\u00a9 OSM'}),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'\\u00a9 Carto'}),
  amap: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {maxZoom:18, subdomains:'1234', attribution:'\\u00a9 Amap'}),
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'\\u00a9 Carto'})
};
let currentLayer = tiles.satellite;
currentLayer.addTo(map);
function switchLayer(name) {
  map.removeLayer(currentLayer);
  currentLayer = tiles[name];
  currentLayer.addTo(map);
  document.querySelectorAll('.layer-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === name));
}
let marker = L.marker([lat, lon], {draggable:true});
let markerShown = false;
function showMarker() { if (!markerShown) { marker.addTo(map); markerShown = true; } }

marker.on('dragend', e => { const p=e.target.getLatLng(); setPos(p.lat, p.lng); });
map.on('click', e => { setPos(e.latlng.lat, e.latlng.lng); });

/* Altitude is an editable field (auto-filled from Open-Meteo, user can override). */
function currentAlt() {
  const el = document.getElementById('altInput');
  if (!el) return null;
  const n = parseFloat(el.value);
  return isFinite(n) ? Math.round(n) : null;
}
function haccVal() { const n = parseInt((document.getElementById('haccInput')||{}).value, 10); return isFinite(n) && n > 0 ? n : 39; }
function vaccVal() { const n = parseInt((document.getElementById('vaccInput')||{}).value, 10); return isFinite(n) && n > 0 ? n : 1000; }
function setAltInput(v) {
  const el = document.getElementById('altInput');
  if (!el) return;
  if (v === null) { el.value = ''; el.placeholder = t('alt_na'); }
  else { el.value = v; el.placeholder = ''; }
}

function updateCoords() {
  const grid = document.getElementById('coordGrid');
  const coords = document.getElementById('coords');
  if (!selected) {
    grid.style.display = 'none';
    coords.style.display = '';
    coords.textContent = t('coords_hint');
    return;
  }
  coords.style.display = 'none';
  grid.style.display = '';
  document.getElementById('cvLat').textContent = lat.toFixed(6);
  document.getElementById('cvLon').textContent = lon.toFixed(6);
}

function updateStatus() {
  document.getElementById('status').textContent = (savedLon !== null)
    ? t('written', savedLon, savedLat, savedTimeStr)
    : t('status_hint');
}

function setPos(newLat, newLon, knownAlt) {
  lat = newLat; lon = newLon; selected = true;
  showMarker();
  marker.setLatLng([lat, lon]);
  if (typeof knownAlt === 'number') { elev = Math.round(knownAlt); elevState = 'ok'; elevCache.set(elevKey(lat, lon), elev); }
  updateCoords();
  fetchElevation(lat, lon);
}

function moveTo(newLat, newLon, zoom, knownAlt) {
  setPos(newLat, newLon, knownAlt);
  map.setView([lat, lon], zoom || 15);
}

/* ---- Elevation (Open-Meteo): debounced + cached, WGS-84 native ---- */
function elevKey(la, lo) { return la.toFixed(4) + ',' + lo.toFixed(4); }
function fetchElevation(la, lo) {
  const key = elevKey(la, lo);
  if (elevCache.has(key)) { elev = elevCache.get(key); elevState = (elev === null ? 'fail' : 'ok'); setAltInput(elev); return; }
  elevState = 'loading'; elev = null;
  const el = document.getElementById('altInput'); if (el) { el.value = ''; el.placeholder = t('alt_querying'); }
  const seq = ++elevSeq;
  clearTimeout(elevTimer);
  elevTimer = setTimeout(function(){
    fetch(ELEV_API + '?latitude=' + la + '&longitude=' + lo, { cache:'no-store' })
      .then(r => r.json())
      .then(d => {
        const e = (d && d.elevation && d.elevation.length && d.elevation[0] !== null) ? Math.round(d.elevation[0]) : null;
        elevCache.set(key, e);
        if (seq === elevSeq) { elev = e; elevState = (e === null ? 'fail' : 'ok'); setAltInput(e); }
      })
      .catch(() => { if (seq === elevSeq) { elev = null; elevState = 'fail'; setAltInput(null); } });
  }, 500);
}

let toastTimer = null;
function toast(msg, ms) {
  const t2 = document.getElementById('toast');
  t2.textContent = msg; t2.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t2.classList.remove('show'), ms || 2500);
}

function showError(show) {
  document.getElementById('errorBanner').style.display = show ? 'block' : 'none';
}

/* ---- Clipboard ---- */
function copyText(str) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(str);
  }
  return new Promise(function(resolve, reject){
    try {
      const ta = document.createElement('textarea');
      ta.value = str; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand failed'));
    } catch(e) { reject(e); }
  });
}

function copyField(which, btn) {
  if (!selected) { toast(t('pick_first')); return; }
  let val;
  if (which === 'lat') val = lat.toFixed(6);
  else if (which === 'lon') val = lon.toFixed(6);
  else { const a = currentAlt(); if (a === null) { toast(t('alt_na')); return; } val = String(a); }
  copyText(val).then(() => {
    toast(t('copied', val));
    if (btn) { const o = btn.textContent; btn.classList.add('success'); btn.textContent = '✓'; setTimeout(() => { btn.textContent = o; btn.classList.remove('success'); }, 1200); }
  }).catch(() => toast(t('copy_failed'), 3000));
}

function moduleParamString() {
  let s = 'latitude=' + lat.toFixed(6) + '&longitude=' + lon.toFixed(6);
  const a = currentAlt(); if (a !== null) s += '&altitude=' + a;
  s += '&horizontalAccuracy=' + haccVal() + '&verticalAccuracy=' + vaccVal();
  return s;
}

function copyParams(btn) {
  if (!selected) { toast(t('pick_first')); return; }
  const s = moduleParamString();
  copyText(s).then(() => {
    toast(t('copied', s));
    if (currentAlt() === null) toast(t('alt_unknown_copy'), 3000);
    if (btn) { const o = btn.textContent; btn.classList.add('success'); btn.textContent = t('saved'); setTimeout(() => { btn.textContent = o; btn.classList.remove('success'); }, 1200); }
  }).catch(() => toast(t('copy_failed'), 3000));
}

/* ---- Favorites (localStorage) ---- */
function getFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch(e) { return []; }
}
function saveFavs(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

function renderFavs() {
  const favs = getFavs();
  const el = document.getElementById('favList');
  const clearBtn = document.getElementById('clearAllBtn');
  clearBtn.style.display = favs.length ? '' : 'none';
  if (!favs.length) {
    el.innerHTML = '<div class="fav-empty">' + escHtml(t('fav_empty')) + '<\\/div>';
    return;
  }
  el.innerHTML = favs.map((f, i) => {
    const isActive = activeLon !== null && Math.abs(f.lon - activeLon) < 0.000001 && Math.abs(f.lat - activeLat) < 0.000001;
    const altStr = (typeof f.alt === 'number') ? ('  ·  ' + f.alt + ' m') : '';
    return '<div class="fav-item" onclick="loadFav(' + i + ')">' +
      '<div class="fav-info">' +
        '<div class="fav-name">' + escHtml(f.name) + '<\\/div>' +
        '<div class="fav-coords">' + f.lon.toFixed(6) + ', ' + f.lat.toFixed(6) + altStr + '<\\/div>' +
        (isActive ? '<div class="fav-active">' + escHtml(t('active_now')) + '<\\/div>' : '') +
      '<\\/div>' +
      '<button class="fav-del" onclick="event.stopPropagation();delFav(' + i + ')" title="' + escHtml(t('del')) + '">\\u00d7<\\/button>' +
    '<\\/div>';
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addFav() {
  if (!selected) { toast(t('pick_first')); return; }
  var _fa = currentAlt();
  document.getElementById('favModalCoords').textContent = lon.toFixed(6) + ', ' + lat.toFixed(6) + (_fa !== null ? ('  ·  ' + _fa + ' m') : '');
  document.getElementById('favNameInput').value = '';
  document.getElementById('favModal').classList.add('show');
  setTimeout(() => document.getElementById('favNameInput').focus(), 100);
}

function closeFavModal() {
  document.getElementById('favModal').classList.remove('show');
}

function confirmFav() {
  const name = document.getElementById('favNameInput').value.trim();
  if (!name) { toast(t('enter_label')); return; }
  const favs = getFavs();
  const rec = { name, lon, lat, time: new Date().toISOString() };
  const _ca = currentAlt(); if (_ca !== null) rec.alt = _ca;
  favs.push(rec);
  saveFavs(favs);
  closeFavModal();
  renderFavs();
  toast(t('added', name));
}

function loadFav(i) {
  const favs = getFavs();
  if (!favs[i]) return;
  moveTo(favs[i].lat, favs[i].lon, 15, typeof favs[i].alt === 'number' ? favs[i].alt : undefined);
  toast(favs[i].name + ' (' + favs[i].lon.toFixed(4) + ', ' + favs[i].lat.toFixed(4) + ')');
}

function delFav(i) {
  const favs = getFavs();
  if (!favs[i]) return;
  const name = favs[i].name;
  favs.splice(i, 1);
  saveFavs(favs);
  renderFavs();
  toast(t('deleted', name));
}

function clearAllFav() {
  if (!confirm(t('clear_fav_confirm'))) return;
  saveFavs([]);
  renderFavs();
  toast(t('all_cleared'));
}

/* ---- Active location query ---- */
function renderActive() {
  const el = document.getElementById('activeValue');
  if (activeStatus === 'ok') {
    el.textContent = t('lon') + ' ' + activeLon.toFixed(6) + '  ' + t('lat') + ' ' + activeLat.toFixed(6)
      + (activeAcc ? ('  ' + t('acc') + ' ' + activeAcc + 'm') : '')
      + (activeAlt !== null && activeAlt !== undefined ? ('  ' + t('alt') + ' ' + activeAlt + 'm') : '');
  } else if (activeStatus === 'none') {
    el.textContent = t('no_saved');
  } else if (activeStatus === 'failed') {
    el.textContent = t('query_failed');
  } else if (activeStatus === 'cleared') {
    el.textContent = t('cleared');
  } else {
    el.textContent = t('querying');
  }
}

function queryActive() {
  activeStatus = 'querying';
  renderActive();
  fetch(SAVE_API + '?action=query', { method:'GET', mode:'cors', cache:'no-store' })
    .then(r => r.json())
    .then(d => {
      if (d.success && d.longitude && d.latitude) {
        activeLon = parseFloat(d.longitude);
        activeLat = parseFloat(d.latitude);
        activeAcc = (d.horizontalAccuracy != null ? d.horizontalAccuracy : (d.accuracy || null));
        activeAlt = (d.altitude !== undefined && d.altitude !== null) ? d.altitude : null;
        activeStatus = 'ok';
        if (!didInitialCenter && !selected) {
          didInitialCenter = true;
          moveTo(activeLat, activeLon, 15, (activeAlt !== null && activeAlt !== undefined) ? activeAlt : undefined);
        }
      } else {
        activeLon = null; activeLat = null; activeAcc = null; activeAlt = null;
        activeStatus = 'none';
      }
      renderActive();
      renderFavs();
    })
    .catch(() => { activeStatus = 'failed'; renderActive(); });
}

function clearActive() {
  if (!confirm(t('clear_confirm'))) return;
  fetch(SAVE_API + '?action=clear', { method:'GET', mode:'cors', cache:'no-store' })
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        activeLon = null; activeLat = null; activeAcc = null; activeAlt = null;
        activeStatus = 'cleared';
        renderActive();
        renderFavs();
        toast(t('dev_cleared'));
      } else { toast(t('clear_failed', d.error || ''), 3000); }
    })
    .catch(() => { toast(t('clear_failed_cfg'), 3000); });
}

/* ---- Save to device ---- */
async function save() {
  if (!selected) { toast(t('pick_first')); return; }
  const btn = document.getElementById('saveBtn');
  btn.textContent = t('saving'); btn.disabled = true;
  showError(false);
  try {
    let url = SAVE_API + '?lon=' + lon + '&lat=' + lat;
    const a = currentAlt(); if (a !== null) url += '&alt=' + a;
    url += '&hacc=' + haccVal() + '&vacc=' + vaccVal();
    const r = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
    const d = await r.json();
    if (d.success) {
      activeLon = lon; activeLat = lat; activeAcc = haccVal();
      activeAlt = currentAlt();
      activeStatus = 'ok';
      savedLon = lon; savedLat = lat; savedTimeStr = new Date().toLocaleTimeString();
      btn.textContent = t('saved'); btn.className = 'btn btn-primary success';
      updateStatus();
      renderActive();
      renderFavs();
      toast(t('saved_toast'), 30000);
      setTimeout(() => { btn.textContent = t('save'); btn.className='btn btn-primary'; btn.disabled=false; }, 2500);
    } else {
      throw new Error(d.error || t('write_failed'));
    }
  } catch(e) {
    btn.textContent = t('save'); btn.className = 'btn btn-primary'; btn.disabled = false;
    showError(true);
    toast(t('save_failed'), 4000);
  }
}

function locateMe() {
  if (!navigator.geolocation) return toast(t('no_geo'));
  toast(t('getting_loc'));
  navigator.geolocation.getCurrentPosition(
    pos => { moveTo(pos.coords.latitude, pos.coords.longitude, 16); toast(t('got_loc')); },
    err => toast(t('loc_failed', err.message), 3000),
    { enableHighAccuracy:true, timeout:10000 }
  );
}

/* Local fallback for plain "lat, lon" text when the parse API is unreachable. */
function parseLocalCoords(text) {
  const m = text.match(/(-?[0-9]+\\.[0-9]+)[,\\s]+(-?[0-9]+\\.[0-9]+)/);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lon: a };
  return { lat: a, lon: b };
}

async function parseUrl() {
  const input = document.getElementById('urlInput').value.trim();
  if (!input) return toast(t('paste_first'));
  toast(t('parsing'));
  try {
    const r = await fetch(PARSE_API + '?format=json&u=' + encodeURIComponent(input), { cache:'no-store' });
    const d = await r.json();
    if (d && typeof d.lat === 'number' && typeof d.lon === 'number') {
      moveTo(d.lat, d.lon, 15);
      toast(d.name ? (d.name + ' (' + d.lon.toFixed(4) + ', ' + d.lat.toFixed(4) + ')') : t('parsed', d.lon, d.lat));
      return;
    }
    throw new Error(d && d.error ? d.error : 'parse failed');
  } catch(e) {
    const local = parseLocalCoords(input);
    if (local) { moveTo(local.lat, local.lon, 15); toast(t('parsed', local.lon, local.lat)); return; }
    toast(t('parse_failed'), 3000);
  }
}

let searchResults = [];
async function searchPlace() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return toast(t('enter_place'));
  const box = document.getElementById('searchResults');
  box.innerHTML = '<div class="search-item">' + escHtml(t('searching')) + '<\\/div>';
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=6&q='+encodeURIComponent(q), { headers: { 'Accept-Language': (lang === 'zh' ? 'zh-CN' : 'en') } });
    searchResults = await r.json();
    if (!searchResults.length) { box.innerHTML = ''; toast(t('not_found', q), 3000); return; }
    box.innerHTML = searchResults.map(function(p, i){
      const name = p.display_name || '';
      return '<div class="search-item" onclick="selectSearchResult(' + i + ')">' +
        '<div class="si-name">' + escHtml(name.split(',')[0]) + '<\\/div>' +
        '<div class="si-sub">' + escHtml(name) + '<\\/div>' +
      '<\\/div>';
    }).join('');
  } catch(e) { box.innerHTML = ''; toast(t('search_failed'), 3000); }
}
function selectSearchResult(i) {
  const p = searchResults[i];
  if (!p) return;
  moveTo(parseFloat(p.lat), parseFloat(p.lon), 15);
  toast((p.display_name || '').slice(0, 40));
}
function restoreReal() {
  fetch(SAVE_API + '?action=clear', { method:'GET', mode:'cors', cache:'no-store' })
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        activeLon = null; activeLat = null; activeAcc = null; activeAlt = null;
        activeStatus = 'cleared'; savedLon = null;
        updateStatus(); renderActive(); renderFavs();
        toast(t('restored'), 30000);
      } else { toast(t('clear_failed_cfg'), 3000); }
    })
    .catch(() => toast(t('clear_failed_cfg'), 3000));
}

document.addEventListener('paste', e => {
  const text = (e.clipboardData||window.clipboardData).getData('text');
  if (text && (text.includes('map') || text.includes('loc') || text.includes('lnglat') || text.includes('baidu') || /[0-9]+\\.[0-9]+/.test(text))) {
    document.getElementById('urlInput').value = text;
    setTimeout(parseUrl, 200);
  }
});
document.getElementById('searchInput').addEventListener('keydown', e => { if(e.key==='Enter') searchPlace(); });
document.getElementById('urlInput').addEventListener('keydown', e => { if(e.key==='Enter') parseUrl(); });
document.getElementById('favNameInput').addEventListener('keydown', e => { if(e.key==='Enter') confirmFav(); });

/* ---- Watermark: tiled, non-interactive, rebuilt if tampered with ---- */
const WM_TEXT = 'YouTube：赛博工具人 @CyberHandyman 根据GitHub开源项目制作';
function buildWM() {
  let host = document.getElementById('wm');
  if (!host) { host = document.createElement('div'); host.id = 'wm'; host.className = 'wm'; host.setAttribute('aria-hidden','true'); document.body.appendChild(host); }
  host.className = 'wm'; host.removeAttribute('style');
  const n = Math.ceil((window.innerWidth * window.innerHeight) / 12000) + 40;
  let s = '';
  for (let i = 0; i < n; i++) s += '<span>' + WM_TEXT + '<\\/span>';
  host.innerHTML = '<div class="wm-i" id="wmi">' + s + '<\\/div>';
}
function ensureWM() {
  const host = document.getElementById('wm'), inner = document.getElementById('wmi');
  if (!host || !inner || inner.textContent.indexOf('CyberHandyman') < 0) { buildWM(); return; }
  const ch = getComputedStyle(host), ci = getComputedStyle(inner);
  if (ch.display === 'none' || ch.visibility === 'hidden' || ch.position !== 'fixed' || parseFloat(ci.opacity) < 0.03) {
    host.removeAttribute('style'); inner.removeAttribute('style'); buildWM();
  }
}
buildWM();
try { new MutationObserver(ensureWM).observe(document.body, { childList: true }); } catch(e) {}
setInterval(ensureWM, 1500);
window.addEventListener('resize', buildWM);

applyI18n();
queryActive();
<\/script>
</body>
</html>`;
}

/* ==== inlined from src/landing.js ==== */

function getLandingHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>iOS Location Spoofer · 虚拟定位</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0a0c11">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
:root{
  --bg:#0a0c11; --card:#12161d; --card2:#191e28; --line:#242b38;
  --cyan:#17c3cf; --cyan2:#0e97a1; --green:#22c55e; --green2:#159a45;
  --red:#ff5b60; --amber:#f5a623; --txt:#eef2f8; --muted:#8a93a5; --mono:#7fe3ea;
}
*{ margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
body{
  font-family:-apple-system,system-ui,"SF Pro","Helvetica Neue",sans-serif;
  color:var(--txt); line-height:1.5;
  background:
    radial-gradient(1100px 420px at 50% -140px, rgba(23,195,207,.16), transparent 70%),
    radial-gradient(700px 360px at 90% 8%, rgba(34,197,94,.08), transparent 65%),
    var(--bg);
  background-attachment:fixed;
}
.wrap{ max-width:600px; margin:0 auto; padding:20px 16px calc(44px + env(safe-area-inset-bottom)); }

/* --- top warning: red accent bar + tint --- */
.warn{ position:relative; background:linear-gradient(180deg,rgba(255,91,96,.16),rgba(255,91,96,.06)); border:1px solid rgba(255,91,96,.5); border-left:5px solid var(--red); border-radius:12px; padding:15px 18px; margin-bottom:12px; }
.warn .t{ color:#ff6b70; font-size:20px; font-weight:800; letter-spacing:.4px; line-height:1.4; }
.warn .b{ color:#ffdcdc; font-size:15.5px; font-weight:700; line-height:1.7; margin-top:9px; }

/* --- disclaimer --- */
.disc{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:13px 16px; margin-bottom:18px; }
.disc-t{ font-size:13px; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:var(--cyan); margin-bottom:9px; }
.disc-list{ margin:0; padding-left:17px; }
.disc-list li{ font-size:12px; color:var(--muted); line-height:1.75; margin-bottom:6px; }
.disc-list li b{ color:#c3ccdb; }

/* --- header / branding --- */
header{ text-align:center; padding:8px 0 6px; }
header .logowrap{ position:relative; width:74px; margin:0 auto 14px; }
header .logo{ width:74px; height:74px; border-radius:20px; display:block; box-shadow:0 0 0 1px var(--line),0 10px 30px rgba(23,195,207,.28); }
h1{ font-size:23px; font-weight:800; letter-spacing:.3px; background:linear-gradient(92deg,#eafcff,#7fe3ea 55%,#22c55e); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.ytline{ margin-top:13px; font-size:17.5px; font-weight:800; letter-spacing:.3px; line-height:1.5; }
.ytline .yt{ color:#ff6b70; text-decoration:none; text-shadow:0 0 18px rgba(255,91,96,.45); }
.credit{ font-size:12px; color:var(--muted); margin-top:9px; line-height:1.7; }
.credit a{ color:#8fe0e6; text-decoration:none; }

/* --- primary CTAs (green picker + video) --- */
.ctas{ display:flex; gap:10px; margin:18px 0 4px; }
.enter{ flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:17px 14px; border:none; border-radius:14px; font-size:16px; font-weight:800; cursor:pointer; text-decoration:none; transition:transform .12s,box-shadow .12s; }
.enter:active{ transform:scale(.97); }
.enter.go{ background:linear-gradient(135deg,#2ee06a,#129a44); color:#04240f; box-shadow:0 10px 26px rgba(34,197,94,.34); }
.enter.video{ background:transparent; color:#ff6b70; border:1.5px solid rgba(255,91,96,.6); flex:0 0 44%; }
.enter.video:active{ background:rgba(255,91,96,.1); }
.enter.tg{ width:100%; margin:10px 0 4px; background:transparent; color:#5cb8e8; border:1.5px solid rgba(42,171,238,.55); }
.enter.tg:active{ background:rgba(42,171,238,.12); }

.divider{ height:1px; background:linear-gradient(90deg,transparent,var(--line),transparent); margin:24px 0 20px; }

/* --- section heads with accent bar --- */
h2{ font-size:16px; font-weight:800; margin-bottom:4px; display:flex; align-items:center; gap:9px; }
h2::before{ content:""; width:4px; height:16px; border-radius:2px; background:linear-gradient(180deg,var(--cyan),var(--green)); }
.sub{ font-size:12.5px; color:var(--muted); margin:0 0 14px 13px; }
.note{ background:var(--card); border:1px solid var(--line); border-left:4px solid var(--cyan); border-radius:11px; padding:12px 14px; font-size:12.5px; color:#c3ccdb; margin-bottom:16px; }
.note b{ color:var(--txt); }

/* --- platform cards --- */
.plat{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px; margin-bottom:12px; }
.plat .big{ display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:14px; border:none; border-radius:11px; background:linear-gradient(135deg,var(--cyan),var(--cyan2)); color:#022a2d; font-size:15.5px; font-weight:800; cursor:pointer; text-align:center; text-decoration:none; transition:filter .12s,transform .12s; }
.plat .big:active{ filter:brightness(1.1); transform:scale(.98); }
.plat .line{ display:flex; align-items:center; gap:8px; margin-top:9px; }
.plat .url{ flex:1; min-width:0; font-family:"SF Mono",ui-monospace,monospace; font-size:11px; color:var(--muted); background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.plat .copy{ flex:none; padding:8px 15px; border:1px solid var(--line); border-radius:8px; background:var(--card2); color:var(--txt); font-size:12.5px; font-weight:600; cursor:pointer; transition:all .12s; }
.plat .copy:active{ background:#2a3140; }
.plat .copy.ok{ background:var(--green); border-color:var(--green); color:#04240f; }
.plat .pnote{ font-size:11.5px; color:var(--muted); margin-top:7px; line-height:1.6; }

/* --- info boxes --- */
.mitm{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:13px 15px; font-size:12.5px; color:#c3ccdb; margin-top:16px; }
.mitm b{ color:var(--txt); }
.mitm code{ display:inline-block; font-family:"SF Mono",ui-monospace,monospace; font-size:11.5px; color:var(--mono); word-break:break-all; line-height:2; }
.mitm .hosts{ margin-top:8px; padding:10px 12px; background:var(--bg); border:1px solid var(--line); border-radius:9px; }
.mitm .hosts code{ line-height:2.1; }

/* --- tiled diagonal watermark (continuous, self-restoring) --- */
.wm{ position:fixed; inset:0; z-index:90; pointer-events:none; overflow:hidden; user-select:none; -webkit-user-select:none; }
.wm-i{ position:absolute; inset:-60%; display:flex; flex-wrap:wrap; align-content:flex-start; transform:rotate(-24deg); opacity:.11; }
.wm-i span{ flex:none; padding:26px 30px; font-size:17.5px; font-weight:800; white-space:nowrap; color:#8fe0e6; letter-spacing:.4px; }

.toast{ position:fixed; left:50%; bottom:40px; transform:translateX(-50%) translateY(20px); background:rgba(8,10,14,.92); color:#fff; padding:11px 20px; border-radius:22px; font-size:14px; opacity:0; transition:all .25s; pointer-events:none; z-index:99; border:1px solid var(--line); }
.toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
footer{ text-align:center; font-size:11.5px; color:var(--muted); margin-top:26px; line-height:1.9; }
footer b{ color:#8fe0e6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="warn">
    <div class="t">⚠️ 免费开源项目 · 禁止售卖</div>
    <div class="b"><b>如果你是通过付款来到本页面，请立即联系退款。</b><br>任何售卖本项目 / 模块的都是骗子。一经发现立即删库，血本无归。</div>
  </div>
  <div class="disc">
    <div class="disc-t">免责声明</div>
    <ol class="disc-list">
      <li>本项目为免费开源工具，<b>仅供个人学习、研究与技术测试之用</b>，请勿用于任何违反所在国家/地区法律法规的用途。</li>
      <li>使用本项目（含模块、脚本、选点页）所引发的<b>一切风险与后果，由使用者自行承担</b>，与开源项目原作者、贡献者及本页面维护者无关。</li>
      <li>本项目与 <b>Apple Inc.</b> 无任何关联，不隶属、不代表 Apple，亦未获其授权或认可。</li>
      <li>本项目<b>不在中国大陆提供服务</b>。</li>
      <li>下载、安装或使用本项目，即视为你已阅读并同意本声明；如不同意，请立即停止使用。</li>
    </ol>
  </div>

  <header>
    <div class="logowrap"><img class="logo" src="/icon.svg" alt=""></div>
    <h1>iOS Location Spoofer · 虚拟定位</h1>
    <p class="ytline">📺 <a class="yt" href="https://www.youtube.com/@CyberHandyman/videos" target="_blank" rel="noopener">YouTube：CyberHandyman 赛博工具人</a></p>
    <p class="credit">
      fork from 鸣谢贡献者：<a href="https://github.com/Yu9191/wloc" target="_blank" rel="noopener">Yu9191</a> ·
      <a href="https://github.com/mekos2772/ios-location-spoofer" target="_blank" rel="noopener">mekos2772</a> ·
      <a href="https://github.com/acheong08/ios-location-spoofer" target="_blank" rel="noopener">acheong08</a>
    </p>
  </header>

  <div class="ctas">
    <a class="enter go" href="/picker">🗺️ 进入选点网页</a>
    <a class="enter video" href="https://youtu.be/EspuRlKWUxc" target="_blank" rel="noopener">▶️ 视频教程</a>
  </div>
  <a class="enter tg" href="https://t.me/cyberhandymancngroup" target="_blank" rel="noopener">✈️ 加入 Telegram 讨论群</a>

  <div class="divider"></div>

  <h2>安装模块</h2>
  <p class="sub">选你的代理客户端，点「一键导入」直接装；或「复制」手动添加。</p>
  <div class="note">📍 生效前提：① 代理 App 已连接（开关/引擎打开、<b>非「直连」模式</b>）；② 开启 HTTPS 解密(MITM) 并信任证书；③ 装好对应客户端的模块。之后打开选点页选位置、点「储存到设备」即可生效。iOS 26+ 切换后可能需重启一次设备清缓存。</div>

  <div id="plats"></div>

  <div class="mitm">
    <b>Quantumult X 资源解析器 URL（QX 一键导入 / 重写引用需先配好）：</b><br>
    <code>https://raw.githubusercontent.com/KOP-XIAO/QuantumultX/master/Scripts/resource-parser.js</code><br>
    添加方式 —— 把下面这段填进 QX 配置：<br>
    <code>[general]<br>#复制下面这些内容（另起一行）<br>resource_parser_url=https://raw.githubusercontent.com/KOP-XIAO/QuantumultX/master/Scripts/resource-parser.js</code>
  </div>
  <div class="mitm">
    <b>MITM 主机名（如全部配置成功仍不生效，在 MITM / HTTPS 解密中手动加入下面四个域名）：</b>
    <div class="hosts"><code>gs-loc.apple.com<br>gs-loc-cn.apple.com<br>bluedot.is.autonavi.com<br>bluedot.is.autonavi.com.gds.alibabadns.com</code></div>
  </div>

  <footer>
    坐标只存在你<b>当前设备</b>上，服务端不留存记录。<br>
    GNU AGPL-3.0 · 仅供学习研究
  </footer>
</div>
<div class="wm" id="wm" aria-hidden="true"><div class="wm-i" id="wmi"></div></div>
<div class="toast" id="toast"></div>
<script>
/* ---- Watermark: tiled, non-interactive, rebuilt if tampered with ---- */
var WM_TEXT = 'YouTube：赛博工具人 @CyberHandyman 根据GitHub开源项目制作';
function buildWM(){
  var host = document.getElementById('wm');
  if (!host){ host = document.createElement('div'); host.id = 'wm'; host.className = 'wm'; host.setAttribute('aria-hidden','true'); document.body.appendChild(host); }
  host.className = 'wm'; host.removeAttribute('style');
  var n = Math.ceil((window.innerWidth * window.innerHeight) / 12000) + 40;
  var s = '';
  for (var i = 0; i < n; i++) s += '<span>' + WM_TEXT + '</span>';
  host.innerHTML = '<div class="wm-i" id="wmi">' + s + '</div>';
}
function ensureWM(){
  var host = document.getElementById('wm'), inner = document.getElementById('wmi');
  if (!host || !inner || inner.textContent.indexOf('CyberHandyman') < 0) { buildWM(); return; }
  var ch = getComputedStyle(host), ci = getComputedStyle(inner);
  if (ch.display === 'none' || ch.visibility === 'hidden' || ch.position !== 'fixed' || parseFloat(ci.opacity) < 0.03) {
    host.removeAttribute('style'); inner.removeAttribute('style'); buildWM();
  }
}
buildWM();
try { new MutationObserver(ensureWM).observe(document.body, { childList:true }); } catch(e) {}
setInterval(ensureWM, 1500);
window.addEventListener('resize', buildWM);

var origin = location.origin;
function u(file){ return origin + '/' + file; }
var qxExtra = ', tag=iOS Location Spoofer, update-interval=172800, opt-parser=true, enabled=true';
var PLATS = [
  { name:'Surge', file:'ios-location-spoofer.sgmodule', scheme:function(x){ return 'surge:///install-module?url=' + encodeURIComponent(x); } },
  { name:'Shadowrocket', file:'ios-location-spoofer.sgmodule', scheme:function(x){ return 'shadowrocket://install?module=' + encodeURIComponent(x); } },
  { name:'Egern', file:'ios-location-spoofer.sgmodule', scheme:function(x){ return 'egern:///install-module?url=' + encodeURIComponent(x); } },
  { name:'Loon', file:'ios-location-spoofer.lnplugin', scheme:function(x){ return 'loon://import?plugin=' + encodeURIComponent(x); } },
  { name:'Stash', file:'ios-location-spoofer.stoverride', scheme:function(x){ return 'stash://install-override?url=' + encodeURIComponent(x); } },
  { name:'Quantumult X', file:'ios-location-spoofer.snippet',
    scheme:function(x){ return 'quantumult-x:///add-resource?remote-resource=' + encodeURIComponent(JSON.stringify({ rewrite_remote:[x + qxExtra] })); },
    note:'QX 没有模块面板：一键导入=添加「重写」资源(需已配资源解析器)；MITM 主机名要手动加进 设置→MITM。' }
];

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function toast(m){ var t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, 1800); }
function copyText(s){
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s);
  return new Promise(function(res,rej){ try{ var ta=document.createElement('textarea'); ta.value=s; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); var ok=document.execCommand('copy'); document.body.removeChild(ta); ok?res():rej(); }catch(e){ rej(e); } });
}
function doCopy(s, btn){ copyText(s).then(function(){ toast('已复制模块链接'); var o=btn.textContent; btn.classList.add('ok'); btn.textContent='✓'; setTimeout(function(){ btn.textContent=o; btn.classList.remove('ok'); }, 1200); }).catch(function(){ toast('复制失败，请手动选择'); }); }

var html = '';
for (var i=0; i<PLATS.length; i++){
  var p = PLATS[i];
  var url = u(p.file);
  html += '<div class="plat">' +
    '<a class="big" href="' + esc(p.scheme(url)) + '">一键导入 ' + esc(p.name) + '</a>' +
    '<div class="line"><span class="url">' + esc(url) + '</span>' +
    '<button class="copy" data-url="' + esc(url) + '">复制</button></div>' +
    (p.note ? '<div class="pnote">' + esc(p.note) + '</div>' : '') +
    '</div>';
}
document.getElementById('plats').innerHTML = html;
var btns = document.querySelectorAll('.copy');
for (var j=0; j<btns.length; j++){ (function(b){ b.addEventListener('click', function(){ doCopy(b.getAttribute('data-url'), b); }); })(btns[j]); }
<\/script>
</body>
</html>`;
}

/* ==== inlined from src/index.js (imports stripped, Hono shimmed) ==== */

const app = new Hono();

app.get("/", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.html(getLandingHtml());
});
app.get("/picker", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.html(getPageHtml());
});

/* ---- PWA: manifest + icons (enables "Add to Home Screen") ---- */
const MANIFEST = {
  name: "iOS Location Spoofer",
  short_name: "iOSLoc",
  description: "Stateless map picker for iOS Location Spoofer (WGS-84 + altitude).",
  start_url: "/picker",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f2f2f7",
  theme_color: "#007aff",
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-180.png", sizes: "180x180", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};
const IMG_CACHE = "public, max-age=604800, immutable";
app.get("/manifest.webmanifest", (c) =>
  c.body(JSON.stringify(MANIFEST), 200, { "Content-Type": "application/manifest+json", "Cache-Control": IMG_CACHE })
);
app.get("/icon.svg", (c) => c.body(ICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": IMG_CACHE }));
app.get("/icon-180.png", (c) => c.body(b64ToBytes(ICON_180_B64), 200, { "Content-Type": "image/png", "Cache-Control": IMG_CACHE }));
app.get("/icon-512.png", (c) => c.body(b64ToBytes(ICON_512_B64), 200, { "Content-Type": "image/png", "Cache-Control": IMG_CACHE }));
app.get("/favicon.ico", (c) => c.body(ICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": IMG_CACHE }));

/* ---- Self-hosted on-device module ----
   Serve the two module scripts + a subscribable manifest so the whole stateless
   setup runs from this worker with NO GitHub dependency. The manifest self-references
   whatever domain served it (workers.dev URL or a custom domain). */
const JS_HEADERS = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" };
app.get("/location-spoofer.js", (c) => c.body(b64ToBytes(LOCATION_SPOOFER_B64), 200, JS_HEADERS));
app.get("/location-settings.js", (c) => c.body(b64ToBytes(LOCATION_SETTINGS_B64), 200, JS_HEADERS));
app.get("/location-spoofer-qx.js", (c) => c.body(b64ToBytes(LOCATION_SPOOFER_QX_B64), 200, JS_HEADERS));

function sgmodule(origin) {
  return String.raw`#!name=iOS Location Spoofer (Stateless)
#!desc=任何售卖本项目/模块的都是骗子，请立即联系退款。无状态版：坐标写入每台设备各自的本机存储、可公开共用、多人互不覆盖。搭配选点页使用。适用于 Shadowrocket / Surge / Egern。
#!homepage=${origin}

[Script]
iOS Location Spoofer = type=http-response,pattern=^https?:\/\/(?:gs-loc(?:-cn)?\.apple\.com|bluedot\.is\.autonavi\.com(?:\.gds\.alibabadns\.com)?)\/clls\/wloc(?:\?.*)?$,requires-body=1,binary-body-mode=1,max-size=1048576,timeout=10,script-path=${origin}/location-spoofer.js,argument=mode=response&debug=false
iLS Settings = type=http-request,pattern=^https?:\/\/gs-loc(?:-cn)?\.apple\.com\/ils-settings\/,requires-body=0,max-size=0,timeout=10,script-path=${origin}/location-settings.js

[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com`;
}
function stoverride(origin) {
  return String.raw`name: iOS Location Spoofer (Stateless)
desc: "任何售卖本项目/模块的都是骗子，请立即联系退款。iOS Location Spoofer 无状态版 (Stash)"
homepage: ${origin}

http:
  mitm:
    - "gs-loc.apple.com"
    - "gs-loc-cn.apple.com"
  script:
    - match: ^https?:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc
      name: ios-location-spoofer
      type: response
      require-body: true
      binary-mode: true
      max-size: 0
      timeout: 30
      argument: mode=response&debug=false
    - match: ^https?:\/\/gs-loc(-cn)?\.apple\.com\/ils-settings\/
      name: ios-location-settings
      type: request
      require-body: false
      timeout: 10

script-providers:
  ios-location-spoofer:
    url: ${origin}/location-spoofer.js
    interval: 86400
  ios-location-settings:
    url: ${origin}/location-settings.js
    interval: 86400`;
}
function lnplugin(origin) {
  return String.raw`#!name=iOS Location Spoofer (Stateless)
#!desc=任何售卖本项目/模块的都是骗子，请立即联系退款。无状态版，配合选点页使用。Loon 插件。
#!homepage=${origin}

[Script]
http-response ^https?:\/\/(?:gs-loc(?:-cn)?\.apple\.com|bluedot\.is\.autonavi\.com(?:\.gds\.alibabadns\.com)?)\/clls\/wloc(?:\?.*)?$ script-path=${origin}/location-spoofer.js, requires-body=true, binary-body-mode=true, max-size=1048576, timeout=12, tag=iOS Location Spoofer, argument=mode=response&debug=false
http-request ^https?:\/\/gs-loc(?:-cn)?\.apple\.com\/ils-settings\/ script-path=${origin}/location-settings.js, requires-body=false, timeout=10, tag=iLS Settings

[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com`;
}
// Quantumult X has NO module/plugin system — it uses a "rewrite" reference. QX also does
// not auto-merge MITM hostnames the way Surge modules do, so the user must add them manually.
function qxsnippet(origin) {
  return String.raw`#!name=iOS Location Spoofer (Stateless)
#!desc=任何售卖本项目/模块的都是骗子，请立即联系退款。无状态版。Quantumult X 用「重写(rewrite)引用」(非模块/插件)。MITM 主机名需手动加进 QX 设置 → MITM。
#!homepage=${origin}

[rewrite_local]
^https?:\/\/(?:gs-loc(?:-cn)?\.apple\.com|bluedot\.is\.autonavi\.com(?:\.gds\.alibabadns\.com)?)\/clls\/wloc(?:\?.*)?$ url script-response-body ${origin}/location-spoofer-qx.js
^https?:\/\/gs-loc(?:-cn)?\.apple\.com\/ils-settings\/ url script-echo-response ${origin}/location-settings.js

[mitm]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com`;
}
const TXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" };
app.get("/ios-location-spoofer.sgmodule", (c) => c.body(sgmodule(new URL(c.req.url).origin), 200, TXT));
app.get("/ios-location-spoofer.stoverride", (c) => c.body(stoverride(new URL(c.req.url).origin), 200, TXT));
app.get("/ios-location-spoofer.lnplugin", (c) => c.body(lnplugin(new URL(c.req.url).origin), 200, TXT));
app.get("/ios-location-spoofer.snippet", (c) => c.body(qxsnippet(new URL(c.req.url).origin), 200, TXT));

// Map link parsing: called by the iOS Shortcut.
// GET /api/parse?u=<link>&format=json&cs=<gcj|none>
//   Returns {lat, lon, name}; Amap / Apple Maps (both GCJ-02 in mainland China) are auto-converted to WGS84; coordinates outside China are skipped automatically (out_of_china). cs=none forces no conversion.
//   Without format=json it returns a plain-text "lat=..&lon=.." fragment.
app.get("/api/parse", async (c) => {
  const raw = c.req.query("u") || "";
  const cs = (c.req.query("cs") || "").toLowerCase();
  const fmt = (c.req.query("format") || "").toLowerCase();
  try {
    let { lat, lon, name, src } = await parseCoords(raw);
    // Normalize every source to WGS-84 at the entrance (hard requirement):
    //   Baidu link => BD-09;  Amap / Apple / Google (mainland) => GCJ-02.
    // The GCJ/BD guards no-op outside China, so foreign coordinates pass through.
    if (cs !== "none") {
      if (src === "baidu" || cs === "bd09" || cs === "baidu") {
        ({ lat, lon } = bd09ToWgs84(lat, lon));
      } else if (cs === "gcj" || src === "amap" || src === "apple" || src === "google") {
        ({ lat, lon } = gcj02ToWgs84(lat, lon));
      }
    }
    lat = round6(lat);
    lon = round6(lon);
    name = name || "";
    c.header("Access-Control-Allow-Origin", "*");
    if (fmt === "json") return c.json({ lat, lon, name });
    return c.text(`lat=${lat}&lon=${lon}`);
  } catch (e) {
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ error: String(e && e.message ? e.message : e) }, 422);
  }
});

/* ---- Telegram bot webhook: a user sends /link (or /start) → the bot replies with the homepage link.
   One-time setup:
     1) @BotFather → 你的 bot (CyberHandymanMSG_bot) → 拿 API token
     2) 终端:  wrangler secret put TG_BOT_TOKEN            (粘贴 token)
     3) (可选) wrangler secret put TG_WEBHOOK_SECRET       (任意随机串，防伪造)
     4) 注册回调:  curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<origin>/tg&secret_token=<SECRET>"
     5) @BotFather → /setprivacy → 选该 bot → Disable      (这样它才能读到群里的 /link)
   Token 只存在 Cloudflare Secret 里，不写进代码。未配置时本路由静默返回 ok，不影响其它功能。 */
app.post("/tg", async (c) => {
  const secret = c.env && c.env.TG_WEBHOOK_SECRET;
  if (secret && c.req.header("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return c.text("forbidden", 403);
  }
  const token = c.env && c.env.TG_BOT_TOKEN;
  let update = null;
  try { update = await c.req.json(); } catch (e) {}
  const msg = update && (update.message || update.channel_post);
  const text = (msg && msg.text) || "";
  const chatId = msg && msg.chat && msg.chat.id;
  // Match /link, /links, /start — tolerate the /link@BotName form Telegram uses in groups.
  const cmd = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  if (token && chatId && (cmd === "/link" || cmd === "/links" || cmd === "/start")) {
    const origin = new URL(c.req.url).origin;
    const reply =
      "📍 iOS 虚拟定位 · 选点主页\n" + origin + "/\n\n" +
      "▶️ 视频教程：https://youtu.be/EspuRlKWUxc\n\n" +
      "⚠️ 免费开源，禁止售卖。若你是付款进来的，请立即联系退款——任何售卖者都是骗子。";
    await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply, disable_web_page_preview: false }),
    });
  }
  return c.text("ok", 200);
});

app.onError((e, c) => {
  console.error(`${e}`);
  return c.text(`${e}`, 500);
});

/* ---- Geo-restriction: block mainland China (CN); allow everywhere else ---- */
const BLOCK_HTML = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available in your region</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0f;color:#f2f2f7;font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:28px}div{max-width:520px}h1{font-size:20px;margin-bottom:14px}p{color:#9a9aa8;font-size:14px;line-height:1.8}</style></head><body><div><h1>本服务在你所在地区不可用</h1><p>This service is not available in your region.<br><br>本项目免费开源、禁止售卖；仅面向中国大陆以外地区提供访问。<br>This free & open-source project is not for sale, and is served only outside mainland China.</p></div></body></html>`;

export default {
  async fetch(request, env, ctx) {
    const country = request && request.cf && request.cf.country;
    let pathname = "/";
    try { pathname = new URL(request.url).pathname; } catch (e) {}
    // Telegram's webhook POST is a server-to-server call (non-CN anyway) — never geo-block /tg.
    if (country === "CN" && pathname !== "/tg") {
      return new Response(BLOCK_HTML, { status: 403, headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" } });
    }
    // Lightweight access log — stream it live with `wrangler tail` to spot resale / abuse.
    // (No IP logged; edge-cached static fetches won't appear here, but page loads will.)
    try {
      console.log("REQ " + JSON.stringify({
        country: country || "?",
        path: pathname,
        ref: request.headers.get("referer") || "",
        ua: (request.headers.get("user-agent") || "").slice(0, 90),
      }));
    } catch (e) {}
    return app.fetch(request, env, ctx);
  },
};