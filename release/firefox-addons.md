# Firefox Add-ons 发布

使用 Mozilla Add-ons（AMO）的公开分发，桌面 Firefox 140+。固定扩展 ID 为 `haodu@haodu.site`；后续更新继续使用同一项目和 ID。

## 提交记录

2026-10-16 提交的 **0.2.0 已通过审核并公开上架**。2026-10-20 核对 AMO 公开接口：扩展及当前版本文件状态均为 `public`，当前版本为 0.2.0，未被禁用。仅发布桌面 Firefox 140+，许可证为 MIT；审核源码附件和版本说明已保存。

- [公开安装页面](https://addons.mozilla.org/firefox/addon/haodu/)
- [版本与审核状态](https://addons.mozilla.org/en-US/developers/addon/haodu/versions/6585097)
- [商店资料管理](https://addons.mozilla.org/en-US/developers/addon/haodu/edit)
- 当时提交的 ZIP SHA-256：`6aedf34ee1251f37fffcf5f3fba48a2d6bf8b5986256f2fae01c645224608338`

本地 **0.3.0 / E6 best** 是后续待发布版本，尚未提交 AMO，不包含在上述审核结果内。官网源码已配置公开安装链接，需要重新部署后才会在生产站点生效。

## 准备

```sh
npm test
npm run release:firefox
npm exec --yes --package=web-ext -- web-ext lint --source-dir dist/firefox-extension
```

`web-ext` 仅用于发布校验，不是运行时依赖。当前待发布包为 `dist/haodu-0.3.0-firefox.zip`，版本、文件清单和校验值见 `dist/firefox-extension-release.json`。ZIP 根目录是 manifest，不上传整个仓库或 `dist/`。

当前 `web-ext 10.8.0` 即使未声明 Android，也会针对桌面最低版本 140 给出 `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` 警告：Android 的数据收集声明需要 142。桌面 Firefox 140 支持该声明；本包只提交桌面 Firefox。不要为消除此警告添加 `gecko_android`，该键会使 AMO 强制启用 Android 分发。

开发者账号需要开启两步验证。验证码、恢复码、API 凭证不放入仓库。构建与本地验证见 [Firefox 开发与安装](../docs/firefox.md)。

## 商店材料

- 名称：好读
- 简介：中文阅读辅助，按人类习惯，将长句划分为短句，让阅读更轻松。
- 官网：<https://haodu.site/>
- 支持：<https://github.com/77Vincent/haodu/issues>
- 隐私政策：<https://haodu.site/privacy/>
- 图标：`icons/on-128.png`
- 截图：沿用 `release/assets/` 中的首页、controls 和模型切分截图，发布前核对实际效果。
- 平台：桌面 Firefox；不勾选未经验证的 Android。
- AMO 许可证：MIT（用户于 2026-10-16 确认）。商店许可选择不等于仓库已补充 `LICENSE` 文件。

说明文案：

> 好读是一款中文阅读辅助插件。保留原文，在长句中按语意添加分隔线，让阅读更轻松。模型在本地离线运行，不上传网页文本。通过工具栏面板或快捷键开启、关闭，可调整分隔线颜色和五档粗细，偏好保存在本机。

## 审核说明

扩展无需账号。安装后默认关闭，打开普通中文网页并在工具栏开启好读。默认快捷键为 Alt + Shift + U（macOS 为 Option + Shift + U）。Mozilla 保护的网站不允许注入，请使用普通网页或仓库中的 `test/extension-fixture.html`。

JavaScript 为可读源码，不混淆、不压缩，不加载远程代码。包内 `src/boundary-model-weights.bin` 是固定 Float32 模型数据，不是可执行代码；`src/boundary-model-data.json` 描述词表、张量形状和参数。构建脚本从公开仓库的 `src/boundary-model-data.js` 无损生成这两个文件，其他代码按明确清单复制。无需私有训练仓库即可复现发布包。

本地文本处理不产生对外数据传输；`data_collection_permissions` 声明 `none`。网站权限用于按用户开启状态处理网页，`scripting` 用于注入阅读脚本和样式，`storage` 仅保存开关、颜色、粗细。Firefox 包不申请 `offscreen`。

AMO 的源码问题包含“处理文件并生成扩展内文件的工具”，因此本构建选择 Yes。当前待发布包对应的审核源码包为 `dist/haodu-0.3.0-firefox-source.zip`，包含 Firefox 构建所需源文件、原始模型导出、构建脚本和 `README.md` 复现说明，不含训练数据或凭证。提交前须在空目录中解压并运行构建，确认产物 SHA-256 与上传的扩展 ZIP 完全一致；这是独立的源码附件，不替代安装包。

上传校验通过、提交审核、审核通过和公开上架是不同状态。以 AMO 后台为准；拿到实际公开地址后再配置网站的 Firefox 安装入口。
