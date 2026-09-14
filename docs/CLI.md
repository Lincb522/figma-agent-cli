# CLI 使用参考

首次连接和 skill 安装见 [README](../README.md)。以下命令在项目根目录执行。

## 常用操作

```sh
# 查看文件、选中区域、图层树和已有设计系统
node dist/cli.js document
node dist/cli.js selection --depth 3
node dist/cli.js inspect --depth 2
node dist/cli.js find "Button" --type COMPONENT
node dist/cli.js fonts Inter
node dist/cli.js variables
node dist/cli.js styles

# 创建桌面和手机示例界面；保留返回的 roots 与 keys
node dist/cli.js apply examples/starter-ui.json --out created.json

# 创建带变量绑定的按钮组件、变体和实例
node dist/cli.js exec examples/design-system.js

# 使用上一步返回的真实 ID 替换以下占位符
node dist/cli.js inspect '<node-id>' --depth 3
node dist/cli.js select '<frame-id>'
node dist/cli.js export '<frame-id>' --out preview.png --scale 2
node dist/cli.js export '<frame-id>' --out design.svg
node dist/cli.js patch '<node-id>' props.json
node dist/cli.js image photo.png --parent '<frame-id>' --width 320 --height 180
```

多个文件同时连接时，操作必须使用 `--session <sessions 返回的 ID>`。`find` 默认只搜索当前页，使用 `--parent` 缩小范围。`inspect` 和 `find` 达到结果上限时会返回截断标记。其他页面可以通过 `document` 获取页面 ID，并用 `exec` 调用 `figma.setCurrentPageAsync` 切换。

`--out` 对普通命令保存完整 JSON；对 `export` 保存 PNG/JPG/SVG/PDF 的实际文件。图像导出上限 16 MiB，JSON 请求上限 24 MiB；较大设计应按 Frame 拆分导出。

## 小图标、App Icon 与构造底板

构造底板按提供的参考图制作，包含外框、中心线、对角线、两层同心圆及方形/竖向/横向圆角矩形。辅助线独立锁定，真实造型放在 Artwork 内。

```sh
node dist/cli.js icon grid --size 1024 --dir work/icon-grid
node dist/cli.js apply work/icon-grid/figma.json
# 用返回的 keys.workbench 取出实心模板，随后按返回 ID 执行布尔运算
node dist/cli.js icon shape '<workbench-id>' circle
node dist/cli.js icon shape '<workbench-id>' inner-circle
node dist/cli.js boolean subtract '<circle-id>' '<inner-circle-id>'
node dist/cli.js export '<workbench-id>' --out icon.png
```

默认导出仅包含 Artwork；用 `--with-guides` 导出构造稿。操作不会修改辅助线的可见状态。随包提供 [可打开的底板预览](../examples/keyline-grid/preview.html) 和 [Figma 原生底板定义](../examples/keyline-grid/figma.json)。

```sh
node dist/cli.js icon list
node dist/cli.js icon build search --size 24 --dir work/search-icon
node dist/cli.js icon build examples/marks/camera.json --kind app --dir work/camera-icon
node dist/cli.js icon apply search --size 20 --plate circle
node dist/cli.js icon apply examples/marks/camera.json --kind app --background '#28634B'
```

小图标默认透明背景；App Icon 可选圆角方形、圆形、直角方形背景。着色背景和主体分别编辑，构造辅助线放在独立的 Guides 层；大小、颜色、留白、描边和圆角都可以通过命令指定。`icon build` 输出 SVG、可直接 apply 的图层定义和多尺寸 HTML 预览，不需要 Figma 在线；`icon apply` 写入已连接文件。

先打开 [图标样例](icon-gallery.html) 检查内置图形，详细参数及自定义路径见 [ICONS.md](ICONS.md)。需要根据具体产品做专属图标时，让 agent 编写路径或嵌套 BOOLEAN，不受内置基础图形限制。

## 增强布尔运算

