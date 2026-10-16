// linux.do MCP 桥：连上本机 MCP 服务（ws://127.0.0.1:47821/ext），
// 把它要的 linux.do 路径放进一个 linux.do 标签页里用 fetch 取回来。
// 只做 GET、只发往 https://linux.do，请求和你在页面里点开一样（同源、你的登录、你的网络）。

const BRIDGE = "ws://127.0.0.1:47821/ext";
const ORIGIN = "https://linux.do";
const MIN_GAP_MS = 1000; // 两次请求至少隔 1 秒：L 站最近自己就常限流（429），别再给它添压力

let ws = null;
let connecting = false;
let retryMs = 2000;
let keepalive = null;

function connect() {
  if (connecting || (ws && ws.readyState <= WebSocket.OPEN)) return;
  connecting = true;
  let s;
  try {
    s = new WebSocket(BRIDGE);
  } catch {
    connecting = false;
    return;
  }
  s.onopen = () => {
    connecting = false;
    ws = s;
    retryMs = 2000;
    s.send(JSON.stringify({ type: "hello", version: chrome.runtime.getManifest().version }));
    // 有消息往来，Chrome 就不会让后台休眠
    keepalive = setInterval(() => s.readyState === WebSocket.OPEN && s.send('{"type":"ping"}'), 20000);
  };
  s.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.type === "get") {
      enqueue(() => doGet(m.path, m.accept)).then((r) => {
        if (s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: "reply", id: m.id, ...r }));
      });
    }
  };
  s.onclose = () => {
    connecting = false;
    if (ws === s) ws = null;
    clearInterval(keepalive);
    // 没有 Claude 会话在跑时服务不存在，慢慢退避；闹钟每 30 秒也会再试
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  };
  s.onerror = () => {};
}

let chain = Promise.resolve();
let lastAt = 0;
function enqueue(task) {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await task();
    } finally {
      lastAt = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function doGet(path, accept) {
  let url;
  try {
    url = new URL(path, ORIGIN);
  } catch {
    return { status: 0, body: "", error: "路径不合法" };
  }
  if (url.origin !== ORIGIN || !String(path).startsWith("/")) {
    return { status: 0, body: "", error: "只允许访问 linux.do 的站内路径" };
  }
  try {
    const tabId = await workerTab();
    let r;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await pageFetch(tabId, url.pathname + url.search, accept);
      if (r.status === 429) {
        // 被限流：按 L 站给的时间等（最多 20 秒）再试一次
        if (attempt >= 1) return r; // 只等一次，还限流就如实报告，不硬撑
        await sleep(Math.min(Number(r.retryAfter) || 5, 20) * 1000);
        continue;
      }
      if (!isChallenge(r)) return r;
      if (attempt === 0) {
        await sleep(800); // 这个出口 IP 被 Cloudflare 随机抽查，常常再试一次就过
        continue;
      }
      // 还被拦：让工作标签页真正打开这个地址，浏览器会自己过验证，然后直接读页面内容
      const nav = await navigateAndRead(tabId, url.href);
      if (nav && !isChallenge(nav)) return nav;
    }
    return r;
  } catch (e) {
    return { status: 0, body: "", error: `扩展出错：${e?.message ?? e}` };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHALLENGE = /Just a moment|challenge-platform|cf-chl|cf_chl/i;
const isChallenge = (r) => (r.status === 403 || r.status === 503) && CHALLENGE.test(r.body);

async function pageFetch(tabId, p, accept) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (p, acc) => {
      try {
        const r = await fetch(p, {
          credentials: "same-origin",
          // 和 L 站网页自己的请求带一样的头（Discourse 前端每次都带）
          headers: {
            Accept: acc === "text" ? "text/plain, */*" : "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "Discourse-Present": "true",
            "Discourse-Logged-In": "true",
          },
        });
        return { status: r.status, body: await r.text(), retryAfter: r.headers.get("retry-after") };
      } catch (e) {
        return { status: 0, body: "", error: `页面里发请求失败：${e}` };
      }
    },
    args: [p, accept],
  });
  return res?.result ?? { status: 0, body: "", error: "页面没有返回结果" };
}

// 在工作标签页里打开地址；验证页会自己跑完并跳到真正的内容，最多等 20 秒
async function navigateAndRead(tabId, href) {
  await chrome.tabs.update(tabId, { url: href });
  await waitComplete(tabId).catch(() => {});
  for (let i = 0; i < 20; i++) {
    const [res] = await chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => ({
          title: document.title,
          text: document.querySelector("body > pre")?.textContent ?? document.body?.innerText ?? "",
        }),
      })
      .catch(() => [null]);
    const v = res?.result;
    if (v && !CHALLENGE.test(v.title) && !CHALLENGE.test(v.text.slice(0, 2000))) return { status: 200, body: v.text };
    await sleep(1000);
  }
  return null;
}

// 扩展自己的 L 站标签页：固定在标签栏最左边、不抢焦点。只在这里发请求和跳转，不碰你自己开的 L 站页面。
async function workerTab() {
  const { workerTabId } = await chrome.storage.session.get("workerTabId");
  if (workerTabId != null) {
    const t = await chrome.tabs.get(workerTabId).catch(() => null);
    if (t && !t.discarded && t.url?.startsWith(ORIGIN)) {
      if (t.status !== "complete") await waitComplete(t.id);
      return t.id;
    }
    if (t) await chrome.tabs.remove(t.id).catch(() => {});
  }
  const t = await chrome.tabs.create({ url: `${ORIGIN}/latest`, active: false, pinned: true });
  await chrome.storage.session.set({ workerTabId: t.id });
  await waitComplete(t.id);
  return t.id;
}

function waitComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("linux.do 标签页 30 秒没加载完"));
    }, 30000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") listener(tabId, { status: "complete" });
    });
  });
}

chrome.alarms.create("reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
