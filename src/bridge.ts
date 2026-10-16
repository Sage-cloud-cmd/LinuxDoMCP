// 本机桥：MCP 服务和 Chrome 扩展之间的那根线。
//
// 每个 Claude 会话都会各起一个 MCP 进程，但扩展只连一个端口，所以：
// 抢到端口的进程当「主」（hub），扩展连它；其余进程当「从」（peer），把请求交给主转发。
// 主退出后，从会重新抢端口，扩展几秒内会连上新的主。
//
// 安全：只监听 127.0.0.1。/ext 只接受本扩展的 Origin；/peer 拒绝任何带 Origin 的连接，
// 网页里的脚本连本机 WebSocket 一定会带 Origin，所以网页无法借这根线读你的 L 站。

import type { ServerWebSocket } from "bun";

export const PORT = Number(process.env.LINUXDO_BRIDGE_PORT ?? 47821);
export const EXT_ORIGIN = `chrome-extension://${process.env.LINUXDO_EXT_ID ?? "phicbodfdfifgoafgmicaappnckccpcf"}`;

const EXT_WAIT_MS = Number(process.env.LINUXDO_EXT_WAIT_MS ?? 35_000); // 扩展后台可能在睡，闹钟 30 秒内会叫醒它
const REPLY_TIMEOUT_MS = 90_000;

export type Accept = "json" | "text";
export type Reply = { status: number; body: string; error?: string };

type Sock = ServerWebSocket<{ kind: "ext" | "peer" }>;
type Pending = { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> };

export const NO_EXT =
  "Chrome 里的「linux.do MCP 桥」扩展没连上。请确认：Chrome 开着、扩展已启用（chrome://extensions）。刚打开 Chrome 的话等半分钟再试。";

let role: "none" | "hub" | "peer" = "none";
let ext: Sock | null = null;
let peerSock: WebSocket | null = null;
let seq = 0;
const pending = new Map<string, Pending>();
let extWaiters: (() => void)[] = [];

export function currentRole() {
  return role;
}

function settle(id: string, r: Reply) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(r);
}

function track(id: string, send: () => void): Promise<Reply> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => settle(id, { status: 0, body: "", error: "Chrome 扩展 90 秒没回应，可能 linux.do 页面卡住了，刷新一下那个标签页再试。" }),
      REPLY_TIMEOUT_MS,
    );
    pending.set(id, { resolve, timer });
    send();
  });
}

function waitExt(ms: number): Promise<boolean> {
  if (ext) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      extWaiters = extWaiters.filter((w) => w !== done);
      resolve(false);
    }, ms);
    extWaiters.push(done);
  });
}

async function hubRequest(path: string, accept: Accept): Promise<Reply> {
  if (!(await waitExt(EXT_WAIT_MS)) || !ext) return { status: 0, body: "", error: NO_EXT };
  const id = `h${++seq}`;
  const sock = ext;
  return track(id, () => sock.send(JSON.stringify({ type: "get", id, path, accept })));
}

function startHub() {
  Bun.serve<{ kind: "ext" | "peer" }, never>({
    hostname: "127.0.0.1",
    port: PORT,
    fetch(req, server) {
      const { pathname } = new URL(req.url);
      const origin = req.headers.get("origin");
      if (pathname === "/ext" && origin === EXT_ORIGIN && server.upgrade(req, { data: { kind: "ext" } })) return;
      if (pathname === "/peer" && !origin && server.upgrade(req, { data: { kind: "peer" } })) return;
      return new Response("forbidden", { status: 403 });
    },
    websocket: {
      open(ws) {
        if (ws.data.kind !== "ext") return;
        if (ext && ext !== ws) ext.close();
        ext = ws;
        const ws_ = extWaiters;
        extWaiters = [];
        for (const w of ws_) w();
      },
      message(ws, raw) {
        let m: any;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (ws.data.kind === "ext") {
          if (m.type === "reply" && typeof m.id === "string") {
            settle(m.id, { status: Number(m.status) || 0, body: String(m.body ?? ""), error: m.error });
          }
          return;
        }
        // 从进程发来的请求：转给扩展，回答原样带回
        if (typeof m.id === "string" && typeof m.path === "string") {
          hubRequest(m.path, m.accept === "text" ? "text" : "json").then((r) => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ id: m.id, ...r }));
          });
        }
      },
      close(ws) {
        if (ws === ext) ext = null;
      },
    },
  });
  role = "hub";
}

function connectPeer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}/peer`);
    let opened = false;
    s.onopen = () => {
      opened = true;
      peerSock = s;
      role = "peer";
      resolve();
    };
    s.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (typeof m.id === "string") settle(m.id, { status: Number(m.status) || 0, body: String(m.body ?? ""), error: m.error });
      } catch {}
    };
    s.onclose = () => {
      if (peerSock === s) {
        peerSock = null;
        role = "none";
        // 主走了：手上没回的请求作废，然后去抢端口当新的主，扩展才有地方连
        for (const id of [...pending.keys()]) if (id.startsWith("p")) settle(id, { status: 0, body: "", error: "转发的会话刚退出了，请重试一次。" });
        setTimeout(() => ensureBridge().catch(() => {}), 200 + Math.random() * 500);
      }
      if (!opened) reject(new Error("连不上本机桥"));
    };
  });
}

let ensuring: Promise<void> | null = null;
export function ensureBridge(): Promise<void> {
  if (role === "hub") return Promise.resolve();
  if (role === "peer" && peerSock?.readyState === WebSocket.OPEN) return Promise.resolve();
  ensuring ??= (async () => {
    try {
      startHub();
    } catch {
      await connectPeer(); // 端口已被别的会话占着
    }
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export async function request(path: string, accept: Accept): Promise<Reply> {
  await ensureBridge();
  if (role === "hub") return hubRequest(path, accept);
  const id = `p${++seq}`;
  const sock = peerSock!;
  return track(id, () => sock.send(JSON.stringify({ id, path, accept })));
}
