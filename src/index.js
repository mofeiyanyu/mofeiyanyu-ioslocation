import { Hono } from "hono/tiny";
import { getPageHtml } from "./page.js";
import { getLandingHtml } from "./landing.js";
import { parseCoords, gcj02ToWgs84, bd09ToWgs84, round6 } from "./parse.js";
import { ICON_180_B64, ICON_512_B64, ICON_SVG, b64ToBytes } from "./icons.js";
import { LOCATION_SPOOFER_B64, LOCATION_SETTINGS_B64, LOCATION_SPOOFER_QX_B64 } from "./modules.js";

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
