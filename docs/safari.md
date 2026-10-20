# Safari 开发与安装

Safari 构建面向 macOS，复用 Chrome 版的模型、切分、页面处理和控件。当前是开发测试版本，尚未在 App Store 发布，也未验收 iPhone / iPad。

## 构建

在仓库根目录运行（Node.js 24.13+ 和 `zip`）：

```sh
npm test
npm run release:safari
```

产物：

- `dist/safari-extension/`：Safari Web Extension 目录，根目录包含生成的 `manifest.json`。
- `dist/haodu-0.3.0-safari.zip`：同一目录的 ZIP；版本取自根 manifest。
- `dist/haodu-0.3.0-safari.zip.sha256` 与 `dist/safari-extension-release.json`：校验值和文件清单。

这一步不需要 Xcode、签名证书或训练数据。它不会改写根 manifest，也不会覆盖 `dist/extension/` 或 Chrome ZIP。

## 在 Mac 上临时加载

支持临时扩展的 Safari 可直接加载目录或 ZIP：

1. 打开 Safari → 设置，在“高级”中启用网页开发者功能，使“开发者”设置可见。
2. 在“开发者”中点“添加临时扩展”（Add Temporary Extension），按系统提示授权运行未签名扩展。
3. 选择 `dist/safari-extension/` 或 Safari ZIP，在“扩展”中启用好读。
4. 为要测试的网站授予访问权限。未授权的网站不会插入分隔线。
5. 在工具栏打开好读，切换开关；默认快捷键为 Option + Shift + U，实际绑定以面板显示为准。

临时扩展会在退出 Safari 或 24 小时后移除。更新代码后重新构建，在 Safari 设置中重新加载扩展，再刷新测试网页。没有临时加载入口的 Safari 需要通过 Xcode 打包安装。见 [Apple 临时加载说明](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)。

## 实现边界

- 共用 `src/platform/webextension/` 的后台控制、页面消息和 popup；Safari 支持这里使用的 `chrome.*` API，不引入兼容库。
- `src/platform/safari/background.js` 在非持久后台页面中按需启动标准 Worker，不使用 Chrome offscreen API。后台重建后从 `storage.local` 恢复设置，收到推理请求时重新创建 Worker；模型不会因打开面板而加载。
- 使用同一个 `inference-service.js` 管理并发请求对应、5 秒超时、Worker 终止与后续重建。后台被系统卸载时内存中的 Worker 和模型也会消失，不能依赖它们永久驻留。
- Safari 包只请求 HTTP/HTTPS 网站访问。Safari 忽略 `file://` 权限，当前不提供本地文件处理。
- 官网的 `haodu=off` 标记和快捷键预览协作继续生效。
- 快捷键使用各浏览器共同支持的 `suggested_key: { "default": "Alt+Shift+U" }`；Safari 的解析器不读取 Chrome 支持的简写字符串。修改 manifest 后须重新加载临时扩展，普通网页刷新不会更新快捷键注册。
- 粗细轨道由普通容器的伪元素绘制，避免依赖 Safari 不绘制的 `input::before`；官网与两种扩展共用这套样式。
- `Intl.Segmenter` 由浏览器提供，相同权重在不同系统分词下可能产生不同的保护边界；需要用相同例句核对实际结果。

## 验证

自动化测试覆盖 Chrome 回归、Safari 后台启动及重建、推理并发和超时恢复、开关及外观保存、官网预览协作、访问拒绝和发布包引用。测试中的浏览器 API 是模拟接口，不能替代 Safari 原生安装验收。

2026-10-16 在 macOS Safari 26.6.2 中已验证真实临时扩展的注入、模型推理、简繁混排、Shadow DOM、动态文本和代码区域排除；另用同一份控件 HTML/CSS 验证了 Safari 中轨道的明暗主题、禁用状态及开关尺寸。重新加载修复后的临时扩展后，用户在原生工具栏面板确认粗细轨道与快捷键显示正常，Option + Shift + U 可以切换好读。

同日用 Chrome 对照渲染修改前后的实际 popup HTML/CSS，校正了显式内边距引入的 2px 高度差异；面板、开关及两个滑条的尺寸和位置一致，粗细 1–5 档、鼠标两端点击、颜色 0–360 端点、明暗和禁用样式通过检查。这是控件渲染与交互回归检查，不等同于重新安装 Chrome 扩展的完整端到端验收。

启动本地测试页：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

访问 `http://127.0.0.1:8765/test/extension-fixture.html`，使用真实扩展测试开关、变色、粗细、动态文本及 Shadow DOM；该页不加载扩展核心或模型，不会以网页模拟掩盖扩展问题。另一个 `test/browser-fixture.html` 用于独立验证标准 DOM/Worker 核心。

发布前还需检查：跨标签页、关闭再开启、浏览器重启、后台休眠后再次推理、网站权限撤销/重新授予、原生弹窗明暗主题及官网快捷键预览协作。Safari WebDriver 自动化需要在 Safari 开发者设置中开启“允许远程自动化”。

## 正式发布

使用 [Safari Web Extension Packager](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect) 将 Safari 构建产物打包，配置 Apple Developer 账号，通过 TestFlight 测试后提交 App Store。也可使用完整 Xcode 中的打包工具生成项目做本地调试；仅安装 Command Line Tools 不包含这个工具。

当前 ZIP 是 Web Extension 输入包，不是已签名的 Mac 安装应用；生成 ZIP 不代表已完成 Apple 签名、审核或发布。获得正式商店地址后再添加官网 Safari 安装入口。