```sh
# IDs 使用实际图层 ID；subtract 的第一个 ID 是被挖空的底图
node dist/cli.js boolean subtract '<base-id>' '<cutout-id>' --name 'Mark'
node dist/cli.js boolean union '<a-id>' '<b-id>' --keep-inputs
node dist/cli.js boolean intersect '<a-id>' '<b-id>' --parent '<frame-id>'
node dist/cli.js boolean exclude '<a-id>' '<b-id>'
node dist/cli.js boolean outline '<stroked-vector-id>' --keep-inputs
node dist/cli.js boolean flatten '<shape-id>' --keep-inputs
node dist/cli.js boolean set '<boolean-id>' intersect

# 独立底板 + 嵌套合并与挖空的 App Icon 示例
node dist/cli.js apply examples/boolean-appicon.json
```

四种布尔运算返回保留操作数的原生 Boolean 节点。处理跨父级和旋转坐标时保留画布坐标；不同父级必须明确 `--parent`。先在副本上生成结果，成功放置后再移除原图层；`--keep-inputs` 保留原图。结果内部操作数是副本，因此返回的 operand IDs 是新 ID；`boolean set` 则保留已有节点和操作数 ID。

扁平化输出单一 Vector，轮廓化把一个节点的描边转成 Vector。创建结果前失败会清理准备节点并保留原图；若删除原图阶段失败，返回 `GEOMETRY_COMMIT_INCOMPLETE` 和需要检查的节点 ID。不能把多个删除操作宣称为数据库事务。

## 先 image_gen 生图，再复刻

```sh
node dist/cli.js design prepare brief.txt --dir work/ui-job --width 1440 --height 1024
node dist/cli.js design generate work/ui-job
# Agent 调用返回请求指定的 image_gen 工具，再交回实际结果
node dist/cli.js design accept work/ui-job /actual/output.png --generation-id '<id>' --result-ref '<tool-result>'
# Agent 查看 reference.png，编写同尺寸原生 UI / 图标图层
node dist/cli.js design apply work/ui-job layout.json
node dist/cli.js design capture work/ui-job
```

`design capture` 检查任务归属和可编辑结构，导出实际 Figma PNG，然后生成透明度对比页、叠加图、差异图和像素指标。图标参考任务使用 `design prepare --kind icon` 或 `--kind appicon`，不要求图标里含有文字。

`design generate` 只准备并保存工具请求，返回 `generated: false`；宿主 Agent 随后实际调用 image_gen。`design accept` 校验请求 ID、提示词快照和 PNG，记录来源与哈希。已有用户图片可以 `design import`，来源为 imported。随包含真实生图记录和矢量重建定义，完整流程与验证边界见 [IMAGEGEN.md](IMAGEGEN.md)。

## 声明式 UI

`apply` 接收一个 `nodes` 树。所有节点都是 Figma 原生可编辑节点；它每次创建新内容，不会通过同名图层隐式覆盖已有设计。`key` 只用于返回这次创建的节点 ID 映射。

```json
{
  "nodes": [
    {
      "key": "screen",
      "type": "FRAME",
      "props": {
        "name": "Projects / Mobile",
        "width": 390,
        "height": 844,
        "layoutMode": "VERTICAL",
        "paddingTop": 24,
        "paddingLeft": 24,
        "paddingRight": 24,
        "paddingBottom": 24,
        "itemSpacing": 16
      },
      "children": [
        {
          "key": "title",
          "type": "TEXT",
          "props": {
            "characters": "项目",
            "fontName": { "family": "Inter", "style": "Bold" },
            "fontSize": 28
          }
        }
      ]
    }
  ]
}
```

