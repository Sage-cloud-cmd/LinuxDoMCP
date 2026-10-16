linux.do MCP（Windows 版）—— 让你电脑上的 AI 工具能搜、能读 L 站

>>> 先双击打开同目录的 guide.html，图文教程一步步带你装，命令都能一键复制。<<<

【它能做什么】
在 Claude Code、Claude 桌面版、Cursor、Codex 等 AI 工具里直接说：
  「L 站搜一下 XX 怎么解决，看看评论里大家怎么说」
  「读一下这个帖子 https://linux.do/t/topic/123456」
  「看看我的 L 站通知 / 书签」
AI 会帮你搜索、读帖、读高赞评论、只看楼主、看采纳的答案。

【它怎么工作】
请求都从你自己的 Chrome 里发出，用的是你已经登录的 L 站账号，和你自己点开网页一样。
不需要交出 cookie 或密码，只读不写（不会发帖、回帖、点赞），除了 linux.do 不连任何别的网站。

【你需要】
- Windows 10 / 11（64 位）
- Chrome，并且在里面登录了 L 站
- 至少一个 AI 工具：Claude Code / Claude 桌面版 / Cursor / Codex，或其他支持 MCP 的工具

【安装（3 分钟）】
1. 先把压缩包「全部解压」（右键 → 全部解压缩），别在压缩包里直接双击。
2. 双击解压出来的 install.bat。
   如果弹出「Windows 已保护你的电脑」：点「更多信息」→「仍要运行」。
   它会：把程序装到 %LOCALAPPDATA%\linuxdo-mcp，并自动登记到你装了的 AI 工具里。
3. 按窗口最后的提示装 Chrome 扩展：
   Chrome 地址栏打开 chrome://extensions → 打开右上角「开发者模式」
   → 点「加载已解压的扩展程序」→ 在选择框顶部的地址栏粘贴路径（已经自动复制好了），回车 → 点「选择文件夹」。
   列表里出现「linux.do MCP 桥」就装好了。
4. 检查是否连通：按 Win+R，输入 cmd 回车，在黑窗口里运行：
      "%LOCALAPPDATA%\linuxdo-mcp\linuxdo-mcp.exe" check
   看到「✓ 一切正常」就可以用了。
5. 回到 AI 工具，新开一个会话（Claude 桌面版、Cursor、Codex 要完全退出再打开一次）。

【注意】
- 扩展会在 Chrome 标签栏最左边固定一个 L 站小标签页，请求都在那里发。关了也没事，下次用时会自动再开。
- 用的时候 Chrome 要开着。
- L 站最近自己常限流，提示「限流」时等一两分钟再试。
- 其他 AI 工具（Cherry Studio、Cline 等）：安装时窗口里打印了一段配置，粘贴到它的 MCP 设置里即可。
- 杀毒软件如果拦截 linuxdo-mcp.exe，选择信任/允许（它只是在本机和 Chrome 扩展通信）。

【卸载】
按 Win+R，输入 cmd 回车，运行："%LOCALAPPDATA%\linuxdo-mcp\linuxdo-mcp.exe" uninstall
然后在 chrome://extensions 里移除「linux.do MCP 桥」。
