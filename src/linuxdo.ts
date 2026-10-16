// 取 linux.do 的数据，并整理成给模型读的文字。只读：全部是 GET。

import { type Accept, request } from "./bridge";

export const BASE = "https://linux.do";

// L 站最近自己常限流：同一地址 2 分钟内直接用上次的结果，少打一次是一次。登录状态和通知要实时，不缓存。
const CACHE_MS = 120_000;
const NO_CACHE = /^\/(session|notifications)/;
const cache = new Map<string, { at: number; value: any }>();

export async function get(path: string, accept: Accept = "json"): Promise<any> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("路径必须是 linux.do 的站内路径，以 / 开头");
  const key = `${accept} ${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fetchOnce(path, accept);
  if (!NO_CACHE.test(path)) {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return value;
}

async function fetchOnce(path: string, accept: Accept): Promise<any> {
  const r = await request(path, accept);
  if (r.error) throw new Error(r.error);
  const b = r.body;
  if ((r.status === 403 || r.status === 503) && /Just a moment|challenge-platform|cf-chl/i.test(b)) {
    throw new Error("Cloudflare 要求验证：在 Chrome 里打开 https://linux.do ，等验证通过后再试。");
  }
  if (r.status === 429) throw new Error("L 站在限流（429）。它最近自己就常这样，过一两分钟再试。");
  if (r.status === 404) throw new Error(`没找到（404）：${path}。可能不存在、已删除，或你的信任等级看不到。`);
  if (r.status === 403) throw new Error(`没有权限（403）：${path}。可能 Chrome 里没登录 L 站，或需要更高信任等级。`);
  if (r.status !== 200) throw new Error(`L 站返回 HTTP ${r.status}：${b.slice(0, 200)}`);
  if (accept === "text") return b;
  try {
    return JSON.parse(b);
  } catch {
    throw new Error(`L 站返回的不是 JSON（可能 Chrome 里的 L 站页面需要重新登录）：${b.slice(0, 120)}`);
  }
}

// ---------- 小工具 ----------

const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–",
};
export function text(html?: string | null): string {
  return (html ?? "")
    .replace(/<img[^>]*class="emoji[^"]*"[^>]*alt="([^"]*)"[^>]*>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();
}

const fmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
export function time(iso?: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : fmt.format(d);
}

export const topicUrl = (slug: string | undefined, id: number, floor?: number) =>
  `${BASE}/t/${slug || "topic"}/${id}${floor && floor > 1 ? `/${floor}` : ""}`;

const tagName = (t: any) => (typeof t === "string" ? t : (t?.name ?? t?.text ?? ""));
const tagList = (tags: any[] | undefined) => (tags?.length ? tags.map((t) => `#${tagName(t)}`).join(" ") : "");

