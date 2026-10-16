linux.do MCP（Mac 版）—— 让你电脑上的 AI 工具能搜、能读 L 站

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
- 一台 Mac（苹果芯片和 Intel 都行）
- Chrome，并且在里面登录了 L 站
- 至少一个 AI 工具：Claude Code / Claude 桌面版 / Cursor / Codex，或其他支持 MCP 的工具

【安装（3 分钟）】
1. 解压这个压缩包。
2. 打开「终端」（启动台里搜“终端”），输入 bash 和一个空格，
   把解压出来的 install.sh 拖进终端窗口，按回车。
   它会：把程序装到 ~/.linuxdo-mcp，并自动登记到你装了的 AI 工具里。
3. 按终端最后的提示装 Chrome 扩展：
   Chrome 地址栏打开 chrome://extensions → 打开右上角「开发者模式」
   → 点「加载已解压的扩展程序」→ 按 Cmd+Shift+G，粘贴路径（已经自动复制好了），回车 → 点「选择」。
   列表里出现「linux.do MCP 桥」就装好了。
4. 检查是否连通，在终端里运行：
      ~/.linuxdo-mcp/linuxdo-mcp check
   看到「✓ 一切正常」就可以用了。
5. 回到 AI 工具，新开一个会话（Claude 桌面版、Cursor、Codex 要完全退出再打开一次）。

【注意】
- 扩展会在 Chrome 标签栏最左边固定一个 L 站小标签页，请求都在那里发。关了也没事，下次用时会自动再开。
- 用的时候 Chrome 要开着。
- L 站最近自己常限流，提示「限流」时等一两分钟再试。
- 其他 AI 工具（Cherry Studio、Cline 等）：安装时终端里打印了一段配置，粘贴到它的 MCP 设置里即可。

【卸载】
在终端里运行：~/.linuxdo-mcp/linuxdo-mcp uninstall
然后在 chrome://extensions 里移除「linux.do MCP 桥」。
