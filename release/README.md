# 好读发布

网站与插件独立发布。网站只上传静态页面；插件只上传运行文件。不要把仓库根目录或整个 `dist/` 上传到任意一方。

插件目前发布于 Chrome Web Store，另提供 macOS Safari 开发测试包。本仓库维护插件打包、站点构建和商店材料；官网的生产发布脚本、云资源配置及运维记录维护在私有仓库 [77Vincent/haodu-release](https://github.com/77Vincent/haodu-release)。公开仓库可独立开发、测试和构建，不需要该私有仓库或云端凭证。

## 1. 构建插件

环境：Node.js 24.13+ 和 `zip`（macOS 自带；Ubuntu 可安装 `zip`）。无需 npm 依赖、Python 或任何训练数据。

```sh
npm run release:extension
```

产物：

- `dist/extension/`：加载已解压的扩展程序时选择这个目录。
- `dist/haodu-0.2.0.zip`：提交商店的 ZIP，名称取自 manifest 版本。
- `dist/haodu-0.2.0.zip.sha256`：ZIP 校验值。
- `dist/extension-release.json`：版本、体积、每个文件的 SHA-256 清单，不放入 ZIP。

`scripts/build-extension.mjs` 使用 `scripts/extension-targets.mjs` 的明确文件清单，拒绝符号链接，检查 JS 语法及 manifest 引用，并固定文件时间和权限。ZIP 不含顶层 `extension/` 目录，也不含 training、site、测试或开发配置。新增运行文件时，需要同时更新打包清单。

构建直接复制当前 `src/boundary-model-data.js`，不会重新导出或替换正在使用的模型。后续升级时同步修改根 `package.json` 和 `manifest.json` 的版本，再构建新的 ZIP。

Safari 使用 `npm run release:safari`，独立输出 `dist/safari-extension/`、`dist/haodu-0.2.0-safari.zip` 及对应校验清单，保留 Chrome 产物。该 ZIP 可用于 Safari 临时加载和 Apple 打包流程，不是已签名安装应用。Safari 尚未上架；完整步骤见 [Safari 开发与安装](../docs/safari.md)。

## 2. 构建站点

已验证工具：Hugo Extended 0.164.0、Node.js 25.9.0；主题依赖由 `site/package-lock.json` 锁定。Node.js 24.13+ 也在项目声明的支持范围内。

只检查本地构建产物时：

```sh
npm --prefix site ci
npm run release:site:preview
python3 -m http.server 8088 --bind 127.0.0.1 --directory dist/site-preview
```

访问 `http://127.0.0.1:8088/`。`dist/site-preview/` 使用站点根路径、noindex 和禁止抓取的 robots，只用于检查产物，不能作为最终 SEO 发布包。正式构建使用：

```sh
npm --prefix site ci
npm run release:site -- --base-url https://haodu.site/
```

CI 也可以通过 `SITE_BASE_URL` 传入地址。正式地址必须包含 HTTPS；若有子路径，包含子路径。发布入口会拒绝缺失地址及常见占位域名。`site/config/_default/hugo.toml` 的本地默认占位地址不用于正式发布。

将 **`dist/site/` 内的文件**上传到静态网站根目录，保留 CSS、JS、字体与图片路径结构。不要上传 `site/` 源码目录或插件 ZIP。中文首页为 `index.html`，英文首页为 `en/index.html`，错误页为 `404.html` 和 `en/404.html`，中文隐私页为 `privacy/index.html`。中英文首页共用同一份中文 demo。

托管服务要支持目录首页（`/privacy/` → `privacy/index.html`）和真正的 404 状态，不要配置所有路径回退到首页。为 HTML、CSS、JS、SVG、PNG、字体设置正确的 Content-Type。HTTPS 证书必须覆盖正式域名。

HTML 建议 `Cache-Control: no-cache`；带内容指纹的 CSS/JS 可以长缓存；favicon 等无指纹资源使用短缓存。此站点所有构建资源均由本站提供，部署不依赖浏览器访问 npm、GitHub 或外部字体 CDN。

## 3. 上架顺序

1. 确认[官网](https://haodu.site/)与[隐私政策](https://haodu.site/privacy/)可访问。网站更新后验证首页、`/en/`、语言切换、`/privacy/`、404、CSS/JS、明暗切换与演示控件。
2. 用 `dist/extension/` 做最终安装验证，避免与旧的开发版同时启用。检查开关、页面刷新、滚动、跨标签页和本地推理；官网应保持静态演示。
3. 在 Chrome Web Store 开发者后台使用已有的“好读”项目上传 ZIP；后续版本继续使用同一项目。参考 [商店材料](chrome-web-store.md) 核对文案、权限、隐私页、支持链接、真实截图与宣传图。
4. 获得商店项目 ID 后，保留它作为后续升级的同一项目；不要把本地开发扩展的 ID 当成商店 ID。
5. 商店详情页可公开访问后，替换 `site/config/_default/params.toml` 中 `chromeWebStoreURL` 的占位链接并重新部署站点。安装按钮中文显示“现在安装”，英文显示“Install now”，所有浏览器直接使用该链接。

网站已上线，商店发布单独推进。目前安装按钮仍按产品约定直接链接到含 `REPLACE_WITH_EXTENSION_ID` 的商店占位地址，不检测浏览器或回退到 GitHub；商店发布后需填入实际商店详情页地址并重新部署。

## 每次发布前核对

- 正式域名、HTTPS、隐私政策和商店详情页可访问，安装链接已替换。
- 使用本次 `dist/extension/` 完成安装验证，核对模型、分隔效果、开关及动态网页行为。
- 商店文案与图片对应待提交版本；旧截图不能直接当作新模型的运行结果。
- ZIP、SHA-256 与 `dist/extension-release.json` 来自同一次构建。
- 在开发者后台确认本次版本的审核、发布状态，再验证商店安装。

本地构建、ZIP 校验和单元测试不等于商店审核通过。