/** 帖子编号或链接 → { id, floor }。支持 123、/t/slug/123、https://linux.do/t/slug/123/45 */
export function parseTopic(input: string | number): { id: number; floor?: number } {
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return { id: Number(s) };
  const m = s.match(/\/t\/(?:[^/?#]+\/)?(\d+)(?:\/(\d+))?/);
  if (!m) throw new Error(`认不出帖子：${s}。给帖子编号或 linux.do/t/... 链接。`);
  return { id: Number(m[1]), floor: m[2] ? Number(m[2]) : undefined };
}

// ---------- 分类 ----------

type Cat = { id: number; name: string; slug: string; parent?: number; topics?: number; posts?: number; desc?: string };
let cats: { at: number; byId: Map<number, Cat> } | null = null;

export async function categories(): Promise<Map<number, Cat>> {
  if (cats && Date.now() - cats.at < 3600_000) return cats.byId;
  const j = await get("/categories.json?include_subcategories=true");
  const byId = new Map<number, Cat>();
  const add = (c: any, parent?: number) => {
    byId.set(c.id, {
      id: c.id, name: c.name, slug: c.slug, parent: parent ?? c.parent_category_id ?? undefined,
      topics: c.topic_count, posts: c.post_count, desc: c.description_text,
    });
    for (const s of c.subcategory_list ?? []) add(s, c.id);
  };
  for (const c of j.category_list?.categories ?? []) add(c);
  cats = { at: Date.now(), byId };
  return byId;
}

async function catName(id?: number): Promise<string> {
  if (!id) return "";
  const m = await categories().catch(() => new Map<number, Cat>());
  const c = m.get(id);
  if (!c) return `分类${id}`;
  const p = c.parent ? m.get(c.parent) : undefined;
  return p ? `${p.name}/${c.name}` : c.name;
}

async function findCategory(q: string | number): Promise<Cat & { path: string }> {
  const m = await categories();
  const s = String(q).trim().toLowerCase();
  const c =
    m.get(Number(s)) ??
    [...m.values()].find((c) => c.slug.toLowerCase() === s || c.name.toLowerCase() === s) ??
    [...m.values()].find((c) => c.name.toLowerCase().includes(s));
  if (!c) throw new Error(`没有叫「${q}」的分类。先用 categories 看看有哪些。`);
  const p = c.parent ? m.get(c.parent) : undefined;
  return { ...c, path: p ? `${p.slug}/${c.slug}/${c.id}` : `${c.slug}/${c.id}` };
}

// ---------- 话题列表 ----------

async function topicList(j: any, title: string, nextHint: string): Promise<string> {
  const topics: any[] = j.topic_list?.topics ?? [];
  if (!topics.length) return `${title}\n\n（这一页没有内容）`;
  const lines = [title, ""];
  let i = 0;
  for (const t of topics) {
    const meta = [
      await catName(t.category_id),
      tagList(t.tags),
      `${Math.max(0, (t.posts_count ?? 1) - 1)} 回复`,
      t.views != null ? `${t.views} 浏览` : "",
      t.like_count != null ? `${t.like_count} 赞` : "",
      `最后回复 ${time(t.last_posted_at ?? t.bumped_at)}`,
    ].filter(Boolean);
    lines.push(`${++i}. ${t.pinned ? "[置顶] " : ""}${text(t.fancy_title ?? t.title)}`);
    lines.push(`   ${topicUrl(t.slug, t.id)}`);
    lines.push(`   ${meta.join(" · ")}`);
    if (t.excerpt) lines.push(`   ${text(t.excerpt).slice(0, 160)}`);
  }
  if (j.topic_list?.more_topics_url) lines.push("", nextHint);
  return lines.join("\n");
}

// ---------- 工具实现 ----------

export async function me(): Promise<string> {
  const u = (await get("/session/current.json")).current_user;
  if (!u) throw new Error("Chrome 里没有登录 linux.do。");
  return [
    `已登录：${u.username}${u.name ? `（${u.name}）` : ""}，信任等级 ${u.trust_level}`,
    `未读通知 ${u.all_unread_notifications_count ?? u.unread_notifications ?? "?"} 条，未读私信 ${u.new_personal_messages_notifications_count ?? "?"} 条`,
  ].join("\n");
}

let myName: string | null = null;
async function myUsername(): Promise<string> {
  if (myName) return myName;
  const u = (await get("/session/current.json")).current_user;
  if (!u) throw new Error("Chrome 里没有登录 linux.do。");
  myName = u.username as string;
  return myName;
}

export async function search(query: string, page = 1): Promise<string> {
  const j = await get(`/search.json?q=${encodeURIComponent(query)}&page=${page}`);
  const topics = new Map<number, any>((j.topics ?? []).map((t: any) => [t.id, t]));
  const posts: any[] = j.posts ?? [];
  if (!posts.length) return `搜索「${query}」第 ${page} 页：没有结果。`;
  const lines = [`搜索「${query}」第 ${page} 页，${posts.length} 条：`, ""];
  let i = 0;
  for (const p of posts) {
    const t = topics.get(p.topic_id) ?? {};
    const meta = [
      await catName(t.category_id), tagList(t.tags), `@${p.username}`, time(p.created_at),
      `#${p.post_number} 楼`, t.posts_count ? `全帖 ${t.posts_count} 楼` : "", p.like_count ? `${p.like_count} 赞` : "",
    ].filter(Boolean);
    lines.push(`${++i}. ${text(t.fancy_title ?? t.title ?? p.topic_title_headline)}`);
    lines.push(`   ${topicUrl(t.slug, p.topic_id, p.post_number)}`);
    lines.push(`   ${meta.join(" · ")}`);
    if (p.blurb) lines.push(`   ${text(p.blurb)}`);
  }
  if (j.grouped_search_result?.more_full_page_results) lines.push("", `还有更多：search(query, page=${page + 1})`);
  return lines.join("\n");
}

const PER_RAW_PAGE = 100; // /raw/{id} 每页 100 楼

export type TopicView = "all" | "best" | "op";

/** 帖子正文 HTML → 可读文字：保留段落、列表、代码块、引用和链接地址 */
export function postText(html?: string | null): string {
  let h = html ?? "";
  h = h.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g, (_, c: string) => `\n\`\`\`\n${text(c.replace(/\n/g, "\u0000")).replace(/\u0000/g, "\n")}\n\`\`\`\n`);
  h = h.replace(/<aside[^>]*class="quote[^"]*"[^>]*data-username="([^"]*)"[^>]*>[\s\S]*?<blockquote>([\s\S]*?)<\/blockquote>\s*<\/aside>/g, (_, u: string, q: string) => `\n> @${u}：${text(q).slice(0, 200)}\n`);
  h = h.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, q: string) => `\n> ${text(q)}\n`);
  h = h.replace(/<div class="lightbox-wrapper">[\s\S]*?<\/div>\s*<\/div>/g, "[图片]"); // 帖子里的大图：只留个占位
  h = h.replace(/<a[^>]*class="lightbox"[^>]*>[\s\S]*?<\/a>/g, "[图片]");
  h = h.replace(/<img[^>]*class="emoji[^"]*"[^>]*alt="([^"]*)"[^>]*>/g, "$1");
  h = h.replace(/<img[^>]*>/g, "[图片]");
  h = h.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, t: string) => {
    const label = text(t);
    const url = href.startsWith("/") ? BASE + href : href;
    return !label || label === url || label === href ? url : `${label}（${url}）`;
  });
  h = h.replace(/<li[^>]*>/g, "\n- ").replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|div|h\d|ul|ol|li|tr)>/g, "\n");
  return h
    .split("\n")
    .map((line) => (line.startsWith("```") ? line : line.startsWith("> ") ? line : text(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const likesOf = (p: any) =>
  Math.max(p.reaction_users_count ?? 0, p.like_count ?? 0, (p.actions_summary ?? []).find((a: any) => a.id === 2)?.count ?? 0);

/** 按楼的内部 id 批量取楼层（每次 20 个） */
async function postsByIds(topicId: number, ids: number[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const q = ids.slice(i, i + 20).map((x) => `post_ids[]=${x}`).join("&");
    out.push(...((await get(`/t/${topicId}/posts.json?${q}`)).post_stream?.posts ?? []));
  }
  return out;
}

function formatPost(p: any, accepted: Set<number>, maxLen: number): string {
  const head = [
    `#${p.post_number} @${p.username}`,
    time(p.created_at),
    `${likesOf(p)} 赞`,
    p.reply_count ? `${p.reply_count} 条回复` : "",
    p.reply_to_post_number ? `回复 #${p.reply_to_post_number}` : "",
    accepted.has(p.post_number) ? "✅ 楼主采纳的答案" : "",
  ].filter(Boolean).join(" · ");
  let body = postText(p.cooked);
  if (body.length > maxLen) body = `${body.slice(0, maxLen)}……（这一楼较长，read_post 看全文）`;
  return `${head}\n${body}`;
}

export async function readTopic(topic: string | number, page?: number, maxChars = 60000, view: TopicView = "all", limit = 15): Promise<string> {
  const { id, floor } = parseTopic(topic);
  if (view === "best" || view === "op") return readTopicFiltered(id, view, limit, maxChars);
  const pg = page ?? (floor ? Math.floor((floor - 1) / PER_RAW_PAGE) + 1 : 1);
  const [t, raw] = await Promise.all([get(`/t/${id}.json`), get(`/raw/${id}?page=${pg}`, "text") as Promise<string>]);
  const pages = Math.max(1, Math.ceil((t.posts_count ?? 1) / PER_RAW_PAGE));
  const floors = [...raw.matchAll(/^.+ \| \d{4}-\d\d-\d\d [\d:]+ UTC \| #(\d+)$/gm)].map((m) => Number(m[1]));
  const head = [
    await topicHead(t),
    `原文第 ${pg}/${pages} 页（每页最多 ${PER_RAW_PAGE} 楼，格式：作者 | 时间(UTC) | #楼号）`,
    t.posts_count > 30 ? `评论多的话可以先看高赞：read_topic(topic=${id}, view="best")；楼主后续补充：view="op"` : "",
    "",
  ].filter((x, i, a) => x !== "" || i === a.length - 1).join("\n");
  if (!floors.length) return `${head}\n（这一页没有内容）`;
  let body = raw.trim();
  let cut = "";
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    cut = `\n\n……本页太长，只给了前 ${maxChars} 字。要看后面的楼层用 read_post 逐楼读，或调大 max_chars。`;
  }
  const tail = pg < pages ? `\n\n—— 本页 #${floors[0]}～#${floors.at(-1)}。下一页：read_topic(topic=${id}, page=${pg + 1})` : `\n\n—— 本页 #${floors[0]}～#${floors.at(-1)}，已到最后一页。`;
  return head + body + cut + tail;
}

async function topicHead(t: any): Promise<string> {
  const lines = [
    `# ${text(t.fancy_title ?? t.title)}`,
    topicUrl(t.slug, t.id),
    [
      await catName(t.category_id), tagList(t.tags), `楼主 @${t.details?.created_by?.username ?? "?"}`, `发于 ${time(t.created_at)}`,
      `${t.posts_count} 楼`, `${t.views} 浏览`, `${t.like_count} 赞`, `最后回复 ${time(t.last_posted_at)}`,
    ].filter(Boolean).join(" · "),
  ];
  for (const a of t.accepted_answers ?? []) {
    lines.push(`✅ 已解决，楼主采纳了 #${a.post_number} 楼 @${a.username}：${postText(a.cooked).replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return lines.join("\n");
}

/** view=best：L 站「精华回复」里按赞数挑最高的几楼；view=op：只看楼主的发言 */
async function readTopicFiltered(id: number, view: "best" | "op", limit: number, maxChars: number): Promise<string> {
  const t = await get(`/t/${id}.json`);
  const accepted = new Set<number>((t.accepted_answers ?? []).map((a: any) => a.post_number));
  const op = t.details?.created_by?.username ?? "";
  // 楼不多时全部评论都参与排序；楼多时用 L 站自带的「精华回复」先筛一遍
  const useAll = view === "best" && (t.posts_count ?? 0) <= 80;
  const filtered = useAll ? t : await get(view === "best" ? `/t/${id}.json?filter=summary` : `/t/${id}.json?username_filters=${encodeURIComponent(op)}`);
  const stream: number[] = filtered.post_stream?.stream ?? [];
  const have = new Map<number, any>((filtered.post_stream?.posts ?? []).map((p: any) => [p.id, p]));
  const want = stream.slice(0, view === "best" ? 80 : Math.max(limit, 20));
  const missing = want.filter((x) => !have.has(x));
  for (const p of await postsByIds(id, missing)) have.set(p.id, p);
  let posts = want.map((x) => have.get(x)).filter(Boolean);
  // 被采纳的答案不在精华里也要带上
  for (const n of accepted) {
    if (!posts.some((p) => p.post_number === n)) {
      const p = await get(`/posts/by_number/${id}/${n}.json`).catch(() => null);
      if (p) posts.push({ ...p, cooked: p.cooked });
    }
  }
  const first = posts.find((p) => p.post_number === 1);
  let title: string;
  if (view === "best") {
    posts = posts.filter((p) => p.post_number !== 1).sort((a, b) => Number(accepted.has(b.post_number)) - Number(accepted.has(a.post_number)) || likesOf(b) - likesOf(a)).slice(0, limit);
    title = `高赞评论（从${useAll ? "全部" : " L 站精华回复的"} ${stream.length} 楼里按赞数挑前 ${posts.length} 楼，采纳的答案排最前）`;
  } else {
    posts = posts.filter((p) => p.post_number !== 1).slice(0, limit);
    title = `只看楼主 @${op}（楼主共发言 ${stream.length} 次，这里给出 1 楼之后的前 ${posts.length} 次）`;
  }
  const parts = [await topicHead(t), ""];
  if (first) parts.push(`【1 楼 · 楼主原帖】\n${formatPost(first, accepted, 1500)}`, "");
  parts.push(`【${title}】`, "");
  if (!posts.length) parts.push("（没有）");
  const per = Math.max(400, Math.floor(maxChars / Math.max(posts.length, 1)));
  for (const p of posts) parts.push(formatPost(p, accepted, Math.min(per, 2500)), "");
  parts.push(`—— 按楼号看完整讨论：read_topic(topic=${id})；看某一楼全文和它下面的回复：read_post(topic=${id}, floor=楼号)`);
  return parts.join("\n");
}

export async function readPost(topic: string | number, floor?: number): Promise<string> {
  const parsed = parseTopic(topic);
  const n = floor ?? parsed.floor ?? 1;
  const p = await get(`/posts/by_number/${parsed.id}/${n}.json`);
  const likes = (p.actions_summary ?? []).find((a: any) => a.id === 2)?.count ?? p.like_count ?? 0;
  const lines = [
    `${topicUrl(p.topic_slug, p.topic_id, p.post_number)}`,
    `#${p.post_number} 楼 · @${p.username}${p.name ? `（${p.name}）` : ""} · ${time(p.created_at)} · ${likes} 赞 · ${p.reply_count ?? 0} 条直接回复` +
      (p.reply_to_post_number ? ` · 回复 #${p.reply_to_post_number} 楼` : ""),
    "",
    (p.raw ?? text(p.cooked)).trim(),
  ];
  if (p.reply_count > 0) {
    const replies: any[] = await get(`/posts/${p.id}/replies.json`).catch(() => []);
    if (replies.length) {
      lines.push("", `—— 对这层的直接回复（${replies.length} 条）：`);
      for (const r of replies) lines.push(`#${r.post_number} @${r.username} · ${time(r.created_at)}：${text(r.cooked).slice(0, 300)}`);
    }
  }
  return lines.join("\n");
}

export async function latest(page = 0, order?: string): Promise<string> {
  const q = new URLSearchParams({ page: String(page) });
  if (order) q.set("order", order);
  return topicList(await get(`/latest.json?${q}`), `最新话题（第 ${page} 页${order ? `，按 ${order} 排序` : ""}）`, `下一页：latest(page=${page + 1})`);
}

export async function top(period = "weekly", page = 0): Promise<string> {
  const j = await get(`/top.json?period=${encodeURIComponent(period)}&page=${page}`);
  return topicList(j, `热门话题（${period}，第 ${page} 页）`, `下一页：top(period="${period}", page=${page + 1})`);
}

export async function listCategories(): Promise<string> {
  const m = await categories();
  const lines = ["L 站分类（id · slug · 话题数）：", ""];
  const roots = [...m.values()].filter((c) => !c.parent);
  for (const c of roots) {
    lines.push(`- ${c.name} · id ${c.id} · ${c.slug} · ${c.topics ?? "?"} 话题${c.desc ? ` — ${c.desc.slice(0, 60)}` : ""}`);
    for (const s of [...m.values()].filter((x) => x.parent === c.id)) {
      lines.push(`  - ${s.name} · id ${s.id} · ${s.slug} · ${s.topics ?? "?"} 话题`);
    }
  }
  return lines.join("\n");
}

export async function categoryTopics(category: string | number, page = 0): Promise<string> {
  const c = await findCategory(category);
  const j = await get(`/c/${c.path}.json?page=${page}`);
  return topicList(j, `分类「${c.name}」话题（第 ${page} 页，共约 ${c.topics ?? "?"} 个话题）`, `下一页：category_topics(category=${c.id}, page=${page + 1})`);
}

export async function listTags(filter?: string, limit = 80): Promise<string> {
  const j = await get("/tags.json");
  let tags: any[] = j.tags ?? [];
  if (filter) tags = tags.filter((t) => tagName(t).toLowerCase().includes(filter.toLowerCase()));
  tags.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const shown = tags.slice(0, limit);
  return [`标签${filter ? `（含「${filter}」）` : ""}，按话题数排序，共 ${tags.length} 个，显示前 ${shown.length} 个：`, "", shown.map((t) => `#${tagName(t)}(${t.count})`).join("  ")].join("\n");
}

export async function tagTopics(tag: string, page = 0): Promise<string> {
  const t = tag.replace(/^#/, "");
  return topicList(await get(`/tag/${encodeURIComponent(t)}.json?page=${page}`), `标签 #${t} 的话题（第 ${page} 页）`, `下一页：tag_topics(tag="${t}", page=${page + 1})`);
}

export async function user(username: string): Promise<string> {
  const name = username.replace(/^@/, "");
  const [u, s] = await Promise.all([get(`/u/${encodeURIComponent(name)}.json`), get(`/u/${encodeURIComponent(name)}/summary.json`).catch(() => null)]);
  const x = u.user ?? {};
  const st = s?.user_summary ?? {};
  const lines = [
    `@${x.username}${x.name ? `（${x.name}）` : ""} · 信任等级 ${x.trust_level}${x.title ? ` · 头衔「${x.title}」` : ""}${x.admin ? " · 管理员" : ""}${x.moderator ? " · 版主" : ""}`,
    `${BASE}/u/${x.username}`,
    `注册 ${time(x.created_at)} · 最近在线 ${time(x.last_seen_at ?? x.last_posted_at)} · 徽章 ${x.badge_count ?? "?"}`,
    st.topic_count != null
      ? `发帖 ${st.topic_count} · 回复 ${st.post_count} · 收到赞 ${st.likes_received} · 给出赞 ${st.likes_given} · 访问 ${st.days_visited} 天 · 读帖 ${st.posts_read_count}`
      : "",
    x.bio_raw ? `简介：${String(x.bio_raw).slice(0, 300)}` : "",
  ].filter(Boolean);
  // summary.json：根上的 topics 是热门话题和热门回复用到的所有帖子；顺序和归属看 user_summary.topic_ids / replies
  const tmap = new Map<number, any>((s?.topics ?? []).map((t: any) => [t.id, t]));
  const topIds: number[] = st.topic_ids ?? [];
  if (topIds.length) {
    lines.push("", "热门话题：");
    for (const id of topIds.slice(0, 6)) {
      const t = tmap.get(id) ?? { id };
      lines.push(`- ${text(t.fancy_title ?? t.title ?? `帖子 ${id}`)} · ${t.like_count ?? "?"} 赞 · ${topicUrl(t.slug, id)}`);
    }
  }
  const replies: any[] = st.replies ?? [];
  if (replies.length) {
    lines.push("", "热门回复：");
    for (const r of replies.slice(0, 6)) {
      const t = tmap.get(r.topic_id) ?? {};
      lines.push(`- ${text(t.fancy_title ?? t.title ?? `帖子 ${r.topic_id}`)} #${r.post_number} · ${r.like_count} 赞 · ${topicUrl(t.slug, r.topic_id, r.post_number)}`);
    }
  }
  return lines.join("\n");
}

const ACTIONS: Record<string, string> = { all: "4,5", topics: "4", replies: "5", likes: "1" };
const ACTION_NAME: Record<number, string> = { 1: "点赞", 2: "被赞", 4: "发帖", 5: "回复", 6: "被回复", 7: "提到", 9: "引用" };

export async function userActivity(username: string, kind = "all", page = 0): Promise<string> {
  const name = username.replace(/^@/, "");
  const filter = ACTIONS[kind] ?? ACTIONS.all;
  const j = await get(`/user_actions.json?username=${encodeURIComponent(name)}&filter=${filter}&offset=${page * 30}`);
  const acts: any[] = j.user_actions ?? [];
  if (!acts.length) return `@${name} 的动态（${kind}，第 ${page} 页）：没有内容。`;
  const lines = [`@${name} 的动态（${kind}，第 ${page} 页）：`, ""];
  for (const a of acts) {
    lines.push(`- [${ACTION_NAME[a.action_type] ?? a.action_type}] ${time(a.created_at)} · ${text(a.title)}${a.post_number > 1 ? ` #${a.post_number}` : ""}`);
    lines.push(`  ${topicUrl(a.slug, a.topic_id, a.post_number)}`);
    if (a.excerpt) lines.push(`  ${text(a.excerpt).slice(0, 200)}`);
  }
  if (acts.length >= 30) lines.push("", `下一页：user_activity(username="${name}", kind="${kind}", page=${page + 1})`);
  return lines.join("\n");
}

const NOTI: Record<number, string> = {
  1: "提到你", 2: "回复你", 3: "引用你", 4: "编辑", 5: "赞了你", 6: "私信", 7: "邀请私信", 9: "关注的帖有新回复",
  11: "邀请加入话题", 12: "获得徽章", 15: "群组提到", 16: "群组消息", 17: "关注的分类有新帖", 19: "多人赞", 24: "书签提醒", 25: "表情回应",
  // L 站装的 discourse-follow（关注用户）插件
  800: "关注了你", 801: "关注的人发了新帖", 802: "关注的人回复了",
};

export async function notifications(limit = 30): Promise<string> {
  const j = await get(`/notifications.json?limit=${limit}`);
  const ns: any[] = j.notifications ?? [];
  if (!ns.length) return "没有通知。";
  const lines = [`最近 ${ns.length} 条通知（● 未读）：`, ""];
  for (const n of ns) {
    const d = n.data ?? {};
    const who = d.display_username ?? d.original_username ?? d.username ?? "";
    const title = text(n.fancy_title ?? d.topic_title ?? d.badge_name ?? "");
    lines.push(`${n.read ? "○" : "●"} ${time(n.created_at)} · ${NOTI[n.notification_type] ?? `通知${n.notification_type}`}${who ? ` · @${who}` : ""} · ${title}`);
    if (n.topic_id) lines.push(`  ${topicUrl(n.slug, n.topic_id, n.post_number)}`);
  }
  return lines.join("\n");
}

export async function bookmarks(page = 0): Promise<string> {
  const name = await myUsername();
  const j = await get(`/u/${encodeURIComponent(name)}/bookmarks.json?page=${page}`);
  const bs: any[] = j.user_bookmark_list?.bookmarks ?? [];
  if (!bs.length) return `书签第 ${page} 页：没有内容。`;
  const lines = [`我的书签（第 ${page} 页）：`, ""];
  for (const b of bs) {
    const url = b.bookmarkable_url ? (String(b.bookmarkable_url).startsWith("http") ? b.bookmarkable_url : BASE + b.bookmarkable_url) : topicUrl(b.slug, b.topic_id, b.linked_post_number);
    lines.push(`- ${text(b.fancy_title ?? b.title)}${b.name ? `（备注：${b.name}）` : ""} · 收藏于 ${time(b.created_at)}`);
    lines.push(`  ${url}`);
    if (b.excerpt) lines.push(`  ${text(b.excerpt).slice(0, 160)}`);
  }
  if (j.user_bookmark_list?.more_bookmarks_url) lines.push("", `下一页：bookmarks(page=${page + 1})`);
  return lines.join("\n");
}

export async function rawGet(path: string, maxChars = 20000): Promise<string> {
  const body: string = await get(path, path.startsWith("/raw/") ? "text" : "json").then((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return body.length > maxChars ? `${body.slice(0, maxChars)}\n……（共 ${body.length} 字，只给了前 ${maxChars} 字）` : body;
}
