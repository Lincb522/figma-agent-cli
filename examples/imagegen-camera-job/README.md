# image_gen 相机 App Icon 验证样例

reference.png 是本次内置 image_gen 的真实输出，generation-request.json 和 job.json 保存请求及接收证据。当前 job.phase 为 reference_ready；未提交到真实 Figma 文件。

layout.json 是根据参考图编写的可编辑 Figma 重建定义：独立背景、机身与取景器合并、镜头和闪光灯挖空、独立镜头圆环，以及 Keyline 辅助组。图形主体均为原生几何和布尔操作数。

reconstruction.svg / reconstruction.png 是本地矢量预览。参考图存在半透明色块，矢量版本使用统一色面并近似主要轮廓，不宣称逐像素一致。external-comparison/ 将二者对比，来源明确标记为外部 PNG；它不是 Figma 导出验收。

配对后，在项目根目录运行：

```sh
node dist/cli.js design apply examples/imagegen-camera-job examples/imagegen-camera-job/layout.json
node dist/cli.js design capture examples/imagegen-camera-job
```