支持 Frame、Component、Text、Rectangle、Ellipse、Line、Polygon、Star、Vector、SVG、Instance、Boolean 和 Image。Boolean 使用 `operation` 和至少两个 `children`（从下到上的图层顺序）；Image 使用布局目录内的相对 `imagePath`，或内联 `imageBase64`。图片图层的像素内容不会变成可编辑矢量。SVG 使用 `svg` 字符串，Instance 使用 `componentId` 或已发布组件的 `componentKey`。属性使用 Figma API 原名；颜色填充使用 Figma Paint 对象。文本默认使用 Inter Regular；指定宽度时默认采用自动增高以便换行。字体创建前统一加载，缺失时直接报告错误。

`apply` 限制为 2000 节点、30 层嵌套，先验证规格和字体，创建失败会清理本次创建的节点。它不保证 Figma 多用户编辑事务的隔离，也不回滚通过远程组件导入等 API 引发的库状态变化。

## 完整 Figma API 脚本

`exec` 为复杂设计提供完整 Plugin API 入口，可创建变量和样式、绑定 Token、组合组件变体、实例覆盖、调整布局、创建矢量路径，以及设置原型交互。具体操作仍受 Figma API、文件编辑权限、编辑器版本和当前账号能力限制。

脚本是一个异步函数体，可以直接使用 `await` 和 `return`：

```js
const frame = figma.createFrame();
frame.name = 'Settings';
frame.resize(390, 844);
frame.fills = [h.solid('#F4F6F1')];
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const title = figma.createText();
title.characters = 'Settings';
title.fontSize = 28;
frame.appendChild(title);
title.x = 24;
title.y = 32;
return { frameId: frame.id, titleId: title.id };
```

运行 `node dist/cli.js exec design.js`。通过 `--args args.json` 将 JSON 传为 `args`。

| 绑定 | 用途 |
| --- | --- |
| `figma` | Figma 原生 Plugin API |
| `args` | 从 CLI 传入的 JSON |
| `h.solid(hex)` | 把六位/八位十六进制颜色转换为 SolidPaint |
| `await h.node(id)` | 通过异步 API 取得节点，不存在时报错 |
| `h.inspect(node, depth)` | 输出有深度上限的节点结构 |
| `await h.loadFonts(textNode, font?)` | 加载文本已有字体与可选新字体 |
| `await h.apply(nodes, parentId?)` | 从节点树创建布局 |
| `await h.patch(id, props)` | 修改节点属性 |
| `await h.boolean({operation, ids, parentId?, keepInputs?})` | 原生布尔运算、扁平化、描边轮廓化 |

脚本在 Figma 插件沙箱中执行，不具备 Node.js、文件系统或 DOM。图片从本地通过 `image` 命令传入。返回普通 JSON，不要返回 Figma 节点对象；不要关闭插件、替换消息回调或执行无限循环。`exec` 失败时可能已修改部分图层，不能声称有事务回滚；Figma 的 Undo 可用于人工检查后撤销。

## 连接、超时与恢复

服务只监听 `127.0.0.1:38471`；插件通过 `http://localhost:38471` 访问同一服务，CLI 使用数值 loopback 地址。桥接服务仅接受这两个精确 Host 和对应端口。CLI 凭据写入本项目的 `.figma-agent/session.json`，目录权限 0700、文件权限 0600；CLI 正常读取，不需要 agent 打开它。插件通过一次性配对码获得独立会话凭据，以及保存在 `figma.clientStorage` 的设备授权。服务端只把设备授权的哈希保存在 `.figma-agent/authorizations.json`（0600），原子更新；重启服务后仍可验证。不要提交、分享或手动输出这些运行状态文件。

单文件命令串行执行。暂停接收会阻止后续派发，点击暂停前已经派发的命令仍会执行。多个文件的队列互相独立。断开或关闭插件会结束当前会话，重新打开会使用已保存的授权自动连接。意外断线后持续重试，间隔逐渐增加至最多 15 秒，每次请求有独立超时；CLI 恢复后自动连接。手动断开或点击“停止重连”会取消请求并停止恢复，点击“重试连接”可继续。切换文件共用设备授权，每个文件仍需运行插件；CLI 以独立会话路由，不按文件名合并。异常关闭时旧会话最多约 65 秒后过期。取消此设备绑定会撤销授权并断开所有使用它的会话。Figma 本机存储被清除、插件 ID 改变或服务端授权文件丢失时，需要重新绑定。

