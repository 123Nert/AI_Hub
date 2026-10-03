/* AI 情报站 · 本地抓取服务（零依赖）
 * 提供页面与 /api/feeds 聚合接口：
 *  - RSS/Atom 源（含微信公众号，经 wechat2rss 桥接）
 *  - B站 UP主视频（直接调用 bilibili wbi 签名 API）
 * 每个源带 type(official/blogger) 与 lang(cn/en) 两个维度，供页面筛选。
 * 磁盘缓存 15 分钟，过期先回旧数据再后台刷新。
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const DIR = __dirname;
const INDEX = path.join(DIR, "index.html");
const CACHE_FILE = path.join(DIR, "aihub-cache.json");
const PORT_FILE = path.join(DIR, "port.txt");
const NODE_PATH_FILE = path.join(DIR, "node-path.txt");
const PORTS = [8437, 8438, 8439, 8440, 8441];
const TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/* kind: rss | bilibili | sohu   type: institution | media | blogger   lang: cn | en */
const SOURCES = [
  /* ---- 官方机构 · 中文 ---- */
  { key: "qbitai",      name: "量子位",          kind: "rss", type: "media", lang: "cn", url: "https://www.qbitai.com/feed" },
  { key: "jiqizhixin",  name: "机器之心·公众号", kind: "rss", type: "media", lang: "cn", url: "https://wechat2rss.xlab.app/feed/51e92aad2728acdd1fda7314be32b16639353001.xml" },
  { key: "xinzhiyuan",  name: "新智元·公众号",   kind: "rss", type: "media", lang: "cn", url: "https://wechat2rss.xlab.app/feed/ede30346413ea70dbef5d485ea5cbb95cca446e7.xml" },
  { key: "ifanr",       name: "爱范儿",          kind: "rss", type: "media", lang: "cn", url: "https://www.ifanr.com/feed" },
  { key: "ithome",      name: "IT之家",          kind: "rss", type: "media", lang: "cn", url: "https://www.ithome.com/rss" },
  { key: "sspai",       name: "少数派",          kind: "rss", type: "media", lang: "cn", url: "https://sspai.com/feed" },
  /* ---- 官方机构 · 英文 ---- */
  { key: "openai",      name: "OpenAI News",     kind: "rss", type: "institution", lang: "en", url: "https://openai.com/blog/rss.xml" },
  { key: "googleai",    name: "Google AI",       kind: "rss", type: "institution", lang: "en", url: "https://blog.google/technology/ai/rss/" },
  { key: "hfblog",      name: "Hugging Face Blog",kind: "rss", type: "institution", lang: "en", url: "https://huggingface.co/blog/feed.xml" },
  { key: "nvidia",      name: "NVIDIA GenAI",    kind: "rss", type: "institution", lang: "en", url: "https://developer.nvidia.com/blog/category/generative-ai/feed/" },
  { key: "deepmind",    name: "Google DeepMind", kind: "rss", type: "institution", lang: "en", url: "https://deepmind.google/blog/rss.xml" },
  /* ---- 官方媒体 · 英文 ---- */
  { key: "hn",          name: "Hacker News",     kind: "rss", type: "media", lang: "en", url: "https://hnrss.org/newest?q=AI+OR+LLM&count=30" },
  { key: "techcrunch",  name: "TechCrunch AI",   kind: "rss", type: "media", lang: "en", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { key: "verge",       name: "The Verge AI",    kind: "rss", type: "media", lang: "en", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  /* ---- 官方机构 · 中文公众号 ---- */
  { key: "jikegongyuan", name: "极客公园·公众号", kind: "rss", type: "media", lang: "cn", url: "https://wechat2rss.xlab.app/feed/1a5aec98e71c707c8ca092bc2c255b9d4bac477d.xml" },
  /* ---- 博主 · 中文（公众号 / 独立博客 / B站 UP主） ---- */
  { key: "xixiaoyao",   name: "夕小瑶科技说·公众号", kind: "rss", type: "blogger", lang: "cn", url: "https://wechat2rss.xlab.app/feed/a1cd365aa14ed7d64cabfc8aa086da40ecaba34d.xml" },
  { key: "appso",       name: "APPSO·公众号",       kind: "sohu", type: "media", lang: "cn", authorId: 602994 },
  { key: "guicang",     name: "歸藏的AI工具箱",      kind: "bilibili", type: "blogger", lang: "cn", mid: 1741797 },
  { key: "huasheng",    name: "AI进化论·花生",       kind: "bilibili", type: "blogger", lang: "cn", mid: 14097567 },
  { key: "laoshi",      name: "老石谈芯",            kind: "bilibili", type: "blogger", lang: "cn", mid: 612932327 },
  /* ---- 博主 · 英文 ---- */
  { key: "simonw",      name: "Simon Willison",  kind: "rss", type: "blogger", lang: "en", url: "https://simonwillison.net/atom/everything/" }
];

/* ---------- HTTP 抓取 ---------- */
function fetchUrl(url, headers = {}, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("http://") ? http : https;
    const req = mod.get(url, { headers: { "User-Agent": UA, "Accept": "*/*", ...headers }, timeout: 12000 }, (res) => {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).href, headers, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers["content-encoding"] || "").toLowerCase();
        try {
          if (enc === "gzip") buf = zlib.gunzipSync(buf);
          else if (enc === "deflate") buf = zlib.inflateSync(buf);
          else if (enc === "br") buf = zlib.brotliDecompressSync(buf);
        } catch {}
        resolve(buf.toString("utf8"));
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
function getJson(url, headers = {}) {
  return fetchUrl(url, headers).then((s) => JSON.parse(s));
}

/* ---------- 宽容的 RSS/Atom 解析 ---------- */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—", middot: "·" };
function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
          .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] || m);
}
function cleanText(raw, maxLen) {
  if (!raw) return "";
  // 先解码实体再剥标签，处理「被转义的整体 HTML」型摘要；两轮确保嵌套转义也被清干净
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let i = 0; i < 2; i++) {
    s = decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return maxLen && s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}
