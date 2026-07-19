export function getLandingHtml() {
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
