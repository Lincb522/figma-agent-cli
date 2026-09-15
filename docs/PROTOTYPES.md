# 交互动画

让 Agent 在 Figma 中设置真实的原型交互：点击、悬停、按下、拖拽和延时触发，连接页面、弹层或组件状态。动画在 Figma 的 **Present / 原型预览** 中播放。

```text
$figma-agent 给这个设置页面加交互，开关点击后用弹簧动画切换，帮助弹层从底部滑入，并补上关闭和返回。
```

## 先试一个可编辑的开关

在项目目录运行以下命令，或直接让 Agent 执行此示例。需先连接 Figma：

```sh
node dist/cli.js exec examples/interactive-toggle.js
```

会新建 Off / On 两个组件变体、一对 Smart Animate 点击交互，以及放有组件实例的预览画板。两个状态的 `Knob` 图层同名，Figma 可匹配它们的位置变化。选中的画板进入 Present 后，点击开关测试两个方向；主组件仍保留在旁边供编辑。此示例每次执行都会创建新节点，回复丢失时先查询原请求，不要重复运行。

## 给已有节点配置动画

先读取当前交互，保留不需要改动的条目：

```sh
node dist/cli.js prototype get <按钮ID>
node dist/cli.js prototype set <按钮ID> reactions.json
```

`set` 替换该节点的全部交互。下面是 `reactions.json`，将目标 ID 换成同一页内的实际画板 ID：

```json
[
  {
    "trigger": { "type": "ON_CLICK" },
    "actions": [{
      "type": "NODE",
      "destinationId": "目标画板ID",
      "navigation": "NAVIGATE",
      "transition": {
        "type": "SMART_ANIMATE",
        "duration": 0.3,
        "easing": { "type": "EASE_OUT" }
      }
    }]
  }
]
```

- 时间使用**秒**：`0.3` 表示 300 ms；瞬间切换使用 `"transition": null`。
- 触发方式：`ON_CLICK`、`ON_HOVER`、`ON_PRESS`、`ON_DRAG`；`AFTER_TIMEOUT` 还需 `timeout`。鼠标进入/离开/按下/抬起还需 `delay`，进入/离开使用 `deprecatedVersion: false`。
- 动作：`NAVIGATE` 页面跳转、`OVERLAY` 打开弹层、`SWAP` 替换弹层、`SCROLL_TO` 滚动到目标、`CHANGE_TO` 组件变体切换。返回和关闭分别使用 `{"type":"BACK"}`、`{"type":"CLOSE"}`。
- 动画：`SMART_ANIMATE`、`DISSOLVE`、`SCROLL_ANIMATE`、`MOVE_IN`、`MOVE_OUT`、`PUSH`、`SLIDE_IN`、`SLIDE_OUT`。方向动画还需 `direction`（LEFT / RIGHT / TOP / BOTTOM）和 `matchLayers`。
- 缓动：标准 easing、GENTLE / QUICK / BOUNCY / SLOW 弹簧预设，也支持 `CUSTOM_CUBIC_BEZIER` 和 `CUSTOM_SPRING`。运行 `node dist/cli.js schema` 查看枚举。

CHANGE_TO 需要同一组件集内的主组件变体；可以在变体或变体里的热点上设置，再通过实例预览。弹层位置和背景可用 `exec` 配置目标画板的原生 overlay 属性。复杂变量和条件动作可通过 `exec` 的原生 `setReactionsAsync` 设置；专用命令只接受 schema 中列出的动作。

脚本中可调用同一个设置器：

```js
await h.prototype(source.id, reactions);
```

需要清除节点的全部交互时：

```sh
node dist/cli.js prototype clear <节点ID>
```

## 更新与验证

从 0.5.x 升级到 0.6.0 后，需要重启一次桥接，并在 Figma 中关闭、重新打开插件，才能识别新交互命令。原绑定可保留。

写入后用 `prototype get` 检查配置，再进入 Figma Present 验证触发、动画中间态、返回路径和连续操作。静态 PNG 与已保存的交互数据不能代替实际播放检查；本功能不导出 GIF 或视频。

依据 Figma 原生 [Reaction](https://developers.figma.com/docs/plugins/api/Reaction/) 与 [Transition](https://developers.figma.com/docs/plugins/api/Transition/) 接口实现。
