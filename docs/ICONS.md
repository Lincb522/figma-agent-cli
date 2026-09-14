# 小图标与 App Icon

自带的是参考图中那种 **Keyline 几何构造底板**：外框、三等分线、中心线、两条对角线、外圆、中心圆、圆角方形、竖向和横向圆角矩形。各元素都是独立的原生 Figma 图层，整组辅助线默认锁定。主体和辅助线分别放在同级的 Artwork 与 Guides 中。

图标主体使用 24 × 24 源网格，导出时将路径坐标转换到实际尺寸。CLI 没有内置设计模型，自定义形状由调用它的 agent 根据设计需求编写。UI 小图标默认透明背景；App Icon 可以添加独立的着色背景形状，背景形状与构造辅助线是不同图层。

## 构造底板与布尔造型

```sh
# 创建与参考图同类的构造网格；小图标可用 --kind ui 或 --size 24
node dist/cli.js icon grid --size 1024 --dir work/icon-grid
node dist/cli.js apply work/icon-grid/figma.json

# 使用 apply 返回的 keys.workbench，取出两个实心圆形
node dist/cli.js icon shape '<workbench-id>' circle
node dist/cli.js icon shape '<workbench-id>' inner-circle

# 使用上述命令返回的两个形状 ID，得到可编辑圆环
node dist/cli.js boolean subtract '<circle-id>' '<inner-circle-id>'

# 默认导出成品，辅助线不会进入 PNG 或 SVG
node dist/cli.js export '<workbench-id>' --out icon.png
# 仅在需要展示构造过程时，明确包含辅助线
node dist/cli.js export '<workbench-id>' --with-guides --out construction.png
```

`icon shape` 支持 `circle`、`inner-circle`、`square`、`portrait`、`landscape`。它从辅助模板复制形状，放入 Artwork，解除锁定，改为实心填充；原辅助线保持不变。随后可以用 patch 调整尺寸、位置和圆角，再组合布尔运算。直接把 Guides 或整个含 Guides 的工作板传给 boolean 会报 `GUIDE_OPERAND`，避免把辅助线误算进图标。

构造比例以 24 等分为基础：外圆直径 20，中心圆直径 10；圆角方形 18 × 18，竖矩形 16 × 20，横矩形 20 × 16，全部居中。此比例来自对所提供参考图的几何重建，允许继续修改。

`apply` 返回 `keys.workbench`（工作板）、`keys.icon`（Artwork 成品画布）、`keys.guides`（辅助组）及五个 `guide-*` 模板 ID。CLI 导出工作板会自动定位 Artwork；在 Figma 中手工导出时直接选择 Artwork。导出过程不需要隐藏或修改辅助层。

可直接打开随包的 [构造底板预览](../examples/keyline-grid/preview.html) 或导入 [原生底板定义](../examples/keyline-grid/figma.json)。

## 生成与导入

```sh
# 18 个常用图形
node dist/cli.js icon list

# 24 px UI 图标，默认透明背景并自带构造网格
node dist/cli.js icon build search --dir work/search-24

# 无着色背景的小图标
node dist/cli.js icon build home --size 20 --plate none --dir work/home-20

# 使用自定义路径生成 1024 px App Icon
node dist/cli.js icon build examples/marks/camera.json --kind app \
  --background '#28634B' --foreground '#FFFFFF' --dir work/camera-app

# 直接创建在已连接的 Figma 文件里
node dist/cli.js icon apply search --size 24 --plate circle
node dist/cli.js icon apply examples/marks/camera.json --kind app

# 导入已在本地检查过的同一份图层定义
node dist/cli.js apply work/camera-app/figma.json
```

`icon build` 的目录必须是新目录。输出不含辅助线的 `icon.svg`、包含辅助线的 `construction.svg`、`figma.json`、记录源定义和参数的 `icon.json`，以及含多尺寸、浅/深背景检查的 `preview.html`。SVG 可以直接用于代码或导入其他矢量工具。

