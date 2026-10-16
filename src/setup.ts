// 给朋友用的终端命令：setup（安装并登记到各 AI 工具）、check（自检）、uninstall（卸载）、version。
// 只在打包好的独立程序里用；开发时直接 bun src/server.ts 当 MCP 服务跑。

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { ensureBridge, request } from "./bridge";

const isWin = platform() === "win32";
const home = homedir();
export const INSTALL_DIR =
  process.env.LINUXDO_INSTALL_DIR ??
  (isWin ? join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "linuxdo-mcp") : join(home, ".linuxdo-mcp"));
const EXE = isWin ? "linuxdo-mcp.exe" : "linuxdo-mcp";
const BIN = join(INSTALL_DIR, EXE);
const EXT_DIR = join(INSTALL_DIR, "extension");

const compiled = () => Bun.main.includes("$bunfs") || Bun.main.includes("~BUN");

type Result = { name: string; ok: boolean | null; note: string }; // ok=null 表示没装这个工具，跳过

function run(cmd: string[]): { code: number; out: string } | null {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? 1, out: `${r.stdout?.toString() ?? ""}${r.stderr?.toString() ?? ""}` };
  } catch {
    return null; // 命令不存在
  }
}

// Windows 上 claude 常是 .cmd，得经 cmd /c 调用
function claudeCli(): string[] | null {
  const c = isWin ? ["cmd", "/c", "claude"] : ["claude"];
  const r = run([...c, "--version"]);
  return r && r.code === 0 ? c : null;
}

// ---------- 各 AI 工具的登记 ----------

function claudeCode(add: boolean): Result {
  const name = "Claude Code";
  const c = claudeCli();
  if (!c) return { name, ok: null, note: "没装，跳过" };
  run([...c, "mcp", "remove", "-s", "user", "linuxdo"]);
  if (!add) return { name, ok: true, note: "已移除" };
  const r = run([...c, "mcp", "add", "-s", "user", "linuxdo", "--", BIN]);
  return r && r.code === 0 ? { name, ok: true, note: "已登记（新开会话生效）" } : { name, ok: false, note: `登记失败：${r?.out.trim().slice(0, 200)}` };
}

function jsonConfig(name: string, file: string, add: boolean, restart: string): Result {
  if (!existsSync(dirname(file))) return { name, ok: null, note: "没装，跳过" };
  let j: any = {};
  if (existsSync(file)) {
    try {
      j = JSON.parse(readFileSync(file, "utf8") || "{}");
    } catch {
      return { name, ok: false, note: `配置文件不是合法 JSON，没敢改：${file}` };
    }
    if (!existsSync(`${file}.bak-linuxdo`)) copyFileSync(file, `${file}.bak-linuxdo`);
  }
  j.mcpServers ??= {};
  if (add) j.mcpServers.linuxdo = { command: BIN, args: [] };
  else if (!j.mcpServers.linuxdo) return { name, ok: true, note: "本来就没有" };
  else delete j.mcpServers.linuxdo;
  writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
  return { name, ok: true, note: add ? `已登记（${restart}）` : "已移除" };
}

