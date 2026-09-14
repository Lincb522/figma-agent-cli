# image_gen 生图与可编辑复刻

默认由调用 CLI 的 Agent 使用宿主内置 `image_gen` 工具。Figma CLI 负责提示词、状态、结果接收、图层创建和导出对比；宿主工具负责真实生图。不需要另配图片 API Key、provider.json 或外部命令适配器。

**独立终端进程无法直接调用宿主 image_gen。** `design generate` 返回待执行工具请求，明确标记 `generated: false`；Agent 看到请求后调用工具一次，再把实际返回的 PNG 交回 CLI。只生成了请求文件不代表完成生图。工具不可用时应明确报告，不能自动切换服务。

## 工作流

```sh
node dist/cli.js design prepare brief.txt --dir work/ui-job --width 1440 --height 1024
node dist/cli.js design generate work/ui-job
```

第二条命令写入 `generation-request.json`，并返回：

```json
{
  "tool": "image_gen",
  "arguments": { "prompt": "准备好的完整提示词" },
  "generationId": "本次生成请求的 UUID",
  "phase": "awaiting_image",
  "generated": false
}
```

Agent 使用返回的 `arguments.prompt` 调用宿主生图工具，检查真实结果后执行：

```sh
node dist/cli.js design accept work/ui-job /actual/image_gen/output.png \
  --generation-id '<generationId>' --result-ref '<工具结果 ID 或返回的图片路径>'

# Agent 打开 reference.png，按实际图片尺寸编写原生图层
node dist/cli.js design apply work/ui-job layout.json --session '<session-id>'
node dist/cli.js design capture work/ui-job
node dist/cli.js design status work/ui-job
```

`accept` 校验生成 ID 和提示词快照，解码实际 PNG，记录 SHA-256，并将图片复制到任务目录。来源记录为 `image_gen`；工具结果引用标记为 `agent-reported`。CLI 可以验证图片字节和请求关联，不能独立认证远程模型身份；实际调用证据由宿主 Agent 的工具记录提供。不要把密钥或带认证参数的 URL 写入 result-ref。

如果参考图来自用户已有文件，用 `design import <job> <reference.png>`，来源为 `imported`。import 会结束当前等待接收状态，旧生图请求随后不能覆盖该参考图。

## 可编辑重建

`layout.json` 必须恰好包含一个 FRAME，宽高匹配 `reference.png` 的实际像素尺寸。生成器可能返回与请求不同的尺寸，程序使用实际 PNG 尺寸，不静默缩放。

Agent 先查看图片，再识别布局、文字、控件、图标和位图资产。文字使用 TEXT；布局使用 Frame 和 Auto Layout；图标使用原生几何、SVG、Vector 或 Boolean；照片和复杂插画可以保留为 IMAGE。`imagePath` 相对于 layout 所在目录，不允许跨目录或经符号链接读取外部文件。CLI 没有内置看图推理模型，重建决策由 Agent 完成。

图标任务使用 `design prepare --kind icon`，App Icon 使用 `--kind appicon`。可将图形放进 Keyline 构造工作板的 Artwork 层；Guides 不能计入可编辑主体的校验。成品导出自动选择 Artwork。

`design apply` 创建可编辑重建稿，并在右侧放置锁定的参考图；保存请求 ID、会话、节点 ID 和 keys。创建前持久化请求记录，响应不确定时用 `design recover` 查询原请求，避免重复创建。

## 导出与验收

`design capture` 校验 Figma 节点的任务标签和可编辑结构，再以 1 倍尺寸导出 PNG，生成 `render.png`、`overlay.png`、`difference.png`、`comparison.json` 和可交互 `comparison.html`。

尺寸不匹配会报错。像素差异指标用于定位问题，不代表视觉还原度；Agent 必须打开实际导出图，检查文字、几何、间距、颜色、裁切和溢出。`audit` 的结构检查也不能替代视觉验收。

`design compare <job> <external.png>` 检查外部图片并明确标记来源，写入 `external-comparison/`，不覆盖 Figma 导出的报告。

## 随包的真实生图记录

`examples/imagegen-camera-job/` 包含本次通过内置 `image_gen` 生成的相机 App Icon 参考图、完整提示词、工具请求及接收记录。实际 PNG 为 1254 × 1254；请求尺寸为 1024 × 1024。记录的 SHA-256 为 `cb9ce7ee6cc2b639a13c14e2486c92d573b0e0e5b03bf35f880448487359e13a`。

该样例验证了「准备请求 → 实际 image_gen 调用 → PNG 接收」；Figma 真实客户端写入与导出仍需要在配对后完成。生成图包含局部半透明色块，随附矢量定义采用平整色面重建主要几何，不宣称逐像素一致。

## 中断与恢复

`job.json` 使用原子替换，同一任务由 `.lock` 限制一个修改进程。正常结束释放锁；崩溃后先核对锁内 PID 是否仍在运行，再人工移除遗留锁。运行中的任务不应被其他程序修改。

`awaiting_image` 表示 CLI 正在等待 Agent 交回真实工具输出；没有后台生图进程。工具调用结果不确定时，先检查原调用，不要再次生成。可重新读取 generation-request.json 和 design status；收到原图后执行 design accept。相同请求、相同结果引用、相同 PNG 字节的重复 accept 是幂等的。

`apply_uncertain` 先运行 `design recover`。Bridge 重启会丢失内存请求历史，此时根据任务保存的 request ID 和 `figma-agent:tag` 检查原文件，不能盲目重新创建。已确认失败而需要修改规格重新尝试时，保留原任务作记录，使用新任务显式重试。重新配对后 capture 可以传新 `--session`，但节点任务标签必须一致。

参考 PNG 修改后哈希不一致会阻止 apply/capture，以及重复 accept；程序不会把被替换的图片误报为已接收的原图。已创建重建稿的任务不能更换参考图；新参考图应使用新任务。
