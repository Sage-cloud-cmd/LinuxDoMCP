# linux.do MCP

> **只想用？** 到 [Releases 页面](https://github.com/Sage-cloud-cmd/LinuxDoMCP/releases/latest) 下载安装包：Mac 下 `linuxdo-mcp-mac-*.zip`，Windows 下 `linuxdo-mcp-windows-*.zip`。解压后双击里面的 `guide.html`，跟着图文教程装，大约 3 分钟，不需要懂代码。

让 Claude Code 只读访问 linux.do（L 站）：搜索、读整帖（可只看高赞评论或只看楼主，已解决的帖子标出采纳的答案）、读某一楼和它的回复、最新/热门、分类、标签、用户资料与动态、我的通知和书签，外加一个只读的 `get` 兜底。

## 为什么这样做

L 站前面有 Cloudflare。网络出口是机房 IP 时（比如走代理），任何脚本请求（包括伪装浏览器指纹的）都会被拦下；国内直连又常常连不上 linux.do。能稳定访问 L 站的只有你自己的 Chrome。

所以请求就在 Chrome 里发：

```
Claude Code ──stdio──> MCP 服务（bun，本机） ──ws://127.0.0.1:47821──> Chrome 扩展 ──> linux.do 标签页里 fetch
```

- 用的是 Chrome 里已经登录的 L 站账号，**不需要交出 cookie**，也不伪装任何东西。
- 只做 GET，只访问 `https://linux.do` 的站内路径；两次请求至少间隔 1 秒，同一地址 2 分钟内用缓存不重复请求；被限流（L 站最近自己常这样）只等一次，还不行就如实报告。
- 端口只监听 127.0.0.1；扩展那头只认这个扩展的 ID，网页里的脚本连不上（见 `src/bridge.ts` 开头）。
- MCP 协议是手写的（`src/server.ts`），不依赖任何库，不会因为库升级坏掉。

## 安装

1. **装扩展**：Chrome（登录了 L 站的那个）打开 `chrome://extensions` → 右上角打开「开发者模式」→「加载已解压的扩展程序」→ 选本目录下的 `extension` 文件夹。扩展 ID 固定为 `phicbodfdfifgoafgmicaappnckccpcf`。
2. **加到 Claude Code**：

   ```bash
   claude mcp add -s user linuxdo -- bun /你放代码的目录/LinuxDoMCP/src/server.ts
   ```

3. 新开一个 Claude 会话，说「L 站搜一下 XX」。

扩展会在标签栏最左边固定一个自己的 linux.do 小标签页，所有请求都在那里发，不碰你自己开的 L 站页面。别关它；关了下次用时会自动再开。

出口 IP 在 Cloudflare 那里信誉差时，大约一半请求会被随机要求验证。扩展的办法是：先在页面里直接请求，被拦就隔一会儿再试一次，还被拦就让那个小标签页真正打开这个地址，等浏览器自己过完验证再读内容。

## 常见问题

- **「扩展没连上」**：Chrome 没开、扩展没启用，或 Chrome 刚启动（扩展最多 30 秒内会连上）。
- **「Cloudflare 要求验证」**：在 Chrome 里打开 linux.do 过一下验证。
- **多个 Claude 会话**：第一个启动的会话负责和扩展连接，其余的经它转发；它退出后，别的会话会自动接手。

## 开发

```bash
bun test   # 用假扩展端到端测试：协议、转发、接手、安全、出错提示
```

## 分享给朋友

```bash
bash scripts/package.sh   # 跑测试、编译 Mac（通用）和 Windows 独立程序，生成 dist/ 下两个 zip
```

- `dist/linuxdo-mcp-mac-<版本>.zip`、`dist/linuxdo-mcp-windows-<版本>.zip`：朋友解压后先打开里面的 `guide.html`（图文教程，源文件在 `guide/guide.html`），不需要 Bun。
- `dist/guide-web.html`：同一份教程的网页版正文，用来发布成在线链接。
- 安装脚本会把程序放到 `~/.linuxdo-mcp`（Windows：`%LOCALAPPDATA%\linuxdo-mcp`），并自动登记到 Claude Code、Claude 桌面版、Cursor、Codex（改之前备份成 `*.bak-linuxdo`）。
- 朋友自检：`linuxdo-mcp check`；卸载：`linuxdo-mcp uninstall`。
- 每个人用的都是自己 Chrome 里的 L 站登录，互不相干；扩展 ID 和端口大家都一样。
