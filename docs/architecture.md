# 架构与实现

[项目首页](../README.md) · [开发与测试](development.md)

本文说明扩展的处理流程、模块接口及网页兼容边界。下文文件路径均相对于仓库根目录。

## 开关与页面状态

中文阅读辅助扩展，包含 Chrome、Firefox 发布包和 macOS Safari 开发测试包。点击工具栏图标只打开弹出面板，面板内有「阅读辅助」开关、分隔线颜色色带和五档粗细滑块。全局开关、颜色和粗细偏好保存在本地，刷新页面或重启浏览器后仍保留。页面在获得焦点时应用设置，后台标签页不会因设置变化而收到消息或开始处理。运行代码无需编译；发布时通过白名单复制和打包，只包含扩展运行所需文件。

默认在 Chrome 中按 **Option + Shift + U**（macOS：⌥⇧U；其他平台为 **Alt + Shift + U**）可直接切换开关。快捷键使用独立的 `haodu-toggle` 命令，由后台的 `commands.onCommand` 处理，不打开面板。修改 manifest 后需重新加载扩展；实际绑定以 `chrome://extensions/shortcuts` 为准，也可在该页面修改。从旧版 `_execute_action` 命令升级时，应检查新命令的实际绑定。声明方式见 [Chrome 快捷键文档](https://developer.chrome.com/docs/extensions/reference/api/commands)。

预览协作由页面标记决定，不维护域名列表。后台在活动页检查和快捷键操作时，用隔离环境脚本查询 `<meta name="haodu" content="off">`；没有标记则继续普通插件流程。有标记则跳过 reader 注入和真实切分，将实际快捷键写到预览开关的 `data-haodu-extension-shortcut`，并发送 `haodu:preview-shortcut` 事件；快捷键命令另发 `haodu:preview-toggle`，仅改变站点预览。网页收到绑定后停止默认的本地按键处理，避免双重切换；清空绑定也不会回退到默认值。标记页无预览、失去焦点、正在编辑文本或组合输入时不切换，也不回退成全局切换。页面加载期间忽略快捷键，等新文档的标记可读取后再判断；Chrome 拒绝页面访问时无法进行预览协作，但仍可切换全局偏好，不尝试注入 reader。popup 始终控制全局设置。标记检查不读取正文、不加载模型，协作不开放来自网页的后台消息入口。

图标悬停提示显示「好读（已开启 / 按键组合 切换）」或「好读（已关闭 / 按键组合 切换）」，使用 Chrome 实际配置的快捷键，保留 Chrome 返回的按键符号。快捷键在后台启动及检查当前标签页时读取，修改后切回网页即可更新；未绑定或浏览器未返回绑定时省略快捷键，不回退到默认建议值。悬停提示在错误状态下优先显示错误信息。

面板通过消息读取状态、请求设置明确的开关值，并监听本地存储变化以同步快捷键操作。初始设置读取完成且好读开启时才允许调节颜色和粗细；关闭时禁用两项调节器并保留设置。打开面板不会切换状态，也不会注入阅读脚本。后台仅接受来自本扩展面板 URL 的控制消息；面板不直接写存储。开关请求与快捷键共用忙碌保护，处理中不响应、不排队，面板显示后台确认的实际状态。

拖动色带时，面板立即发送颜色请求，后台按接收顺序保存，避免快速拖动或关闭面板丢失最终选择。色带以现有红色 `#ff1744` 为起点，沿完整色相环变化；仅保存整数色相偏移。调色不受 reader 忙碌锁限制，只更新当前页面已有标记上的颜色变量，不改写文本、不重新推理，也不因调色注入脚本。新增标记沿用当前颜色，普通 DOM 和 open Shadow DOM 使用相同规则；工具栏品牌图标及开关状态色保持不变。

粗细滑块保存 1–5 的整数档位，默认第二档。宽度为档位 × 1em / 12，第二档保持原来的 1em / 6；其余档位分别为原粗度的 0.5、1.5、2、2.5 倍。粗细和颜色共用后台保存队列，只更新自有标记的样式；新标记沿用当前设置，不重新切分原文。面板开启状态文字中的分隔线也同步预览粗细。

切回已经处理的页面时，同步当前全局开关、颜色和粗细。开关相同就保留原有标记和处理记录，即使页面在后台期间错过了关闭再开启也无需重做。新标签页在首次聚焦时处理，当前页面刷新后重新处理。后台页面只在下次聚焦时响应，没有向所有标签页广播、遍历后台页面或后台同步任务。

## 核心流程

```text
开启 → 锁定 toggle → read() → process(texts) → write(snapshot, results) → remember(written) → 解锁
滚动 / 缩放 → 重置 200ms 防抖 → 等待当前任务完成且变化稳定 → 读取最新画面
关闭 → 停止监听和等待中的刷新 → clear() → reset()
失败 → 记录 error → 停止监听、关闭并清理 → 解锁，等待用户重试
```

一次处理的单位是任务开始时与可视区域相交、尚未处理的合格文本节点，每个节点保留完整字符串。`read()` 同步固定文本及其 DOM 映射；`process()` 将全部文本作为一个请求交给 Worker；全部结果返回后，`write()` 一次同步写入分隔标记。锁覆盖读取、推理、写入的全过程，处理中点击开关无效。

没有按字符数切分的任务批次、批次间延迟、应用层任务队列或用户取消机制。视口用于选择节点，不裁剪字符，也不限制字符串长度；单个跨多屏的长节点会被完整处理，因此数据量和运行时间没有硬保证。推理请求设有 5 秒超时，超时会终止 Worker 并报错。失败只停止当前页面，保留错误信息，不改变全局开关；切换标签页不会重试，刷新该页面，或在该页面关闭再开启后重试。

页面滚动、普通 DOM 内部滚动容器滚动、窗口及 visual viewport 的滚动和尺寸变化，以及正文容器的尺寸变化都会请求刷新。`ResizeObserver` 监听 body 尺寸；`MutationObserver` 监听文本和子节点变化，捕捉尺寸不变的内容替换。两者都只请求重新读取当前可视区域，未变化的已处理文本仍会跳过。连续变化重置 200ms 防抖定时器；每页只有一个运行中的任务和一个 `refreshPending` 布尔标志，只有任务完成且定时器到期后才开始下一次读取。中间画面不排队，当前任务不取消。关闭或失败时移除监听、清除定时器和待刷新标志。已捕获的快照不随页面变化。此处“一次操作”指调度和锁的单位，不代表网页 DOM 被冻结：页面自行改变的源文本不会写入旧结果。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/app/reader.js` | 定义应用接口；`createReader()` 协调 read/process/write，通过 `toggle(flag)` 管理状态、开关和防抖刷新 |
| `src/frontend/read.js` | `read()` 跳过无关 DOM 分支，保留至少部分可见的完整文本节点，生成固定快照和 DOM 映射 |
| `src/frontend/dom-tree.js` | 遍历普通 DOM 和嵌套的 open Shadow DOM；跨 slot 和 shadow host 查找显示层级中的父元素 |
| `src/frontend/viewport.js` | `readViewport(document)` 捕获可视区域边界；`watchViewport(document, onChange)` 监听滚动、视口及 body 尺寸变化并返回取消监听函数 |
| `src/frontend/content-changes.js` | 观察文档及读取时发现的 open shadow root 的文本和子节点变化；请求刷新，并在同步写入标记时暂停观察 |
| `src/frontend/visibility.js` | `createVisibilityFilter(document, viewport)` 提供 `shouldSkipSubtree(element)` 和 `getVisibleArea(node)`；负责分支排除、隐藏判断及祖先溢出裁剪，样式缓存仅用于本次读取 |
| `src/frontend/processed-text.js` | 独立记录已处理文本节点及其当前值、父节点；由 reader 在写入成功后记录、关闭或失败时重置 |
| `src/frontend/write.js` | 校验源节点、插入标记及 shadow root 样式，返回成功处理的文本片段；`setMarkerColor()` / `setMarkerWidth()` 更新自有标记的颜色和粗细，`clearMarkers()` 清理，包括已脱离文档的根 |
| `src/backend/chunker.js` | `process(texts)` 返回每段文本的 UTF-16 分隔位置；负责标点分句、词语保护和模型驱动的递归切分 |
| `src/backend/inference.js` | 纯 JavaScript CNN 数值计算，只接受模型数据输入 |
| `src/boundary-model-data.js` | 导出的模型结构、词表和权重 |
| `src/inference-worker.js` | Worker 入口，将一个完整文本数组交给 backend，返回一份完整结果 |
| `src/inference-service.js` | 管理标准 Worker 生命周期、请求与响应对应、超时及错误 |
| `src/start-reader.js` | 每页的通用装配入口：将 DOM 工具和适配器注入 reader，再连接控件 |
| `src/start-inference.js` | 推理宿主的通用装配入口：创建服务、连接宿主消息 |
| `src/platform/webextension/background.js` | 共用后台：保存全局设置、聚焦及加载完成时检查当前页面、按需注入脚本和路由消息 |
| `src/platform/chrome/background.js` | Chrome 宿主：创建 offscreen 页面并转发推理，处理 Chrome 专属访问限制，再加载共用后台 |
| `src/platform/safari/background.js` | Safari 宿主：在非持久后台页面中创建推理服务，处理 Safari 网站访问限制 |
| `src/platform/firefox/background.js` | Firefox 宿主：在 MV3 事件页中创建推理服务，处理网站访问拒绝 |
| `src/platform/firefox/inference-worker.js` | 从包内加载模型元数据和二进制权重后调用共享后端 |
| `src/popup.html`、`src/popup.css`、`src/platform/webextension/popup.js` | 工具栏弹出面板、开关与分隔线外观偏好的状态同步 |
| `src/reader-controls.css` | 扩展面板与站点预览共用的开关、色带、粗细滑块样式 |
| `src/divider-color.js` | 面板、后台和站点预览共用的色相校验、颜色换算和连续色带 |
| `src/divider-width.js` | 共用的五档粗细校验和默认值 |
| `src/platform/webextension/content.js` | 将 WebExtension 消息转换成 `reader.toggle(flag)` / `status()`，转发推理请求与状态通知 |
| `src/platform/chrome/inference.js` | 提供 Worker 地址，将 Chrome 消息连接到推理服务 |
| `src/platform/interfaces.js` | 适配器的 JSDoc 接口说明，无运行时代码 |
| `src/inference.html` | Chrome 隐藏页面，承载推理服务 |
| `src/content.css` | 分隔线样式：高度 `1em`、宽度 `calc(1em / 6)`，按所在文字的字号等比例缩放 |
| `manifest.json` | Chrome 权限、工具栏、快捷键和后台入口 |
| `icons/` | 透明底粗竖线品牌图标；开启为红色、关闭为灰色，忙碌状态不改变外观。SVG、PNG 和网站 favicon 由 `npm run icons:generate` 统一生成 |
| `test/` | 单元测试、集成测试与浏览器测试页 |

推理沿用训练的中文 proxy `，。；！？…` 识别、数字例外及 NFKC／空白归一化规则，并额外按原文顿号 `、` 和非数字用途的中文冒号 `：` 预分段，分别判断各片段是否需要模型切分。顿号、冒号保留在前一片段及其模型输入中，不新增训练标签，也不在这些边界画红线。例如“整部电影讲的其实就一件事：一群摔过很多次、”先分成 12 字的引言和 7 字的并列项，两者均不足 13 个视觉单位，直接跳过模型。数字间的冒号（如 `８：３０`、`1 ： 2`，允许水平空白及右侧数字的正负号）、英文及兼容标点继续作为上下文；带符号数值间的中文逗号保留为数字上下文。换行是独立屏障，不跨行拼接上下文。原文和 UTF-16 坐标始终保留。实现见 [后端预处理](../src/backend/chunker.js)，输入对齐测试在私有训练仓库维护。

一个或连续多个空格的左右紧邻字符都是汉字时，也作为后端预切分边界，分别判断两侧片段。支持 Unicode 空格类 `Zs`，包含普通空格、不换行空格和全角空格；英文、数字或标点旁的空格仍作为上下文。整段空格保留在前一片段的原文中，模型输入沿用末尾空白清理，不在空格处画分隔线。这只改变推理预处理，不修改训练 proxy、数据或模型权重。

至少 13 个视觉单位的子句才调用模型；视觉长度计入汉字、数字表达式和 Latin 单词。长子句按最多 256 个 Unicode token 的窗口推理，窗口额外携带卷积所需的左右上下文（当前各 16 个 token），每个候选边界只保留一次完整上下文的评分。每次切开后，仍至少有 13 个视觉单位的左右片段分别重新输入模型；新评分使用各自片段的上下文及边界。在当前片段的全部 gap 上计算 softmax，默认统一要求概率**严格大于 45%**。模型切点在原文中紧邻的左右字符都必须是汉字，且须通过浏览器分词的词内保护；符合条件的位置直接按模型原始 logit 排序，同分时取当前片段内靠前的位置。过滤受保护的位置不会再次归一化概率。

片段不足 13 个视觉单位，或没有任何符合“相邻汉字且不在词内”的合法切点，直接跳过模型；这也适用于递归产生的子片段。例如，英文通知仅夹着受词内保护的中文姓名时无需推理。有合法切点时仍对完整片段打分、在全部 gap 上归一化；重新推理后没有通过置信度门槛的合法切点才停止，提前检查不改变切分结果。当前模型按每条样本一个目标断点训练，softmax 是相对概率；重新推理也不使门槛成为实际正确率保证。`src/backend/chunker.js` 中的 `MIN_SPLIT_CONFIDENCE` 是运行默认值；`chunkText`、`chunkTextByClause`、`buildVisualChunks` 和 `process` 无需传参即可使用 `recursive-model`。显式传入 `minConfidence` 会覆盖默认置信度，供离线比较；`0` 关闭置信度门槛，但仍保留长度门槛。原文坐标及词内保护沿用原始子句，子片段重新推理会增加模型调用；这些计算不拆分视口请求，也不影响 toggle 的锁。

当前算法见 [后端预处理](../src/backend/chunker.js)。公开扩展仅支持 `unicode-context-v1` 模型输入和递归重新推理；旧的仅汉字输入、固定评分和对子片段重新归一化旧评分的实验实现与记录保留在私有训练仓库。

## 模块如何连接

英文品牌统一为 `haodu`；代码命名空间使用 `Haodu`，扩展消息使用 `HAODU_` 前缀，DOM 标识使用 `haodu-` 前缀。网站跳过标记为 `<meta name="haodu" content="off">`，与扩展读取规则同时维护。

核心只使用标准 DOM、Worker 和 JavaScript，不调用扩展 API。通用扩展 API 调用集中在 `src/platform/webextension/`，各浏览器宿主差异分别位于 `src/platform/chrome/`、`src/platform/safari/`、`src/platform/firefox/`。Safari 和 Firefox 支持共用代码使用的 `chrome.*` 命名空间。普通脚本通过 `globalThis.Haodu` 暴露接口，后台按以下顺序加载页面代码：

```text
frontend/dom-tree.js → frontend/viewport.js → frontend/visibility.js → frontend/processed-text.js
  → frontend/read.js → frontend/write.js → frontend/content-changes.js → app/reader.js
  → platform/webextension/content.js → start-reader.js
```

`start-reader.js` 注入依赖：

```js
const adapter = Haodu.createReaderAdapter();
const changes = Haodu.createContentChanges(document, Haodu.markDirtySources);
const reader = Haodu.createReader({
  read: () => {
    changes.withoutObservation(() => {
      const { forgotten, preserved } = Haodu.removeStaleMarkers();
      Haodu.forgetProcessedText(forgotten);
      Haodu.rememberProcessedText(preserved);
    });
    return Haodu.read(changes.observeRoot);
  },
  process: adapter.process,
  write: (snapshot, results) => changes.withoutObservation(() =>
    Haodu.write(snapshot, results, adapter.markerStyleUrl)),
  clear: Haodu.clearMarkers,
  remember: Haodu.rememberProcessedText,
  reset: Haodu.clearProcessedText,
  watch(onChange) {
    const stopContent = changes.watch(onChange);
    const stopViewport = Haodu.watchViewport(document, onChange);
    return () => { stopContent(); stopViewport(); };
  },
  publishState: adapter.publishState,
});
adapter.connect(reader);
```

应用在 `app/reader.js` 中定义 `Reader` 和 `ReaderState` 接口，只提供 `status()` 和 `toggle(flag)`。`toggle(true)` 请求开启，`toggle(false)` 请求关闭。相同状态不重启；忙碌时直接忽略所有开关请求，不保存待应用设置。失败后重复 ON 不重试，收到 OFF 再 ON 或刷新页面才重试。按钮调用方负责计算目标状态，并在忙碌时忽略点击。

适配器只翻译接口：将设置消息传给 `reader.toggle(flag)`，将 `PING` 转成 `status()`，转发整个 `texts` 数组并提供分隔线样式地址。`publishState()` 仅发送通知，不再触发任何 reader 控制操作。DOM 引用始终留在页面里。Chrome、Safari 和 Firefox 加载同一份 WebExtension 页面适配器。

后台使用 `chrome.storage.local` 只保存 `{ enabled, dividerHue, dividerWidth }`，按钮以全局开关为准，页面错误单独显示。标签页切换、浏览器窗口聚焦及当前标签页加载完成时，只查询当前窗口的活动标签页；`PING` 检查页面是否已有 reader，随后通过 `APPLY_SETTING` 传递目标布尔值、颜色和粗细。reader 负责忽略相同状态和忙碌时的开关请求。若聚焦时 reader 仍在处理，开关同步请求会被忽略，颜色和粗细仍会更新；任务完成后不会补做开关同步，下次空闲时的聚焦检查再应用全局状态。当前页面忙碌时，开关操作不响应；其他后台页面不会被查询。

后台同时只做一次活动页检查。检查期间若再次聚焦或页面刷新完成，只设一个 `checkPending` 标志；当前检查结束后重新查询最新活动页和当前文档，不保存中间标签页队列。旧文档的延迟状态回复不再让新文档错过检查。

自动处理新网站需要 manifest 中的 HTTP、HTTPS 和本地文件访问权限，替代原来只覆盖用户点击页面的 `activeTab`；修改 manifest 后需要重新加载扩展。本地文件还需打开“允许访问文件网址”。浏览器内部页面、Chrome 商店、未获访问权限的页面会静默跳过，不显示 `ERR`，也不改变全局开关。相关权限要求见 [Chrome 内容脚本文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#inject-programmatically)。

网页可在初始 HTML 的 `<head>` 中加入以下标记，禁止扩展处理该页：

```html
<meta name="haodu" content="off">
```

即使全局开关开启，页面也不会注入 reader、启动文本处理或请求模型推理；刷新、切换标签页及再次开启扩展均遵守此标记。此页的快捷键仅转交给预览控件，没有控件则不执行，不改变全局设置。没有标记的网页仍正常处理。官网全站默认添加该标记，正式部署、本地预览和临时部署使用同一规则，无需配置域名。

Shadow DOM 中的标记加载同一个 `src/content.css`，该文件在 manifest 中声明为可访问资源，前端无需调用 Chrome API。

Chrome 的推理消息路径：

```text
页面适配器 → Chrome 后台 → inference.html → inference-service → Worker → backend
```

隐藏页面和 Worker 按需创建，多个页面共享模型；服务使用请求 ID 匹配各页的结果。全局关闭立即清理当前页面，后台页面保留原样，直到下次聚焦再清理。已经开始的任务仍会完成，原有滚动和缩放处理逻辑不变。Worker 超时或崩溃会拒绝共享 Worker 上尚未完成的请求，后续请求可创建新 Worker。

Safari 的推理路径为「页面适配器 → Safari 后台页面 → inference-service → Worker → backend」。Safari manifest 由构建入口生成，移除 `offscreen`、Chrome 最低版本和文件访问声明，按顺序加载共用设置工具、推理服务、Safari 宿主及共用后台。后台文档非持久；每次重建都重新读取已保存设置，模型仅在下一次推理时加载，不依赖永久驻留。具体安装与验收见 [Safari 开发与安装](safari.md)。

Firefox 同样通过后台事件页运行推理 Worker。为满足 AMO 对可解析文件的大小限制，构建将模型分成 JSON 元数据和原始 Float32 二进制权重；Worker 仅从扩展包内读取，随后调用同一套 backend。权重字节和评分不变，Chrome、Safari 继续使用原 base64 导出文件。固定扩展 ID、最低版本及不对外传输数据的声明只写入 Firefox manifest。安装与验收见 [Firefox 开发与安装](firefox.md)。

普通网页测试页提供另一套适配器，复用相同的 reader、DOM、启动入口和推理实现。`jsconfig.json` 与 JSDoc 用于编辑器提示，无需编译；各浏览器的打包白名单与 manifest 变体统一维护在 `scripts/extension-targets.mjs`。

## DOM 数据接口

`read()` 返回固定快照：

```js
{
  texts: ["需要处理的可见中文"],
  sources: [{ node, parent, text, start, end }],
  viewport: { left, top, right, bottom }
}
```

`sources` 与 `texts` 一一对应。`text` 保存读取时完整的节点值，`start` 固定为 `0`，`end` 为完整字符串的 UTF-16 长度；`texts[i]` 等于 `source.text.slice(start, end)`。`process(texts)` 返回同样顺序的 `number[][]`，每个偏移严格递增、位于对应输入内部，并保留完整的 Unicode 字符。

`read.js` 调用 `dom-tree.js`，使用 `TreeWalker` 遍历元素和文本，并递归进入 open shadow root。遇到代码、控件、可编辑区域或不能显示的分支时，直接跳过其后代；对其余文本节点，只要 `Range.getClientRects()` 的任一文本矩形与允许显示的区域相交，就保留整个节点，一节点一条输入，不再查找可见字符的起止位置。仅保留含中文的字符串；快照中的 `parent` 可以是元素或直接容纳文本的 shadow root。

`visibility.js` 判断分支是否应排除，并计算视口与祖先滚动容器的矩形交集；`viewport.js` 捕获视口尺寸。对应的独立测试位于 `test/visibility.test.js` 和 `test/viewport.test.js`，`test/dom-read.test.js` 验证分支跳过、整节点选择和快照行为。

写入前检查节点连接、父节点和完整原文。分隔位置从后往前写入，原有标签与文本保留。writer 只返回成功处理的文本片段，由 reader 调用 `remember()` 记录；没有分隔点的节点也会记录，过期快照跳过的节点不会记录。后续读取跳过未变化的已处理节点，避免重叠视口重复推理或插入重复标记；空快照不调用后端。关闭时按原始文本节点分组撤销写入并清空已处理记录，再次开启会重新处理。处理记录使用 `WeakMap`。

writer 使用现有 `markedSources` 集合保存每个原始文本节点的切分记录：`sequence[0]` 是原节点 A，其余文本是衍生片段，记录同时包含分隔标记、切分后的文本值及原节点后方的相邻节点。页面对成员的文字写入会标记 dirty，即使赋值与当前片段相同；移除及重新插入文本成员分别留下记录。插件自己的同步写入不参与标脏。

自动刷新和关闭共用按组清理规则：整组文字未改且文本成员完整、有序时，`unwrite` 把原文恢复到同一个 A，再删除衍生片段和 divider；A 被改写且衍生片段未被改动时，`discard` 保留 A 的新值，只删除旧衍生内容。A 被删除且剩余片段仍完整、未被改动时，也丢弃旧片段，不重新插回 A。只有 divider 被移除或移动时，仍可还原完整文本组。任何路径都不对父元素调用 `normalize()`，同一父元素下的其他原始文本节点保持独立。

如果页面只删除插件拆出的文本片段，而 A 未被写入或移动，丢失的片段未被编辑或重新插入，且剩余节点顺序及组后方边界仍与记录一致，则把完整原文恢复到 A，并暂停处理 A，直到页面再次修改它或关闭后重新开启。这样可以处理网页清除额外子节点造成的截断。若页面已插入替代内容、改写 A 或接管衍生片段，则不执行这项恢复，以免重复文字或还原过期内容。

兼容约定是：页面写入 A 的新值代表整条原始文本的新完整内容，空字符串代表整条清空；仅修改原节点前半段的页面不适用此约定。若页面修改了衍生片段、独立移动了文本成员或插入节点打断了组内结构，则只移除该组 divider，保留现存文字及节点身份。装配层将这些仍连接的冲突文本记为已处理，暂停插线，直到其文字或父节点再次变化；关闭后重新开启也会重新评估。`removeStaleMarkers()` 返回待清除处理记录的 `forgotten` 和需要暂停的 `preserved`，装配层先清除、再记住；`read()` 本身仍然只读。行内 `splitText()` 仍会改变网页 DOM，这些规则不保证兼容所有基于子节点位置的页面操作。

`processed-text.js` 的记录是弱引用，writer 保存的切分记录、标记和 shadow 样式则是强引用。过期切分记录和标记在下一次读取前释放；shadow 样式保留到关闭或刷新页面。

`content-changes.js` 观察文档及已发现的 open shadow root 的 `childList` 和 `characterData`。先把页面变化交给 `markDirtySources`，已有切分组的变化会请求清理，包括 ASCII 片段的相同值写入；其余变化仍按中文内容过滤。含中文的文本新增、移除、替换和修改、旧值含中文但新值被清空、页面自行移除分隔标记、新增带 open shadow root 的宿主都会请求读取。未涉及已有分组的脚本、样式、代码、控件、可编辑区域及纯数字计时变化不触发内容刷新。不观察属性：尺寸不变的样式、可见性或 slot 分配变化仍需等下一次视口事件。只在 shadow root 内传播的滚动事件也不会触发刷新。

装配层在同步写入及清理期间暂停内容观察，操作前先处理已经排队的页面变化，操作后立即恢复观察，避免标记造成反馈循环；页面随后自行修改 DOM 仍会被捕捉。关闭或失败时，先消费尚未送达的页面变化，再断开观察器并按组清理，避免立即关闭时遗漏 dirty 状态。内容观察器会释放脱离文档的 shadow root。

当前处理当前文档的普通 DOM 和 open Shadow DOM；不进入 closed shadow root 或 iframe，不判断遮挡层、CSS 蒙版或任意旋转后的裁剪形状。新 shadow root 在下次读取时发现；如果已存在的宿主稍后才调用 `attachShadow()`，且没有已观察到的 DOM 或尺寸变化，则仍需等下一次视口事件。不能仅凭父元素在屏幕外就跳过整个分支，因为其定位后代仍可能可见；`visibility:hidden` 也可能被后代覆盖。初次发现节点的耗时仍受文档规模和浏览器布局成本影响。
