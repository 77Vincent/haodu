# Microsoft Edge Add-ons 发布

面向桌面 Microsoft Edge，使用微软 Partner Center 的 **Microsoft Edge** 开发者计划。不是 Windows 应用商店的应用提交入口；注册和提交扩展免费。

## 发布包

Edge 复用 Chromium 发布包，不单独维护模型、页面处理或 controls：

```sh
npm test
npm run release:extension
```

- 包路径：`dist/haodu-0.2.0.zip`（版本以当前 manifest 为准）。
- 本地加载：`edge://extensions` → 开发人员模式 → 加载解压缩的扩展 → `dist/extension/`。
- 校验清单：`dist/extension-release.json` 和对应 `.zip.sha256`。
- manifest 没有 `update_url`，名称和摘要不含 Chrome 品牌；所用 `offscreen`、`scripting`、`storage` 等 API 在桌面 Edge 的支持列表内。

2026-10-20 暂缓新版本打包，等待新数据训练完成后再确定发布版本。源码保留 **E6 best**，版本号恢复为 0.2.0；Chrome 和 Edge 使用同一 ZIP，SHA-256 以 `dist/extension-release.json` 为准。现有本地 0.2.0 / E6 包与已发布到 GitHub 的 Chrome 0.2.0 / E4 包不同，原发布记录保留。

该次准备已通过 273 项自动化测试、包完整性检查和官网/隐私页可访问性检查。2026-10-20 已完成开发者注册并创建扩展，后台显示上传的 `haodu-0.2.0.zip` 校验完成，概览状态为 **In draft**；发行范围和属性已保存，隐私与商店资料仍显示未完成，后续由用户手动操作。仅凭后台文件名不能确认上传包与本地 E6 包的哈希一致。尚未完成 Edge 原生安装验收，也尚未提交或上架；不要将包校验写成审核通过。

## 账号与提交

