// 端到端：真起 MCP 进程，用一个假扩展代替 Chrome，检查协议、转发、抢主、安全和出错提示。
import { afterEach, expect, test } from "bun:test";
import type { Subprocess } from "bun";

const EXT_ID = "phicbodfdfifgoafgmicaappnckccpcf";
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
const SERVER = new URL("../src/server.ts", import.meta.url).pathname;
let port = 0;
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanup.splice(0)) c();
});

function freePort() {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const p = s.port;
  s.stop(true);
  return p;
}

// ---- 假数据（按 Discourse 真实返回的字段名，裁到最小）----
const FIX: Record<string, { status?: number; body: unknown }> = {
  "/session/current.json": { body: { current_user: { username: "demo_user", trust_level: 2, all_unread_notifications_count: 3 } } },
  "/categories.json?include_subcategories=true": {
    body: { category_list: { categories: [{ id: 4, name: "开发调优", slug: "develop", topic_count: 10, subcategory_list: [{ id: 40, name: "AI", slug: "ai", topic_count: 5 }] }] } },
  },
  "/search.json?q=claude%20code&page=1": {
    body: {
      posts: [{ id: 9, username: "alice", created_at: "2026-10-15T15:43:57Z", blurb: "用 &lt;Claude&gt; 写代码", post_number: 7, topic_id: 123, like_count: 2 }],
      topics: [{ id: 123, title: "Claude Code 心得", fancy_title: "Claude Code 心得", slug: "claude-code", category_id: 40, tags: [{ name: "AI" }], posts_count: 50 }],
      grouped_search_result: { more_full_page_results: true },
    },
  },
  "/t/123.json": {
    body: { id: 123, title: "Claude Code 心得", slug: "claude-code", posts_count: 150, views: 999, like_count: 30, category_id: 40, tags: ["AI"], created_at: "2026-10-01T00:00:00Z", details: { created_by: { username: "alice" } } },
  },
  "/raw/123?page=2": { body: "bob | 2026-10-02 01:02:03 UTC | #101\n\n第二页第一楼\n\n-------------------------\n\ncat | 2026-10-02 02:00:00 UTC | #102\n\n再一楼\n" },
  "/posts/by_number/123/7.json": {
    body: { id: 9, topic_id: 123, topic_slug: "claude-code", post_number: 7, username: "alice", created_at: "2026-10-15T15:43:57Z", raw: "楼层**原文**", reply_count: 1, actions_summary: [{ id: 2, count: 4 }] },
  },
  "/posts/9/replies.json": { body: [{ post_number: 8, username: "bob", created_at: "2026-10-15T16:00:00Z", cooked: "<p>同意</p>" }] },
  "/latest.json?page=0": { status: 403, body: "<html><title>Just a moment...</title>challenge-platform</html>" },
  // 一个求助帖：5 楼，楼主 alice，采纳了 #3（赞最少），#4 赞最多
  "/t/500.json": {
    body: { id: 500, title: "求助：怎么配代理", slug: "topic", posts_count: 5, views: 10, like_count: 3, created_at: "2026-10-01T00:00:00Z", details: { created_by: { username: "alice" } }, accepted_answers: [{ post_number: 3, username: "carol", cooked: "<p>改 DNS 就好</p>" }],
      post_stream: {
        stream: [5001, 5002, 5003, 5004, 5005],
        posts: [
          { id: 5001, post_number: 1, username: "alice", cooked: '<p>代理不通，见 <a href="/t/topic/9">这帖</a></p><pre><code>curl -v x\nexit 1</code></pre><div class="lightbox-wrapper"><a class="lightbox" href="/uploads/x.png"><img src="x"><div class="meta">image 1×1</div></a></div>', reaction_users_count: 0 },
          { id: 5002, post_number: 2, username: "bob", cooked: "<p>重启试试</p>", reaction_users_count: 2 },
        ],
      },
    },
  },
  "/t/500.json?filter=summary": {
    body: {
      post_stream: {
        stream: [5001, 5002, 5003, 5004, 5005],
        posts: [
          { id: 5001, post_number: 1, username: "alice", cooked: '<p>代理不通，见 <a href="/t/topic/9">这帖</a></p><pre><code>curl -v x\nexit 1</code></pre>', reaction_users_count: 0 },
          { id: 5002, post_number: 2, username: "bob", cooked: "<p>重启试试</p>", reaction_users_count: 2 },
        ],
      },
    },
  },
  "/t/500/posts.json?post_ids[]=5003&post_ids[]=5004&post_ids[]=5005": {
    body: {
      post_stream: {
        posts: [
          { id: 5003, post_number: 3, username: "carol", cooked: "<p>改 DNS 就好</p>", reaction_users_count: 1 },
          { id: 5004, post_number: 4, username: "alice", cooked: "<p>补充：换了节点也不行</p>", actions_summary: [{ id: 2, count: 10 }] },
          { id: 5005, post_number: 5, username: "dave", cooked: "<p>同问</p>", reaction_users_count: 5 },
        ],
      },
    },
  },
  "/t/500.json?username_filters=alice": {
    body: {
      post_stream: {
        stream: [5001, 5004],
        posts: [
          { id: 5001, post_number: 1, username: "alice", cooked: "<p>代理不通</p>" },
          { id: 5004, post_number: 4, username: "alice", cooked: "<p>补充：换了节点也不行</p>" },
        ],
      },
    },
  },
};

