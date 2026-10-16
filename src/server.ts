#!/usr/bin/env bun
// linux.do 的 MCP 服务。手写 MCP stdio 协议（一行一条 JSON-RPC），不依赖任何库。
// 真正去 L 站取数据的是你 Chrome 里的「linux.do MCP 桥」扩展，见 bridge.ts。

import { createInterface } from "node:readline";
import { ensureBridge } from "./bridge";
import * as ld from "./linuxdo";

const VERSION = "0.3.0";
const KNOWN_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];

type Tool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (a: any) => Promise<string>;
};

const str = (description: string) => ({ type: "string", description });
const int = (description: string, dflt?: number) => ({ type: "integer", description, ...(dflt != null ? { default: dflt } : {}) });
const topicArg = { type: ["string", "integer"], description: "帖子编号，或 linux.do/t/... 链接（链接里带楼号也行）" };

const TOOLS: Tool[] = [
  {
    name: "search",
    description:
      "全站搜索 linux.do。query 支持 Discourse 高级语法：order:latest / order:likes、#分类slug、tags:标签、@用户、in:title、after:2026-01-01、status:solved 等。每条结果给出帖子链接（直达命中楼层）、作者、时间、摘要。",
    inputSchema: { type: "object", properties: { query: str("搜索词，可带高级语法"), page: int("页码，从 1 开始", 1) }, required: ["query"] },
    run: (a) => ld.search(a.query, a.page ?? 1),
  },
  {
    name: "read_topic",
    description:
      "读帖子和下面的评论。已解决的帖子开头会标出楼主采纳的答案。view 选读法：all（默认）按楼号读原文，一页最多 100 楼，长帖按末尾提示翻页，链接里带楼号会自动跳到那一页；best 是 1 楼原帖加按赞数排序的高赞评论（求助、提问、踩坑帖先用这个看大家给的解决办法）；op 是 1 楼加楼主后续的所有发言（看楼主补充的结果或「已解决」）。某一楼的全文和它下面的回复用 read_post。",
    inputSchema: {
      type: "object",
      properties: {
        topic: topicArg,
        view: { type: "string", enum: ["all", "best", "op"], description: "all 按楼号读原文；best 高赞评论；op 只看楼主", default: "all" },
        page: int("view=all 时的原文页码，每页 100 楼；不填按链接里的楼号或从第 1 页开始"),
        limit: int("view=best/op 时最多给几楼", 15),
        max_chars: int("最多返回多少字", 60000),
      },
      required: ["topic"],
    },
    run: (a) => ld.readTopic(a.topic, a.page, a.max_chars ?? 60000, a.view ?? "all", a.limit ?? 15),
  },
  {
    name: "read_post",
    description: "读某一楼的完整原文，以及别人对这一楼的直接回复。",
    inputSchema: { type: "object", properties: { topic: topicArg, floor: int("楼号；链接里带了就不用填") }, required: ["topic"] },
    run: (a) => ld.readPost(a.topic, a.floor),
  },
  {
    name: "latest",
    description: "首页「最新」话题列表（每页约 30 个）。",
    inputSchema: {
      type: "object",
      properties: { page: int("页码，从 0 开始", 0), order: str("可选排序：activity / created / posts / views / likes") },
    },
    run: (a) => ld.latest(a.page ?? 0, a.order),
  },
  {
    name: "top",
    description: "「热门」话题。period：daily / weekly / monthly / quarterly / yearly / all。",
    inputSchema: { type: "object", properties: { period: str("时间范围，默认 weekly"), page: int("页码，从 0 开始", 0) } },
    run: (a) => ld.top(a.period ?? "weekly", a.page ?? 0),
  },
  {
    name: "categories",
    description: "列出所有分类和子分类（名称、id、slug、话题数）。",
    inputSchema: { type: "object", properties: {} },
    run: () => ld.listCategories(),
  },
  {
    name: "category_topics",
    description: "某个分类下的话题列表。category 可以填 id、slug 或名称。",
    inputSchema: { type: "object", properties: { category: { type: ["string", "integer"], description: "分类 id、slug 或名称" }, page: int("页码，从 0 开始", 0) }, required: ["category"] },
    run: (a) => ld.categoryTopics(a.category, a.page ?? 0),
  },
  {
    name: "tags",
    description: "列出标签和各自话题数（按热度排序）。可用 filter 只看包含某个词的标签。",
    inputSchema: { type: "object", properties: { filter: str("只看名字里含这个词的标签"), limit: int("最多显示几个", 80) } },
    run: (a) => ld.listTags(a.filter, a.limit ?? 80),
  },
  {
    name: "tag_topics",
    description: "某个标签下的话题列表。",
    inputSchema: { type: "object", properties: { tag: str("标签名"), page: int("页码，从 0 开始", 0) }, required: ["tag"] },
    run: (a) => ld.tagTopics(a.tag, a.page ?? 0),
  },
  {
    name: "user",
    description: "某个用户的资料：信任等级、头衔、注册和在线时间、发帖/获赞统计、热门话题和热门回复。",
    inputSchema: { type: "object", properties: { username: str("用户名（不带 @ 也行）") }, required: ["username"] },
    run: (a) => ld.user(a.username),
  },
  {
    name: "user_activity",
    description: "某个用户最近的动态。kind：all（发帖+回复）/ topics / replies / likes。",
    inputSchema: {
      type: "object",
      properties: { username: str("用户名"), kind: str("all / topics / replies / likes，默认 all"), page: int("页码，从 0 开始，每页 30 条", 0) },
      required: ["username"],
    },
    run: (a) => ld.userActivity(a.username, a.kind ?? "all", a.page ?? 0),
  },
  {
    name: "me",
    description: "当前在 Chrome 里登录的 L 站账号、信任等级、未读通知和私信数。也可用来检查桥是否通。",
    inputSchema: { type: "object", properties: {} },
    run: () => ld.me(),
  },
  {
    name: "notifications",
    description: "我的最近通知（谁回复、提到、赞了我，私信等），标出未读。",
    inputSchema: { type: "object", properties: { limit: int("条数", 30) } },
    run: (a) => ld.notifications(a.limit ?? 30),
  },
  {
    name: "bookmarks",
    description: "我在 L 站收藏的书签。",
    inputSchema: { type: "object", properties: { page: int("页码，从 0 开始", 0) } },
    run: (a) => ld.bookmarks(a.page ?? 0),
  },
  {
    name: "get",
    description:
      "兜底：只读 GET 任意 linux.do 站内路径，返回原始 JSON（/raw/... 返回原文）。上面的工具不够用时再用，例如 /t/123.json、/u/xxx/summary.json、/topics/private-messages/我的用户名.json。",
    inputSchema: { type: "object", properties: { path: str("以 / 开头的站内路径"), max_chars: int("最多返回多少字", 20000) }, required: ["path"] },
    run: (a) => ld.rawGet(a.path, a.max_chars ?? 20000),
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

function send(msg: unknown) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(m: any) {
  const { id, method, params } = m;
  const isRequest = id !== undefined && id !== null;
  const reply = (result: unknown) => isRequest && send({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => isRequest && send({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      reply({
        protocolVersion: KNOWN_PROTOCOLS.includes(asked) ? asked : KNOWN_PROTOCOLS.at(-1),
        capabilities: { tools: {} },
        serverInfo: { name: "linuxdo", version: VERSION },
        instructions:
          "linux.do（L 站）只读工具。数据经用户 Chrome 里的扩展取得，用的是用户自己的登录。找内容先 search，读帖用 read_topic；请求间别连发太猛。",
      });
      return;
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = byName.get(params?.name);
      if (!tool) return fail(-32602, `没有这个工具：${params?.name}`);
      try {
        const text = await tool.run(params?.arguments ?? {});
        return reply({ content: [{ type: "text", text }] });
      } catch (e: any) {
        return reply({ content: [{ type: "text", text: `出错：${e?.message ?? e}` }], isError: true });
      }
    }
    default:
      if (method?.startsWith("notifications/")) return;
      return fail(-32601, `不支持的方法：${method}`);
  }
}

function serve() {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON 解析失败" } });
    }
    handle(m).catch((e) => console.error("[linuxdo]", e));
  });
  rl.on("close", () => process.exit(0));

  // 一启动就把桥搭好，扩展可以在第一次调用前就连上
  ensureBridge().catch((e) => console.error("[linuxdo] 桥没搭起来：", e?.message ?? e));
}

// 不带参数：作为 MCP 服务运行（AI 工具会这样启动它）。setup / check / version 给人在终端里用。
const cmd = process.argv[2];
if (!cmd) serve();
else {
  const { runCommand } = await import("./setup");
  process.exit(await runCommand(cmd, VERSION));
}