`pair` 在已有服务上生成一次性配对码，不需要重启终端。Skill 可正常调用该命令并显示临时六位码；持久凭据不应进入聊天。

| 错误 | 含义与处理 |
| --- | --- |
| `NO_SESSION` | 在目标文件打开插件；有保存的绑定时会自动恢复，首次使用才需配对 |
| `AUTHORIZATION_REVOKED` | 运行 `pair` 获取新码，在插件绑定一次 |
| `AUTH_STORE_UNREADABLE` / `AUTH_STORE_WRITE_FAILED` | 检查状态目录权限或恢复授权文件，再重试；不会自动覆盖损坏的存储 |
| `CONTEXT_TIMEOUT`（面板） | 六秒内未收到有效文件信息，尚未发送配对请求；提供面板中的连接诊断和插件开发控制台首条错误 |
| `STARTUP_FAILED`（面板） | 主线程初始化失败，面板显示实际错误与版本诊断；修复后重新运行插件 |
| `CONTEXT_FAILED`（面板） | 面板显示实际文件读取错误；点击连接会重新读取文件 |
| `AMBIGUOUS_SESSION` | 用 `sessions` 取得目标 ID，再传 `--session` |
| `QUEUE_TIMEOUT` | 命令在执行前过期，已从队列移除 |
| `EXECUTION_UNCERTAIN` | 命令可能仍在运行或已改动画布；先查询 `request <id>` 并检查文件 |
| `REQUEST_ID_CONFLICT` | 同一请求 ID 不能用于不同命令或不同文件 |
| `ROLLBACK_INCOMPLETE` | 自动恢复未能完成，按返回的节点 ID 检查画布 |

用 `--request-id <稳定 ID>` 标记一次操作。连接重试时，同一 ID 和相同参数在同一个 bridge 进程内不会重复派发。超时后的迟到结果仍可通过 `request` 查询。结果历史只存在内存中，重启服务后失效；严禁把新 ID 重试当作对不确定写入的自动恢复。同步无限循环无法被 CLI 强制打断，需要在 Figma 中结束插件。

## 开发和验证

```sh
npm ci
npm run check
npm run test:ui
```

`check` 执行类型检查、真实 HTTP/队列测试、Figma API 合约夹具测试以及构建。`test:ui` 使用已安装的 Chrome（或 `FIGMA_AGENT_CHROME` 指定浏览器可执行文件）验证真实 HTML 面板布局与交互。测试状态和证据见 `docs/VERIFICATION.md`。

构建后重新运行 Figma 开发插件，以加载更新。首次导入开发插件和真实 Figma 画布验证需要在 Figma 客户端里完成。Node/浏览器测试及 API 类型检查不能替代此项；实际可用程度以本地 Figma 端到端验收为准。

## 官方 API 依据

- [插件运行模型](https://developers.figma.com/docs/plugins/how-plugins-run/)
- [插件 Manifest 与本地网络许可](https://developers.figma.com/docs/plugins/manifest/)
- [动态页面加载](https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/)
- [字体加载要求](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/)
- [Figma 布尔操作与图层顺序](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations)
- [完整 Plugin API](https://developers.figma.com/docs/plugins/api/figma/)

此包是本地开发插件，尚未提交或发布到 Figma Community。

## 原型交互动画

`prototype get <id>` 读取交互；`prototype set <id> <reactions.json>` 替换该节点全部交互；`prototype clear <id>` 清除交互。支持原生触发器、页面跳转、弹层、组件状态切换和动画缓动，具体字段用 `schema` 查询。配置和可运行示例见 [交互动画](PROTOTYPES.md)。