| 参数 | 含义 |
| --- | --- |
| `--kind ui / app` | UI 默认 24 px，App 默认 1024 px |
| `--size 16…4096` | 主文件尺寸，正方形 |
| `--plate rounded / circle / square / none` | 圆角背景、圆形背景、直角背景、透明背景；UI 默认 none，App 默认 rounded |
| `--background / --foreground` | `#RRGGBB` 背景形状色与主体色 |
| `--padding` | 主文件像素中的主体内缩；有背景时 UI 约 8%、App 16%；无背景为 0 |
| `--radius` | 圆角背景半径，使用主文件像素 |
| `--stroke` | 24 px 源网格上的笔画宽度，0.5–4；默认 UI 1.75，App 2.2 |

UI 图标导出时给细笔画设置 1.25 px 下限，避免 16 px 版本过细。这是笔画策略，不保证任意自定义路径已经像素对齐；agent 仍应在实际尺寸下检查曲线、接缝和视觉重心。App Icon 的主体保留留白，着色背景可以单独改色或更换。

## Agent 自定义图形

```json
{
  "name": "My mark",
  "paths": [
    { "name": "body", "d": "M4 12h16m-7-7 7 7-7 7" },
    { "name": "detail", "d": "M4 4h3v3H4Z", "fill": true }
  ]
}
```

`d` 接受标准 SVG 路径，包括曲线和圆弧。每条路径有唯一名称；`fill: true` 使用主体色填充，默认是圆头、圆角描边。填充可设 `fillRule: "evenodd"` 表达洞。支持最多 32 条路径，但小图标通常应保持 1–3 条有意义的路径。路径解析和输入校验通过后才写出文件或发送 Figma 命令。

也可以直接在 `apply` 规格里构建嵌套 `BOOLEAN` 主体。`examples/boolean-appicon.json` 提供独立着色背景、外部形状合并、内部挖空的示例。运行后用返回的 `mark` ID 调用 `boolean set`，或修改返回的 `cutout` 图层，继续改变负空间。

```sh
node dist/cli.js apply examples/boolean-appicon.json
node dist/cli.js boolean set '<mark-id>' exclude
node dist/cli.js boolean outline '<stroked-vector-id>' --keep-inputs
node dist/cli.js export '<appicon-frame-id>' --out app-icon-1024.png
node dist/cli.js export '<appicon-frame-id>' --out app-icon-64.png --scale 0.0625
node dist/cli.js export '<appicon-frame-id>' --out app-icon.svg
```

扁平化和描边轮廓化会减少可继续编辑的结构。需要保留原图时传 `--keep-inputs`。SVG 导入后 `Mark` 通常是包含矢量子节点的 Frame；对笔画轮廓化时先 `inspect` 获取真正带描边的子节点 ID。

## image_gen 参考图到可编辑图标

```sh
node dist/cli.js design prepare appicon-brief.txt --kind appicon --dir work/appicon-job
node dist/cli.js design generate work/appicon-job
# Agent 使用返回的 prompt 调用内置 image_gen，再接收实际 PNG
node dist/cli.js design accept work/appicon-job /actual/output.png --generation-id '<id>' --result-ref '<tool-result>'
# Agent 打开 reference.png，编写同尺寸的原生底板与 SVG/VECTOR/BOOLEAN 主体
node dist/cli.js design apply work/appicon-job reconstructed-icon.json
node dist/cli.js design capture work/appicon-job
```

小图标使用 `--kind icon`；默认准备 64 × 64 参考画布。App Icon 默认 1024 × 1024。图片模型实际输出的 PNG 尺寸决定重建画布尺寸。图标模式不会要求为了通过检查而添加文字；结构检查要求可编辑的主体形状。宿主 image_gen 工具与 CLI 的衔接方式见 [IMAGEGEN.md](IMAGEGEN.md)。

内置 SVG 图标样例通过路径代码生成。`examples/imagegen-camera-job/reference.png` 是真实 image_gen 结果，其余独立 SVG 样例与 Figma 导出记录分别标注来源。
