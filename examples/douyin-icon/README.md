# 抖音图标 · 从生图到可编辑构造

一次使用 Figma Agent 的完整图标案例：生成白底参考，在 Figma 中重建原生几何和布尔关系，再展示完整图标、原位构造与拆解。

[观看产品实录](../../docs/showcase/figma-agent-intro.mp4)中的 **46–84 秒**展示了这个流程。

## 1. 生图，确定视觉参考

![生成的白底参考](reference.png)

Agent 调用宿主的 `image_gen`，生成黑色主体、青红错位边缘的图标参考，再将背景修正为不透明白色。保留了[完整提示词](prompt.txt)和实际输出；参考图尺寸为 1254 × 1254。

CLI 负责组织生图任务，实际生成由 Agent 的生图工具完成。具体命令见[图片复刻流程](../../docs/IMAGEGEN.md)。

## 2. 重建几何，保留布尔关系

| 几何原件 | 布尔组合 |
| :---: | :---: |
| ![几何原件](primitives.png) | ![布尔组合](boolean.png) |

先组合椭圆、竖杆和旗形，再减去内腔。黑、青、红三层分别保留一组 `UNION → SUBTRACT`，共 6 个原生 `BOOLEAN_OPERATION`。主体没有 IMAGE 填充，没有 flatten；白色底板、Artwork 与 Guides 分层保存。

![Figma 导出的成品](result.png)

[几何布局定义](layout.json) · [布尔结构回读](boolean-evidence.json) · [SVG 交换文件](result.svg)

## 3. 在白色底板上原位展示

![原位 Keyline 构造](keyline.png)

辅助线包括外方框、圆角框、横竖比例线、对角线及同心圆。整个图标按三色联合边界居中，保持各颜色层的相对位置。Guides 独立锁定，不参与布尔运算。

轮廓和控制柄来自真实几何数据，叠加在完整图标原来的位置：12 个形状操作数中，6 个 Vector 共含 **30 个顶点和 30 个非零切线控制柄**。蓝色方点是顶点，橙色圆点是控制点。

[原位构造数据](keyline-data.json) · [原位结构验证](keyline-verification.json)

## 4. 拆开检查各个操作数

![六个矢量操作数的拆解](exploded.png)

每个矢量单独展示曲线、顶点和切线，便于检查内腔与旗形的构造，同时保留完整成品和原位构造板。

[实际 vectorNetwork 数据](vector-networks.json)

## 在自己的文件里复做

可以将整个示例目录交给 Agent：

```text
用 Figma Agent 按 examples/douyin-icon 复做这个图标：
先读取参考图和几何布局，创建新的页面，保留原生 UNION / SUBTRACT。
然后做白色 Keyline 底板、原位节点辅助和独立拆解板。
操作使用本次创建后返回的节点 ID，最后导出并检查结构与画面。
```

目录里的脚本整理自实际录制时的操作，已将原文件节点 ID 改为参数。它们创建新节点；运行前使用 `sessions` 确认目标文件，每次请求使用同一目标 session。

```sh
node dist/cli.js sessions
node dist/cli.js exec examples/douyin-icon/steps/01-page.js --session '<session-id>'
node dist/cli.js apply examples/douyin-icon/layout.json --session '<session-id>' --out created.json
```

后续脚本通过 `--args` 接收本次操作返回的 ID：

```sh
node dist/cli.js exec examples/douyin-icon/steps/02-boolean.js --session '<session-id>' --args boolean-args.json
```

`boolean-args.json` 的字段如下，值由 Agent 从本次返回结果填入：

```json
{
  "pageId": "本次新页面 ID",
  "artworkId": "Artwork ID",
  "bowlId": "Outer bowl ID",
  "stemId": "Stem ID",
  "flagId": "Flag ID",
  "cavityId": "Cutter / Inner cavity ID"
}
```

| 顺序 | 脚本 | 所需参数 |
| --- | --- | --- |
| 1 | [新建页面](steps/01-page.js) | 无；随后 apply `layout.json` |
| 2 | [原生布尔组合](steps/02-boolean.js) | `pageId, artworkId, bowlId, stemId, flagId, cavityId` |
| 3 | [三色叠合](steps/03-colors.js) | `pageId, noteId, artworkId, guidesId, frameId` |
| 4 | [独立拆解](steps/04-exploded.js) | `pageId, artworkId` |
| 5 | [白色 Keyline 底板](steps/05-keyline.js) | `pageId`；返回 `board` |
| 6 | [完整图标原位放置](steps/06-in-place.js) | `boardId, artworkId`；返回新 `artwork` |
| 7 | [叠加真实节点数据](steps/07-points.js) | `boardId, inPlaceArtworkId` |

字体使用 `Noto Sans SC / Regular`。若文件环境缺少该字体，请先由 Agent 选择可用字体再调整对应脚本。请求结果不确定时先检查本次节点或请求状态，不要重复创建。

## 这份示例验证了什么

原始操作已在 Figma 中完成，并导出上述图像、布尔层级和矢量数据。这里的参数化脚本通过语法和参数检查，**尚未在另一个 Figma 文件中重新执行验收**。回读 JSON 中的 ID 仅是原始记录，不可用作新文件的操作目标。

节点和控制柄属于数据生成的构造辅助层，不是 Figma 原生编辑模式截图。SVG 用于交换，重新导入 SVG 不会恢复原文件的布尔编辑层级。此案例依据生成的参考图重建，不宣称与官方图标像素级一致。

抖音 / TikTok 图标及商标归其权利人所有。此处为非官方工具能力演示，与品牌方无关联；仓库的 MIT 许可不授予商标权。