function fakeExt(onGet?: (path: string) => void) {
  let stopped = false;
  let ws: WebSocket | null = null;
  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(`ws://127.0.0.1:${port}/ext`, { headers: { Origin: EXT_ORIGIN } } as any);
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type !== "get") return;
      onGet?.(m.path);
      const f = FIX[m.path] ?? { status: 404, body: "not found" };
      const body = typeof f.body === "string" ? f.body : JSON.stringify(f.body);
      ws?.send(JSON.stringify({ type: "reply", id: m.id, status: f.status ?? 200, body }));
    };
    ws.onclose = () => setTimeout(connect, 100); // 和真扩展一样，断了就重连
  };
  connect();
  const stop = () => {
    stopped = true;
    ws?.close();
  };
  cleanup.push(stop);
  return { stop };
}

type Client = { call: (method: string, params?: unknown) => Promise<any>; tool: (name: string, args?: unknown) => Promise<{ text: string; isError?: boolean }>; proc: Subprocess };

async function startServer(extra: Record<string, string> = {}): Promise<Client> {
  const proc = Bun.spawn(["bun", SERVER], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, LINUXDO_BRIDGE_PORT: String(port), LINUXDO_EXT_WAIT_MS: "3000", ...extra },
  });
  cleanup.push(() => proc.kill());
  const waiting = new Map<number, (v: any) => void>();
  (async () => {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const m = JSON.parse(line);
        waiting.get(m.id)?.(m);
      }
    }
  })();
  let n = 0;
  const call = (method: string, params?: unknown) =>
    new Promise<any>((resolve) => {
      const id = ++n;
      waiting.set(id, resolve);
      (proc.stdin as any).write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      (proc.stdin as any).flush();
    });
  const tool = async (name: string, args: unknown = {}) => {
    const r = await call("tools/call", { name, arguments: args });
    return { text: r.result.content[0].text as string, isError: r.result.isError };
  };
  await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  return { call, tool, proc };
}

test("握手和工具列表", async () => {
  port = freePort();
  const c = await startServer();
  const init = await c.call("initialize", { protocolVersion: "2025-03-26" });
  expect(init.result.protocolVersion).toBe("2025-03-26");
  const list = await c.call("tools/list");
  const names = list.result.tools.map((t: any) => t.name);
  expect(names).toEqual(expect.arrayContaining(["search", "read_topic", "read_post", "latest", "top", "categories", "category_topics", "tags", "tag_topics", "user", "user_activity", "me", "notifications", "bookmarks", "get"]));
});

