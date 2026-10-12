# Chrome Web Store 发布材料

当前包版本以 `manifest.json` 为准。以下材料对应本仓库的离线推理、全局开关与网站权限实现；提交前需核对实际上传的 ZIP。

## 包与审核状态

- `npm run release:extension` 生成 `dist/haodu-<version>.zip`、对应 `.sha256` 和 `dist/extension-release.json`，文件清单和校验值以本次构建产物为准。
- 模型与运行脚本均随包提供，开关写入 `chrome.storage.local`，网页正文不上传。
- 最近一次用户提供的后台截图为 **Ready to publish**，表示当时提交的版本已通过审核。之后本地模型或代码的变化不属于该已审核包；当前发布状态须以开发者后台为准。
- 本地测试、构建与素材准备不代表上传、审核或发布已经完成。

## 名称与摘要

名称：好读

摘要（与 site 的 `description` 和 manifest 一致，只说明用途和阅读收益）：中文阅读辅助，按人类习惯，将长句划分为短句，让阅读更轻松。

语言：简体中文。选择与阅读辅助最接近的商店分类。

## 详细介绍（实现方式、隐私与使用方法）

使用离线运行的微型神经网络，极致智能、安全、高效且无额外网络开销。

以分隔线标记切分位置，保留原文，网页内容不上传。随页面滚动按需处理，点击工具栏图标即可开启或关闭。

## 单一用途

对应字段：**Single purpose description**。

好读是一款阅读辅助插件。用户开启后，在网页中文长句的适当位置添加视觉分隔线，帮助按较短的语意块阅读；保留原文，不改写或总结内容。切分位置由扩展内置的模型在本机计算，网页文本不上传到外部服务。

## 权限解释

| 字段 | 可填写的说明 |
| --- | --- |
| `offscreen justification` | 在浏览器的隐藏扩展页面中创建 Worker，运行随扩展打包的中文切分模型。多个网页共享同一份模型，避免重复加载。所需脚本、词表和模型权重均包含在扩展包内，网页文本仅在浏览器本地传递和计算。 |
| `scripting justification` | 在用户开启阅读辅助后，向当前符合条件的网页注入扩展包内的阅读脚本和 CSS，用于读取可见的中文文本、添加视觉分隔线，并在关闭时撤销这些标记。注入代码不来自远程服务器。 |
| `storage justification` | 仅使用 chrome.storage.local 保存全局阅读辅助开关（enabled），以便浏览器重启后保留用户选择。不存储网页正文、网页地址、浏览历史或推理结果，不使用 chrome.storage.sync。 |
| `contextMenus justification` | 在扩展工具栏图标的右键菜单中提供「开启好读／关闭好读」，显示当前快捷键，并复用同一个阅读辅助开关。仅添加图标菜单，不读取菜单选中的网页内容。 |
| `Host permission justification` | 用户开启后，需要在其访问及切换到的 HTTP/HTTPS 网页上持续提供阅读辅助，因此申请这两类网页的网站访问权限；只使用 activeTab 无法在未再次点击扩展的其他网页上延续该设置。file:// 权限用于用户另行启用“允许访问文件网址”后处理本地 HTML 文件。读取的中文文本仅在本机计算，不上传到开发者或第三方。 |

