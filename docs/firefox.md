# Firefox 开发与安装

Firefox 版使用 Manifest V3，面向桌面 Firefox 140 及以上版本。与 Chrome、Safari 共用页面处理、模型推理和控件，不引入 UI 库或扩展 API 兼容库。Android 尚未验收。

## 构建与临时安装

需要 Node.js 24.13+ 和 `zip`，无需安装 npm 依赖。

```sh
npm test
npm run release:firefox
```

生成 `dist/firefox-extension/`、`dist/haodu-0.4.0-firefox.zip`、对应 `.sha256` 和 `dist/firefox-extension-release.json`；版本来自根 manifest。不会覆盖 Chrome 或 Safari 的产物。

打开 Firefox 的 `about:debugging#/runtime/this-firefox`，点击“临时载入附加组件”，选择生成目录中的 `manifest.json`，授予测试网站访问权限。在工具栏打开好读并开启，默认快捷键为 macOS 的 Option + Shift + U / 其他平台的 Alt + Shift + U，可在附加组件管理器的“管理扩展快捷键”中修改。面板显示浏览器返回的实际绑定。

临时安装在浏览器退出后失效。更新代码后重新构建、重载扩展并刷新测试网页。

## 平台差异

- Firefox 使用非持久后台页面及标准 Worker，不请求 Chrome 的 `offscreen` 权限。后台和 popup 继续使用共享 WebExtension 实现。
- `src/platform/firefox/background.js` 提供 Worker 宿主及权限拒绝识别。浏览器内部页面、Mozilla 保护的网站和未授权页面不会被强行注入；访问拒绝不会显示为模型错误。
- 为满足 AMO 对可解析文件的大小限制，构建时把模型导出文件拆成小型 JSON 元数据和原始 Float32 二进制权重。Firefox Worker 从扩展包内读取这两个文件，再加载共享后端；没有网络模型下载，也不上传正文。
- 二进制权重与原 base64 解码结果逐字节相同，不重新训练、不量化、不改变阈值。Chrome 和 Safari 仍使用原模型文件。
- manifest 声明固定 ID `haodu@haodu.site` 和 `data_collection_permissions.required: ["none"]`。网页文本只在本地处理；该声明表示不向外传输用户数据。最低版本 140 支持 Mozilla 内置的数据收集声明。
- 当前构建仅配置桌面 Firefox，不声明 `gecko_android`。

## 验证

单元测试覆盖三种宿主、Firefox 权限拒绝及恢复、后台重建、并发与超时、打包依赖、二进制模型与原模型评分完全一致，以及初始化失败时的请求错误。

2026-10-16 在隔离的 macOS Firefox 158 中临时安装真实 ZIP，验证了正文与 open Shadow DOM 切分、动态文字更新、代码区域排除，以及浏览器注册的 Alt + Shift + U 命令。实际扩展的 popup 页面验证了开关、颜色两端、粗细 1–5 档、设置保存与恢复、关闭时禁用和明暗主题；网页分隔线使用了所选颜色和宽度。自动化以扩展页面验证控件，不等同于手工验收所有系统的原生工具栏弹窗。

```sh
npm run test:serve
```

访问 `http://127.0.0.1:8765/test/extension-fixture.html`，通过工具栏控制真实扩展。该页只提供测试正文，不加载或模拟扩展。
