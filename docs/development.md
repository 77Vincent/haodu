# 开发与测试

[项目首页](../README.md) · [架构与实现](architecture.md)

以下命令均在仓库根目录执行。

## 环境

- Chrome 113 或更新版本，满足后台推理使用的 `offscreen` 的 `WORKERS` 原因类型要求。macOS Safari 使用独立后台宿主和构建目标，见 [Safari 开发与安装](safari.md)。
- 桌面 Firefox 140 或更新版本，使用独立后台宿主和本地二进制模型包，见 [Firefox 开发与安装](firefox.md)。
- Node.js 24.13 或更新版本。
- 打包扩展需要 `zip`，macOS 自带；Ubuntu 可安装 `zip`。
- 扩展源码无需编译，也无需安装 npm 依赖。

## 安装和验证

1. 在仓库根目录运行 `npm run release:extension`（需要 Node.js 和 `zip`，macOS 自带 `zip`）。在 `chrome://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”，加载 `dist/extension/`。不要选仓库根目录，否则 Chrome 会把网站、测试和开发文件也计入扩展体积。
2. 打开普通网页，点击好读工具栏图标，在弹出面板中切换「阅读辅助」；也可按默认快捷键 Option + Shift + U（macOS：⌥⇧U；其他平台为 Alt + Shift + U）直接切换。仅打开面板不改变状态。开启时显示红色粗竖线图标，关闭时显示灰色版本，不显示 `ON` 标签。处理中忽略切换请求、不排队；`ERR` 表示失败，悬停可看错误。图标通过 [Chrome action API](https://developer.chrome.com/docs/extensions/reference/api/action#icon) 切换。
3. 切到其他普通网页会沿用全局开关；切回已处理页面不会重复处理。刷新当前页面也会沿用开关。
4. 处理完成后通过面板开关或快捷键关闭。后台标签页不会收到通知，下次聚焦时才清理。使用本地文件时，需要开启扩展的“允许访问文件网址”。

开启好读后拖动面板中的色带，确认已有分隔线与开关同步变色且没有重新切分。通过面板或快捷键关闭时，开关变灰，颜色和粗细滑块禁用、变淡且无法通过 Tab 聚焦；再次开启后恢复调节并保留已选设置。刷新网页或重新打开面板后应保留颜色。色带支持方向键，移到最左端恢复默认的 `#ff1744`。

拖动色带下方的粗细滑块，检查五档均可选择，默认第二档保持原粗度。18px 文字的五档分隔线应依次为 1.5、3、4.5、6、7.5px；已有与新出现的分隔线应一致，调整不重新切分，刷新网页、切换标签页和重开面板后保留设置。

高对比度检查：在 Windows 对比度主题或 Chrome DevTools 的 Rendering 面板中启用 `forced-colors: active`。弹窗色带应隐藏，不占布局空间且无法通过 Tab 聚焦，开关和粗细滑块仍可正常操作；网页分隔线应采用系统文字色（`CanvasText`），普通 DOM 与 open Shadow DOM 一致。退出该模式后自动显示色带并恢复用户选择的颜色，不改动本地设置。深色主题本身不会触发这套规则。

`npm test` 只需要 Node.js，验证扩展与推理相关行为。数据准备、Parquet 语料及训练与推理对齐测试随训练工具迁入私有仓库，本仓库测试无需训练数据。浏览器调试时，运行 `npm run test:serve` 启动本地测试页服务，仅供本机访问，按 Ctrl+C 停止。

```bash
npm test
npm run test:serve
```

- `http://127.0.0.1:8765/test/browser-fixture.html`：普通网页适配器，运行真实 Worker 和模型，显示请求次数、输入长度和状态变化。
- `http://127.0.0.1:8765/test/dom-read-fixture.html`：点击 **Run layout tests**，验证真实浏览器中的长节点、视口边界、内部滚动刷新、处理中缩放、加载完成后出现的正文及标记写入清理。
- `http://127.0.0.1:8765/test/shadow-dom-fixture.html`：点击 **Run shadow DOM tests**，验证同尺寸标题替换后自动恢复标记、晚到及更新的嵌套评论、处理中合并更新、避免标记反馈循环、slot、宿主裁剪、样式和完整清理。
- `http://127.0.0.1:8765/test/divider-style-fixture.html`：点击 **Run divider style tests**，验证微软单选框、复选框的伪元素规则不会把分隔线移到控件左侧；同时检查普通 DOM、影子根、字号继承、五档粗细、调色、隐藏及清理。可在高对比度模式下重复运行，核对系统文字色。

内容监听的历史性能基线及当前基准脚本的运行方法见 [性能记录](../test/content-performance.md)；旧测量值不代表当前源码性能。

## 模型训练

离线数据准备、训练、评估、导出及实验资料维护在私有仓库 [77Vincent/haodu-training](https://github.com/77Vincent/haodu-training)，访问需要仓库权限。本仓库保留浏览器推理代码和导出的 `src/boundary-model-data.js`，可独立测试和打包。

训练代码、数据、检查点及运行任务均已迁入私有仓库，本仓库不再保留本地 `training/` 目录；忽略规则用于防止误拷回并提交。日常开发、测试和扩展构建不依赖私有仓库。

需要更新模型时，在私有仓库训练、验证并导出，再将导出文件写入或复制到本仓库的 `src/boundary-model-data.js`，执行模型对齐验证、测试和扩展打包。两仓库没有 submodule、符号链接或固定相对路径依赖。

模型导出格式为 `haodu-f32-v1`，浏览器全局对象为 `HaoduBoundaryModelData`。使用训练仓库当前的 `training/export_browser_model.py` 导出；历史实验快照中的导出器可能使用过时接口，需要重新导出后再接入。

当前内置模型于 2026-10-20 更新为已完成训练的 epoch 6 最佳权重，选自第 350,028,702 条样本处的验证检查点。完整验证集 2,515,459 条上的准确率为 91.5428%（epoch 5 为 91.4518%），尚未进行该检查点的完整测试集评估；此准确率衡量隐藏标点位置的恢复，不代表实际阅读切分质量。当时仅切换模型权重；后续预处理及递归规则已更新，以 [当前后端说明](architecture.md) 为准，默认置信度门槛仍严格大于 45%。模型身份由导出文件中的 `bestEpoch`、`checkpointSha256` 及配套数值参考测试共同校验。

数值参考由同一组 float32 权重分别在 PyTorch CPU float64 和 Metal float32 下独立计算。浏览器对 CPU 的 logit 容差仍为 `2e-5 + 4e-6 × abs(reference)`，概率容差仍为 `1e-5`。12 条数值参考中，E6 的 Metal float32 概率与浏览器最多相差约 `1.45e-5`，重复运行可复现；Metal 概率检查采用 `2e-5` 容差，同时要求 CPU、Metal 和浏览器的最高分位置与 45% 阈值判断一致。这是数值验证容差，不改变运行时的切分阈值。

## 本地构建

扩展构建入口为 `scripts/build-extension.mjs`，各浏览器的运行文件清单位于 `scripts/extension-targets.mjs`。构建会检查 JavaScript 语法和 manifest 引用，按清单复制运行文件及当前模型；新增运行文件时需要同步更新清单。