test("经假扩展：搜索、读帖翻页、读楼层、Cloudflare 提示", async () => {
  port = freePort();
  const c = await startServer();
  fakeExt();
  const s = await c.tool("search", { query: "claude code" });
  expect(s.text).toContain("https://linux.do/t/claude-code/123/7"); // 直达命中楼层
  expect(s.text).toContain("开发调优/AI");
  expect(s.text).toContain("用 <Claude> 写代码"); // HTML 实体被还原
  expect(s.text).toContain("page=2");

  const t = await c.tool("read_topic", { topic: "https://linux.do/t/claude-code/123/101" });
  expect(t.text).toContain("原文第 2/2 页");
  expect(t.text).toContain("第二页第一楼");
  expect(t.text).toContain("#101～#102，已到最后一页");

  const p = await c.tool("read_post", { topic: "https://linux.do/t/claude-code/123/7" });
  expect(p.text).toContain("楼层**原文**");
  expect(p.text).toContain("4 赞");
  expect(p.text).toContain("#8 @bob");

  const l = await c.tool("latest");
  expect(l.isError).toBe(true);
  expect(l.text).toContain("Cloudflare 要求验证");
});

test("读评论：高赞（采纳的排最前、再按赞数）、只看楼主、正文转成可读文字", async () => {
  port = freePort();
  const c = await startServer();
  fakeExt();
  const best = (await c.tool("read_topic", { topic: 500, view: "best" })).text;
  expect(best).toContain("✅ 已解决，楼主采纳了 #3 楼 @carol");
  const order = ["#3 @carol", "#4 @alice", "#5 @dave", "#2 @bob"].map((k) => best.indexOf(k));
  expect(order.every((x) => x > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(best).toContain("这帖（https://linux.do/t/topic/9）"); // 链接留下地址
  expect(best).toContain("```\ncurl -v x\nexit 1\n```"); // 代码块保留换行
  expect(best).not.toContain("uploads/x.png"); // 大图只留占位
  expect(best).toContain("从全部 5 楼里");

  const op = (await c.tool("read_topic", { topic: 500, view: "op" })).text;
  expect(op).toContain("补充：换了节点也不行");
  expect(op).not.toContain("@bob");
  expect(op).not.toContain("@dave");
});

test("第二个会话当从进程，主退出后接管", async () => {
  port = freePort();
  const a = await startServer();
  fakeExt();
  expect((await a.tool("me")).text).toContain("demo_user");
  const b = await startServer();
  expect((await b.tool("me")).text).toContain("demo_user"); // 经主转发
  a.proc.kill();
  await a.proc.exited;
  await Bun.sleep(1500); // 从进程抢端口、假扩展重连
  expect((await b.tool("me")).text).toContain("demo_user");
});

test("同一地址 2 分钟内不重复打 L 站，登录状态每次都实时取", async () => {
  port = freePort();
  const c = await startServer();
  const seen: string[] = [];
  fakeExt((p) => seen.push(p));
  await c.tool("search", { query: "claude code" });
  await c.tool("search", { query: "claude code" });
  expect(seen.filter((p) => p.startsWith("/search.json")).length).toBe(1);
  await c.tool("me");
  await c.tool("me");
  expect(seen.filter((p) => p === "/session/current.json").length).toBe(2);
});

test("扩展没连上时给出明确提示", async () => {
  port = freePort();
  const c = await startServer({ LINUXDO_EXT_WAIT_MS: "300" });
  const r = await c.tool("me");
  expect(r.isError).toBe(true);
  expect(r.text).toContain("linux.do MCP 桥");
});

test("网页和别的扩展连不上这根线", async () => {
  port = freePort();
  await startServer();
  let got = 0;
  fakeExt(() => got++);
  const tryOpen = (path: string, origin: string) =>
    new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Origin: origin } } as any);
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: "x", path: "/session/current.json" }));
        setTimeout(() => (ws.close(), resolve(true)), 300);
      };
      ws.onerror = () => resolve(false);
    });
  expect(await tryOpen("/peer", "https://evil.example")).toBe(false); // 网页脚本一定带 Origin
  expect(await tryOpen("/ext", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  expect(got).toBe(0);
});