1. 打开 [Edge 发布后台](https://partner.microsoft.com/dashboard/microsoftedge/overview)，核对登录的是用户指定的 Microsoft 个人账号。
2. 若未加入 Edge 计划，在 [账号设置 / 计划](https://partner.microsoft.com/dashboard/account/v3/settings/programs) 的 Microsoft Edge 卡片选择开始。按真实情况填写国家/地区、个人/公司类型、发布者名称及联系方式；国家和类型注册后不能直接修改。
3. 账号注册完成后创建新扩展，上传上面的 ZIP。本次面向桌面，不声明未经验证的移动端兼容性。
4. 可见性选公开，分发市场包含中国；填写下方资料和隐私声明。
5. 完成 Edge 原生验收后提交审核。提交成功、审核通过、公开可安装分别记录，以后台实际状态为准。
6. 取得实际公开商店地址后再配置官网 Edge 安装入口；不能使用开发者后台链接作为安装链接。

开发者账号、联系方式、验证码和凭证不写入公开仓库。

## 商店资料

- 名称：好读
- 简介：中文阅读辅助，按人类习惯，将长句划分为短句，让阅读更轻松。
- 语言：简体中文
- 分类：优先选 Productivity / 提高工作效率（以实际选项为准）
- 官网：<https://haodu.site/>
- 支持：<https://github.com/77Vincent/haodu/issues>
- 隐私政策：<https://haodu.site/privacy/>
- 搜索词：好读、中文阅读、阅读辅助、长句切分、离线、分隔线
- 图标：`release/assets/store-logo-300x300.png`（300 × 300，透明背景，从 `icons/divider.svg` 按原比例导出）。
- 截图（均为 1280 × 800）：`release/assets/store-screenshot-1280x800.png`、`release/assets/store-controls-1280x800.png`、`release/assets/store-model-reading-1280x800.png`
- 小宣传图（可选）：`release/assets/store-promo-440x280.png`（440 × 280）
- 大宣传图（可选）：`release/assets/store-marquee-1400x560.png`（1400 × 560）

Edge 上传使用 PNG；上述截图和宣传图由同名 JPG 转换，保持原尺寸和画面，原 JPG 保留供其他引用使用。前两张截图展示官网固定示例及 controls；第三张纯文字切分截图来自 E4 模型。仅转换图片格式，不宣称是 E6 实时推理结果。

### 详细介绍

Edge 要求此字段至少 250 字符；下方完整介绍满足长度要求。中文文案应填写在简体中文商店资料中。

好读是一款中文阅读辅助扩展。阅读网页时，它在较长的中文句子中添加视觉分隔线，将连续的文字划分成更容易阅读的语意块，帮助你把握句子结构。

好读保留原文，不改写、不总结，也不会替换网页中的文字。切分位置由随扩展提供的微型神经网络在本机计算，模型无需联网，不会将网页正文或切分结果发送给开发者或第三方。

安装后，点击浏览器工具栏中的好读图标，在弹出面板中开启阅读辅助。你可以调整分隔线的颜色和五档粗细，让标记适合自己的阅读习惯；开关和外观设置会保存在本机。也可以通过 Alt + Shift + U 切换，macOS 对应 Option + Shift + U，实际快捷键可在浏览器扩展快捷键设置中查看。

好读按页面滚动和内容变化处理可见文字，适用于普通中文网页。关闭后会移除分隔标记，恢复原来的阅读效果。浏览器内部页面、扩展商店等受保护页面不支持处理；产品官网展示的是固定示例。

无需注册账号，无广告，不收集浏览历史，不需要云端推理服务。

## 隐私与权限

单一用途：

> 在网页中文长句中添加视觉分隔线，辅助用户按较短的语意块阅读。保留原文，切分由随扩展提供的模型在本机完成。

- `offscreen`：在隐藏扩展页面中创建 Worker，运行随包提供的模型，供多个网页共享。网页文本只在浏览器本地传递和计算。
- `scripting`：在用户开启后向允许访问的网页插入本地阅读脚本和样式，添加分隔线并在关闭时移除标记。
- `storage`：仅在本机保存开关、颜色和粗细偏好，不使用同步存储，不持久保存网页正文、地址或推理结果。
- 网站访问权限：为用户访问的 HTTP/HTTPS 网页持续提供阅读辅助；本地 HTML 仅在用户另行允许访问文件网址后处理。正文不上传。
- 远程代码：No。脚本、词表和模型数据均随 ZIP 提供。
- 用户数据：如表单包含 Website content / 网站内容，披露本地读取与处理正文，并说明不传出设备。不能因不上传就把访问网页内容描述为完全不处理数据。
- 不出售或转移数据，不用于与阅读辅助无关的用途，不用于信用评估或贷款。

## 审核备注

```text
No account, login, payment or external inference service is required.

After installation, open an ordinary Chinese-language webpage and enable
Haodu from its toolbar popup. Reading assistance is off by default.
Verify the separators, color and width controls, and then turn it off:
the original page text is preserved and the separators are removed.
The shortcut is Alt+Shift+U (Option+Shift+U on macOS), subject to the
browser's shortcut settings.

The product homepage uses fixed demonstration text and opts out of
extension processing. Please test real inference on an ordinary webpage,
not on the homepage, browser-internal pages or an extension store.

All JavaScript and model weights are bundled in the ZIP. The large
src/boundary-model-data.js file contains fixed local model data.
There is no remote code, telemetry or transmission of webpage content.
```

## Edge 原生验收

在 Edge 中加载同一次构建的 `dist/extension/`，确认普通中文网页的模型切分、动态文字、关闭/重新开启、颜色和粗细、快捷键、跨标签页及重启后的设置保存。测试官网和扩展商店时应允许其不处理内容。自动化测试使用的模拟浏览器接口不能替代这一步。

## 官方文档

- [注册开发者账号](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)
- [Chrome 扩展迁移](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- [支持的 API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)
- [发布与图片要求](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
