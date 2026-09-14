<div align="center">

# Figma Agent

**把设计需求交给 Codex，在 Figma 里得到可编辑的结果。**

[开始使用](#开始使用) · [实际效果](#实际效果) · [Codex Skill](skills/figma-agent) · [MIT](LICENSE)

</div>

![image_gen 参考图与 Figma 实际复刻结果](docs/showcase/grok-comparison.png)

## 为什么做这个

试过 Figma MCP 和 Codex 里的 Figma 插件，总觉得用起来不够顺手，也不够智能。很多时候，我还是要替 agent 拆步骤、传信息、反复操作。

所以干脆自己写了一套 **CLI + Figma 插件**：让 agent 能直接在画布里动手，画界面、做图标、调整细节，再把结果导出来检查。也把这套用法做成了 skill，换个对话就能接着用。

## 实际效果

这次给 Codex 的需求只有一句：

> 生成一个 Grok 的图标，然后用 Figma 给我复刻出来。

上图左侧是 image_gen 生成的参考图，右侧是 **Figma 实际导出的复刻稿**。圆环和斜线保留为独立矢量图层，背景也可以单独修改。

[查看 PNG](docs/showcase/grok-figma.png) · [查看可编辑 SVG](docs/showcase/grok.svg)

<details>
<summary>图标也有自己的构造底板</summary>

<p align="center"><img src="docs/keyline-grid.png" width="400" alt="Keyline 构造底板：中心线、对角线、同心圆与圆角矩形" /></p>

小图标和 App Icon 都可以从 Keyline 构造底板开始，用布尔运算合并、挖空和调整轮廓。辅助线、图标主体和着色背景分别保留。

</details>

## 开始使用

准备好 **Node.js 22+、Figma 桌面版和 Codex**。先打开一个可以编辑的 Figma Design 文件。

**1. 下载项目**

```sh
git clone https://github.com/Lincb522/figma-agent-cli.git
cd figma-agent-cli
```

**2. 安装 skill，启动连接**

```sh
npm run skill:install
npm start
```

终端会显示六位配对码，保持这个窗口打开。仓库已带可运行文件，无需先构建。之后在 macOS 上也可以双击 `Start.command` 启动。

**3. 在 Figma 里连接**

打开 **Plugins → Development → Import plugin from manifest…**，选择项目里的 `dist/plugin/manifest.json`。运行 **Figma Agent**，输入配对码，点击连接。**只需绑定一次**，以后重开插件、重启 CLI，或在其他设计稿打开插件，都会使用已保存的绑定。意外断线会自动重连，CLI 恢复后无需重新配对。

从旧版升级：更新后重启一次 CLI、重新打开插件并配对，以保存首次绑定。保留项目的 `.figma-agent` 目录。

**4. 回到 Codex，直接说需求**

```text
$figma-agent 帮我设计一个音乐 App 首页，使用可编辑图层，完成后导出检查。
```

Skill 会记住项目位置，新对话不用重新贴路径。没有启动 CLI 时，它会帮你启动；需要绑定时，它会获取配对码并提示你在 Figma 填写。

每个要操作的设计稿仍需打开插件，无需各自重新绑定。多个文件同时连接时，Codex 会按会话选择目标。

## 还可以这样用

> 修改我在 Figma 里选中的页面，调整排版和间距，保留原有内容。

> 做一套相机 App 图标，再做一个带构造底板的 App Icon，用布尔运算完成造型。

> 先用 image_gen 生成一个播放器界面，再复刻到 Figma，保留可编辑文字、按钮和布局。

先生成图片的流程需要当前 agent 提供 image_gen 工具。已有参考图也可以直接复刻。

---

配对码过期时，直接让 Codex 获取新码，或运行 `npm run cli -- pair`；不用重启终端。更多用法见 [CLI 参考](docs/CLI.md)、[图标设计](docs/ICONS.md)和[图片复刻](docs/IMAGEGEN.md)。

[MIT License](LICENSE) · [第三方依赖说明](docs/THIRD-PARTY-NOTICES.txt)