function extract(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + n + ">", "i"));
    if (m && m[1].trim()) return m[1];
  }
  return "";
}
function extractLink(block) {
  const text = extract(block, ["link"]);
  if (text) { const t = text.trim(); if (!t.startsWith("<")) return t; }
  const href = block.match(/<link\b[^>]*href="([^"]+)"/i);
  if (href) return href[1];
  const guid = block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
  return guid ? guid[1].trim() : "";
}

/* ---------- 条目配图提取 ---------- */
function normalizeImageUrl(u, base) {
  if (!u) return "";
  u = decodeEntities(u).trim();
  if (!u || /^(data|javascript):/i.test(u)) return "";
  if (u.startsWith("//")) u = "https:" + u;
  try { u = new URL(u, base || undefined).href; } catch { return ""; }
  return /^https?:\/\//i.test(u) ? u : "";
}
/* RSS 里 CDATA 正文可能是转义过的 HTML，原始块搜不到 <img；
 * 拼一份把 &lt;/&gt; 还原后的文本一起搜，两种写法都能命中 */
function extractImage(block, baseUrl) {
  const hay = block + "\n" + block.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const found = [];
  for (const tag of hay.match(/<enclosure\b[^>]*>/gi) || []) {
    const url = (tag.match(/\burl=["']([^"']+)["']/i) || [])[1];
    const type = (tag.match(/\btype=["']([^"']+)["']/i) || [])[1] || "";
    if (url && (/^image\//i.test(type) || /\.(jpe?g|png|webp|gif)([?#]|$)/i.test(url))) found.push(url);
  }
  for (const tag of hay.match(/<(?:media:content|media:thumbnail)\b[^>]*>/gi) || []) {
    const url = (tag.match(/\burl=["']([^"']+)["']/i) || [])[1];
    if (url) found.push(url);
  }
  const itunes = hay.match(/<itunes:image\b[^>]*\bhref=["']([^"']+)["']/i);
  if (itunes) found.push(itunes[1]);
  const img = hay.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (img) found.push(img[1]);
  for (const c of found) {
    const u = normalizeImageUrl(c, baseUrl);
    if (u) return u;
  }
  return "";
}
function parseFeed(xml) {
  const out = [];
  const items = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const it of items) {
    const title = cleanText(extract(it, ["title"]));
    const link = extractLink(it);
    if (!title || !link) continue;
    const dateStr = extract(it, ["pubDate", "published", "updated", "dc:date", "issued"]);
    let ts = dateStr ? Date.parse(dateStr.trim()) : NaN;
    if (isNaN(ts)) ts = 0;
    out.push({
      title, link, ts,
      snippet: cleanText(extract(it, ["description", "summary", "content:encoded", "content"]), 180),
      image: extractImage(it, link)
    });
    if (out.length >= 30) break;
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/* ---------- 搜狐号官方主页（微信公众号同步镜像） ----------
 * m.sohu.com/media/<authorId> 首屏内联了 20 篇文章的组件数据，
 * 每篇为 {"commentList":...,"title":...,"postTime":...,"id":...,"brief":...,"authorId":...,"url":...}
 */
function parseSohuAuthor(html, authorId) {
  const out = [];
  const re = /\{"commentList"[\s\S]*?"collectStatus":(?:true|false)\}/g;
  let m;
  while ((m = re.exec(html))) {
    let o;
    try { o = JSON.parse(m[0]); } catch { continue; }
    if (o.authorId !== authorId || !o.id || !o.title) continue;
    out.push({
      title: cleanText(o.title),
      link: `https://m.sohu.com/a/${o.id}_${authorId}`,
      ts: o.postTime || 0,
      snippet: cleanText(o.brief, 180),
      image: normalizeImageUrl(o.pic || o.img || "")
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/* ---------- B站 UP主视频（wbi 签名） ---------- */
const BILI_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
let biliCtx = null;   // { cookie, mixin, expire }

async function biliBootstrap() {
  if (biliCtx && Date.now() < biliCtx.expire) return biliCtx;
  const spi = await getJson("https://api.bilibili.com/x/frontend/finger/spi");
  const cookie = `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4}`;
  const nav = await getJson("https://api.bilibili.com/x/web-interface/nav", { Cookie: cookie });
  const imgKey = nav.data.wbi_img.img_url.replace(/^.*\/(\w+)\.png$/, "$1");
  const subKey = nav.data.wbi_img.sub_url.replace(/^.*\/(\w+)\.png$/, "$1");
  const mixin = BILI_TAB.map((i) => (imgKey + subKey)[i]).join("").slice(0, 32);
  biliCtx = { cookie, mixin, expire: Date.now() + 60 * 60 * 1000 };
  return biliCtx;
}
async function fetchBilibiliOnce(mid) {
  const ctx = await biliBootstrap();
  /* dm_img_* 为社区验证的 -352 风控绕过参数，需一并参与 wbi 签名 */
  const params = {
    mid, ps: 15, pn: 1,
    wts: Math.floor(Date.now() / 1000),
    dm_img_list: "[]",
    dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMy4wKQ",
    dm_cover_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMy4wKQ",
    dm_img_inter: '{"ds":[],"wh":[2940,1677,234],"of":[318,0,318]}'
  };
  const q = Object.keys(params).sort()
    .map((k) => `${k}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  const wrid = crypto.createHash("md5").update(q + ctx.mixin).digest("hex");
  const res = await getJson(`https://api.bilibili.com/x/space/wbi/arc/search?${q}&w_rid=${wrid}`, {
    Cookie: ctx.cookie, Referer: `https://space.bilibili.com/${mid}/`
  });
  if (res.code !== 0) throw new Error("bili " + res.code + " " + (res.message || ""));
  return (res.data?.list?.vlist || []).slice(0, 15).map((v) => ({
    title: cleanText(v.title),
    link: "https://www.bilibili.com/video/" + v.bvid,
    ts: v.created ? v.created * 1000 : 0,
    snippet: cleanText(v.description, 120) + (v.length ? ` [时长 ${v.length}]` : ""),
    image: v.pic ? (v.pic.startsWith("//") ? "https:" + v.pic : v.pic) : ""
  })).sort((a, b) => b.ts - a.ts);
}

/* B站风控：全局串行队列保证请求间隔 ≥1.5s；412/-352 时换新身份重试 */
let biliChain = Promise.resolve();
let biliLast = 0;
function fetchBilibili(mid) {
  const run = async () => {
    const gap = Date.now() - biliLast;
    if (gap < 2500) await new Promise((r) => setTimeout(r, 2500 - gap));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) { biliCtx = null; await new Promise((r) => setTimeout(r, 1500)); }
        biliLast = Date.now();
        return await fetchBilibiliOnce(mid);
      } catch (e) {
        const msg = String(e.message || e);
        const risky = /412|-352|-412/.test(msg);
        if (!risky || attempt === 2) throw e;
      }
    }
  };
  const p = biliChain.then(run, run);
  biliChain = p.catch(() => {});
  return p;
}

/* ---------- 缓存与刷新 ---------- */
let memCache = null;
let refreshing = null;

function readDiskCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (j && j.feeds) return j;
  } catch {}
  return null;
}
function writeDiskCache(c) {
  try {
    const tmp = CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(c));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {}
}
async function fetchSource(s) {
  if (s.kind === "bilibili") return fetchBilibili(s.mid);
  if (s.kind === "sohu") {
    const html = await fetchUrl(`https://m.sohu.com/media/${s.authorId}`);
    return parseSohuAuthor(html, s.authorId);
  }
  const xml = await fetchUrl(s.url);
  return parseFeed(xml);
}
async function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const feeds = {};
    await Promise.all(SOURCES.map(async (s) => {
      try {
        feeds[s.key] = { items: await fetchSource(s), error: null };
      } catch (e) {
        feeds[s.key] = { items: [], error: String(e.message || e) };
      }
    }));
    memCache = { ts: Date.now(), feeds };
    writeDiskCache(memCache);
    return memCache;
  })();
  try { return await refreshing; }
  finally { refreshing = null; }
}
async function getFeeds(force) {
  const fresh = memCache || readDiskCache();
  if (fresh) memCache = fresh;
  if (!force && fresh && Date.now() - fresh.ts < TTL) return { data: fresh, stale: false };
  if (fresh) {
    refreshAll().catch(() => {});
    return { data: fresh, stale: true };
  }
  const data = await refreshAll();
  return { data, stale: false };
}

/* ---------- HTTP 服务 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/ping") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("pong");
  }
  if (u.pathname === "/api/feeds") {
    const force = u.searchParams.get("force") === "1";
    try {
      const { data, stale } = await getFeeds(force);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ ts: data.ts, stale, sources: SOURCES, feeds: data.feeds }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  if (u.pathname === "/" || u.pathname === "/index.html") {
    try {
      const html = fs.readFileSync(INDEX);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      res.writeHead(500); return res.end("index.html missing");
    }
  }
  res.writeHead(404); res.end();
});

function listenOn(port) {
  return new Promise((ok) => {
    const s = server.listen(port, "127.0.0.1", () => ok(true));
    s.on("error", () => ok(false));
  });
}
(async () => {
  for (const p of PORTS) {
    if (await listenOn(p)) {
      fs.writeFileSync(PORT_FILE, String(p));
      try { fs.writeFileSync(NODE_PATH_FILE, process.execPath); } catch {}
      console.log("AI 情报站服务已启动: http://127.0.0.1:" + p + "/");
      return;
    }
  }
  console.error("所有端口均被占用");
  process.exit(1);
})();