**Are you using remote code?**：选择 **No, I am not using remote code**，无需填写远程代码 Justification。脚本、样式、模型词表和权重均随上传的 ZIP 打包，没有外部脚本加载或云端推理；本地 Worker 与本地 `importScripts()` 不属于远程代码。[官方填写说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#declare_any_remote_code)。

## 数据处理与审核说明

扩展读取网页文本用于当前本地推理，不向开发者或第三方传输正文、URL、历史记录或使用统计。除开关设置外，没有持久化的用户数据。商店隐私字段应与网站 `/privacy/` 一致；按提交时表单定义填写，不把“本地读取正文”描述成“完全不接触用户数据”。

**Data usage — What user data do you plan to collect…?**：按当前实现，勾选 **Website content**。这是对本地读取和处理网页文本的披露，不表示上传正文。Google 的[用户数据 FAQ 第 3 项](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)明确要求披露仅在本机处理或存储的数据。

其余数据类别不勾选：当前版本没有身份、健康、支付、认证或位置资料的专项收集，没有通信记录采集、浏览历史列表或用户行为日志功能。网页中出现的普通文本仍可能包含这些内容，不能据此宣称扩展绝不会接触敏感文字；这些文字和其他网页文本一样，只用于当次本地阅读辅助。浏览器标签页事件及滚动事件只触发页面处理，不保存为访问或操作日志。

**I certify that the following disclosures are true**：当前实现符合页面的三项声明，三项全部勾选：不在允许用途外出售或转移用户数据；不用于与单一用途无关的目的；不用于信用评估或贷款。

填写完成后点击 **Save draft**。保存草稿不等于提交审核。

网站地址：<https://github.com/77Vincent/haodu>。确认正式官网 `https://haodu.site/` 公开可访问后，可改用官网地址。

隐私政策地址：<https://github.com/77Vincent/haodu/blob/main/site/content/privacy.md>。该文件已在公开仓库中可访问，与站点使用同一份政策；官网上线后可改为 `https://haodu.site/privacy/`。

支持地址：<https://github.com/77Vincent/haodu/issues>

审核人员无需账号、密码或付费。安装后打开普通中文网页，点击工具栏图标开启，再次点击关闭。产品官网包含静态演示并主动禁止扩展处理，不能用官网验证真实模型注入；应使用普通中文内容页面。

## 图片材料

- 128 × 128 图标：`icons/on-128.png`，已包含在 ZIP。
- 440 × 280 小宣传图：[store-promo-440x280.jpg](assets/store-promo-440x280.jpg)，对应可编辑源文件 [store-promo-440x280.svg](assets/store-promo-440x280.svg)。
- 1400 × 560 横幅宣传图（Marquee）：[store-marquee-1400x560.jpg](assets/store-marquee-1400x560.jpg)，RGB JPEG，无透明通道；对应可编辑源文件 [store-marquee-1400x560.svg](assets/store-marquee-1400x560.svg)。
- 历史参考截图：[store-screenshot-1280x800.jpg](assets/store-screenshot-1280x800.jpg)，摄于 2026-10-01，1280 × 800、RGB JPEG，无透明通道。图中保留旧文案及旧模型效果，仅供参考构图，不作为当前发布材料；提交新版本前，需在更新后的截图用例页运行待发布扩展并重新截图。
- 真实扩展截图用例：[store-reading-preview.html](assets/store-reading-preview.html)。该页没有阅读脚本，也没有人工插入的正文分隔线。通过本地 HTTP 服务打开后，开启待发布扩展，确认分隔线实际出现，再按 1280 × 800 截图。不能将未处理页面或人工标记页面描述为扩展运行结果。

```sh
python3 -m http.server 8096 --bind 127.0.0.1 --directory release/assets
# 打开 http://127.0.0.1:8096/store-reading-preview.html
```

## 官方要求

- [上传包准备](https://developer.chrome.com/docs/webstore/prepare)：ZIP 根目录必须直接包含 manifest。
- [隐私字段与权限解释](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。
- [图片规格](https://developer.chrome.com/docs/webstore/images)。
- [提交发布](https://developer.chrome.com/docs/webstore/publish/)：在开发者后台上传 ZIP、补齐材料并提交审核。
- [官方 API](https://developer.chrome.com/docs/webstore/api/reference/rest)：V2 的上传接口针对已有项目，没有首次创建项目或填写商店文案、隐私表单的接口。[API 使用说明](https://developer.chrome.com/docs/webstore/using-api)仍要求在开发者后台完成商店详情与隐私字段；API 无法替代首次上架的全部后台步骤。