function codex(add: boolean): Result {
  const name = "Codex";
  const file = join(home, ".codex", "config.toml");
  if (!existsSync(dirname(file))) return { name, ok: null, note: "没装，跳过" };
  let t = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (t && !existsSync(`${file}.bak-linuxdo`)) copyFileSync(file, `${file}.bak-linuxdo`);
  // 去掉旧的 [mcp_servers.linuxdo] 段（到下一个 [ 开头的段为止）
  t = t.replace(/\n?\[mcp_servers\.linuxdo\][\s\S]*?(?=\n\[|$)/, "");
  if (add) t = `${t.trimEnd()}\n\n[mcp_servers.linuxdo]\ncommand = '${BIN}'\n`;
  writeFileSync(file, t.startsWith("\n") ? t.slice(1) : t);
  return { name, ok: true, note: add ? "已登记（重开 Codex 生效）" : "已移除" };
}

function allClients(add: boolean): Result[] {
  const desktop = isWin
    ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return [
    claudeCode(add),
    jsonConfig("Claude 桌面版", desktop, add, "完全退出 Claude 再打开生效"),
    jsonConfig("Cursor", join(home, ".cursor", "mcp.json"), add, "重开 Cursor 生效"),
    codex(add),
  ];
}

function copyToClipboard(s: string) {
  if (isWin) {
    const p = Bun.spawn(["clip"], { stdin: "pipe" });
    p.stdin.write(s);
    p.stdin.end();
  } else run(["sh", "-c", `printf %s '${s.replace(/'/g, "'\\''")}' | pbcopy`]);
}

// ---------- 命令 ----------

function setup(version: string): number {
  if (!compiled()) {
    console.log("setup 要用打包好的独立程序运行（dist/ 里的 linuxdo-mcp）。");
    return 1;
  }
  const srcDir = dirname(process.execPath);
  const srcExt = join(srcDir, "extension");
  if (!existsSync(join(srcExt, "manifest.json"))) {
    console.log(`没找到同目录下的 extension 文件夹（应在 ${srcExt}）。请把压缩包完整解压后再运行。`);
    return 1;
  }
  console.log(`linux.do MCP ${version} 安装到：${INSTALL_DIR}\n`);
  mkdirSync(INSTALL_DIR, { recursive: true });
  try {
    if (process.execPath !== BIN) copyFileSync(process.execPath, BIN);
    if (!isWin) chmodSync(BIN, 0o755);
  } catch (e: any) {
    console.log(`复制程序失败：${e?.message ?? e}\n多半是 AI 工具正在用旧版本。先把 Claude / Cursor / Codex 都关掉，再运行一次。`);
    return 1;
  }
  if (srcExt !== EXT_DIR) {
    rmSync(EXT_DIR, { recursive: true, force: true });
    cpSync(srcExt, EXT_DIR, { recursive: true });
  }
  if (!isWin) run(["xattr", "-dr", "com.apple.quarantine", INSTALL_DIR]); // 去掉「从网上下载」标记，免得被系统拦

  console.log("登记到你电脑上的 AI 工具：");
  const rs = allClients(true);
  for (const r of rs) console.log(`  ${r.ok === null ? "·" : r.ok ? "✓" : "✗"} ${r.name}：${r.note}`);
  console.log(`\n其他 AI 工具（Cherry Studio、Cline、Windsurf 等）在 MCP 设置里加这一段：\n${JSON.stringify({ mcpServers: { linuxdo: { command: BIN, args: [] } } }, null, 2)}\n`);

  if (!process.env.LINUXDO_NO_CLIPBOARD) copyToClipboard(EXT_DIR);
  console.log("还差最后一步，装 Chrome 扩展（用你平时登录 L 站的那个 Chrome）：");
  console.log("  1. 地址栏打开 chrome://extensions");
  console.log("  2. 打开右上角「开发者模式」");
  console.log("  3. 点「加载已解压的扩展程序」，选这个文件夹（路径已复制到剪贴板）：");
  console.log(`     ${EXT_DIR}`);
  console.log(isWin ? "     在选择框顶部的地址栏里粘贴路径，回车，再点「选择文件夹」。" : "     在选择框里按 Cmd+Shift+G，粘贴路径，回车，再点「选择」。");
  console.log("  4. 列表里出现「linux.do MCP 桥」就装好了。");
  console.log(`\n装完后检查一下是否连通：\n  ${isWin ? `"${BIN}"` : BIN} check`);
  return rs.some((r) => r.ok === false) ? 1 : 0;
}

async function check(version: string): Promise<number> {
  console.log(`linux.do MCP ${version}`);
  console.log("正在等 Chrome 里的扩展连上（最多 35 秒）……");
  try {
    await ensureBridge();
    const r = await request("/session/current.json", "json");
    if (r.error) {
      console.log(`✗ ${r.error}`);
      return 1;
    }
    if (r.status !== 200) {
      console.log(`✗ 扩展连上了，但 L 站返回 ${r.status}。在 Chrome 里打开 https://linux.do 看看是否正常、是否已登录。`);
      return 1;
    }
    const u = JSON.parse(r.body).current_user;
    if (!u) {
      console.log("✗ 扩展连上了，但 Chrome 里没有登录 L 站。登录后再试。");
      return 1;
    }
    console.log(`✓ 一切正常：Chrome 里登录的 L 站账号是 ${u.username}（信任等级 ${u.trust_level}）。`);
    console.log("  在 AI 工具里新开一个会话，说「L 站搜一下 ……」就能用了。");
    return 0;
  } catch (e: any) {
    console.log(`✗ ${e?.message ?? e}`);
    return 1;
  }
}

function uninstall(): number {
  console.log("从 AI 工具里移除：");
  for (const r of allClients(false)) console.log(`  ${r.ok === null ? "·" : r.ok ? "✓" : "✗"} ${r.name}：${r.note}`);
  try {
    rmSync(INSTALL_DIR, { recursive: true, force: true });
    console.log(`已删除 ${INSTALL_DIR}`);
  } catch {
    console.log(`${INSTALL_DIR} 没删掉（程序可能正被 AI 工具占用），关掉 AI 工具后手动删除这个文件夹。`);
  }
  console.log("最后在 chrome://extensions 里把「linux.do MCP 桥」移除。各配置文件改之前的备份是同目录的 *.bak-linuxdo。");
  return 0;
}

export async function runCommand(cmd: string, version: string): Promise<number> {
  switch (cmd) {
    case "setup":
      return setup(version);
    case "check":
      return check(version);
    case "uninstall":
      return uninstall();
    case "version":
    case "--version":
      console.log(version);
      return 0;
    default:
      console.log("用法：linuxdo-mcp [setup | check | uninstall | version]\n不带参数时作为 MCP 服务运行（AI 工具会自动这样启动它）。");
      return 1;
  }
}
