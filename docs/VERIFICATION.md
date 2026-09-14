# 验证记录

验证环境：macOS、Node.js 26.8.1、Google Chrome。插件版本 0.3.3。

## 真实操作

已在真实 Figma Design 文件中完成连接、文档读取，以及 Grok 图标的生成、复刻和导出。生成图由宿主 image_gen 返回；复刻稿包含 3 个可编辑矢量图层和独立背景。实际导出检查覆盖 1024、64、32 px；SVG 包含 3 条路径，没有嵌入位图。

结果见 [参考与复刻](showcase/grok.html)、[Figma PNG](showcase/grok-figma.png) 和 [SVG](showcase/grok.svg)。README 的对比截图由这些实际结果排版展示，并非 Figma 客户端窗口截图。

## 本地回归

- `npm run check`：类型检查、构建、HTTP / 队列、设计与几何合约、图片任务、CLI 集成、skill 安装。
- 插件 UI 和图标预览的 16 个 Chrome 场景已通过，覆盖 260 / 368 / 640 px 面板、320 / 1280 px 预览、键盘、错误和恢复、localhost 实际 HTTP 传输。
- skill 安装检查使用独立目录，覆盖含空格和特殊字符的项目路径，以及已有个人 skill 的保留。

## 验证边界

真实 Grok 案例验证了矢量图标复刻与导出，不代表完整 UI、字体、Auto Layout、组件变体和每一种原生布尔运算都已完成视觉验收。Node 中的 Figma API 夹具不实现 Figma 几何求解器。

`examples/imagegen-camera-job` 的参考图是真实生图，重建 PNG 是本地矢量预览；该样例尚未作为真实 Figma 导出验收。像素差异和结构检查只能辅助检查，不能单独证明视觉还原质量。
