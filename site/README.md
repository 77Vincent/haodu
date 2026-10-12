# 好读静态入口页

独立的 Hugo + [Doks](https://github.com/thuliteio/doks) 项目。包含产品首页、隐私政策和 404 页面，不生成 docs、blog、分类、标签、RSS 或搜索索引。内容在构建时生成静态 HTML，主题的 JavaScript 用于明暗切换、移动端导航等交互。

主题通过官方 npm 包 `@thulite/doks-core` 安装，按 [Doks 官方安装方式](https://getdoks.org/docs/start-here/installation/) 和 Thulite 模块挂载配置接入。主题、构建依赖和锁文件都位于 `site/`，与插件的根目录 npm 项目独立。

配置参考官方 Doks starter，其 MIT 许可保留在 `LICENSE-Doks.txt`。

默认品牌文字标志为「好｜读」，由 `layouts/_partials/brand-wordmark.html` 统一生成。导航栏和移动端菜单通过本地 `header/header.html` 覆盖使用它；该文件保留 Doks 1.9.3 的导航模板，仅替换这两处品牌标题，升级主题时需同步检查。品牌分隔线与正文共用颜色及随字号缩放的比例，固定显示，不受阅读辅助开关影响。站点名称、页面元数据中的品牌名仍为「好读」。

网站 favicon 与插件图标统一为透明底的红色粗竖线，颜色为 `#ff1744`；在仓库根目录运行 `npm run icons:generate` 可同时重新生成 SVG、插件各尺寸 PNG 和 `static/favicon.png`。

首页的切分示例是静态演示，浏览器不加载模型。切点直接写在 `content/_index.md` 的 `lead` 和 `reader-demo` 正文中，以 `｜` 标记，由人工维护并定期审查。模板将这些标记渲染为分隔线；开发服务启动、热刷新和构建均使用文案中保存的切点，不改写源文件。

产品宣传语和介绍以 `content/_index.md` 的 `title`、`lead` 为准；[项目 README](../README.md) 复用相同文案，仅省略阅读分隔标记。修改这些文案时手动一并更新两处。

安装入口位于顶部中央，使用 `btn-primary`；阅读辅助开关固定在视口底部中央，使用带实色底和阴影的 `btn-outline-primary`，通过 `ResizeObserver` 与安装按钮保持同样尺寸，图标开启为红色、关闭为灰色。悬浮按钮脱离文档流，不额外增加页面底部或页脚高度。开关控制简介及所有演示段落中的分隔线，主标题和品牌分隔线始终显示。卡片使用自定义边框和阴影，间距使用 Bootstrap 的 `p-3 p-md-4`。没有 JavaScript 时仍显示静态示例，开关隐藏。

演示引用可用 `{{< reader-demo source="罗素《幸福之路》" >}}` 指定来源，模板直接显示该文字。来源在卡片内渲染为正文之后的独立段落，使用 Bootstrap 的 `text-end mb-0` 靠右对齐；不指定 `source` 时不生成来源段落。

首页主标题 `headline` 的“让中文｜更好读”使用固定分隔线，不参与模型切分。主标题和 `lead` 均由 `layouts/_partials/reader-copy.html` 渲染，不显示字面量竖线。每个语意块优先保持完整，分隔线随前一块一起换行，避免单独落在行首；两条 `lead` 之间使用 `<br>`。`title` 和 `seo.title` 保留不带分隔标记的纯文本，供页面元信息使用。

官网与扩展的分隔线均以桌面正文的 18px 字号、3px 线宽为基准：高度 `1em`、宽度 `calc(1em / 6)`，间距和垂直偏移也使用 `em`。标题和小字按同一比例缩放；使用实色伪元素绘制，避免边框宽度取整改变细线比例。

站点布局和样式优先使用 Bootstrap 预定义类，包括栅格、间距、排版、背景和按钮；标题语意块使用 `d-inline-block mw-100`，正文使用 `lh-lg text-break`。自定义 CSS 保留阅读分隔线、卡片边框与阴影，以及悬浮开关的底色、图标、层级和安全间距，位于 `assets/scss/common/_custom.scss`。卡片跟随页面配色，深色模式调整边框颜色。`bootstrapJavascript = false` 关闭完整 Bootstrap 脚本，`assets/js/custom.js` 单独导入移动端菜单所需的 Offcanvas 组件。

全站通过 `layouts/_partials/head/custom-head.html` 在 HTML 的 `<head>` 中输出 `<meta name="super-reader" content="off">`。即使扩展全局开启，也会跳过这些页面，不运行切分推理，避免影响静态演示开关；其他网站仍按全局设置处理。此标记不依赖域名或页面 JavaScript，部署后同样生效。已安装旧版开发扩展时，重新加载扩展及页面后该规则生效。

## 环境与本地预览

- Hugo **Extended 0.158.0 或更新版本**（Doks 使用 SCSS）。
- Node.js **24.13.0 或更新版本**，推荐 Node.js 24 LTS。

以下命令在仓库根目录运行：

```sh
npm --prefix site ci
npm --prefix site run dev
```

开发预览通过 `--renderToMemory` 在内存中提供页面和资源，与生产构建的 `public/` 分开。`config/development/hugo.toml` 同时将开发资源的编译缓存放到已忽略的 `resources/development/`，避免生产构建的 `--cleanDestinationDir` 或 `--gc` 删除预览正在使用的文件。可以在预览运行时执行构建。

打开终端输出的本地地址（默认 `http://localhost:1313/`）。如果端口已占用：

```sh
npm --prefix site run dev -- --port 1315
```

## 构建

```sh
npm --prefix site run build
```

将 `site/public/` 部署到静态托管服务即可。`public/`、`node_modules/`、`resources/`、`hugo_stats.json` 和 Hugo 锁文件均已忽略；`package-lock.json` 应提交，保证干净检出后可通过 `npm ci` 安装相同依赖。

正式发布推荐从仓库根目录运行：

```sh
npm run release:site -- --base-url https://haodu.site/
```

该入口必须指定真实 HTTPS 地址，输出到独立的 `dist/site/`，并检查隐私页、扩展跳过标记、sitemap 和 robots 地址。它不会修改开发配置；部署只上传 `dist/site/` 的内容。详细步骤见 [`../release/README.md`](../release/README.md)。

只需检查本地构建产物时，运行 `npm run release:site:preview`，生成 `dist/site-preview/`，用本地静态服务器预览即可。预览产物禁用抓取并标记 noindex，不能当作正式发布包。

## 发布前配置

- `config/production/hugo.toml` 的 `baseURL` 为 `https://haodu.site/`；正式发布命令仍显式传入地址。`config/_default/hugo.toml` 的 `https://example.org/` 仅作默认占位，不用于部署。
- `config/_default/params.toml` 的 `chromeWebStoreURL`：首页安装按钮的固定地址。目前使用含 `REPLACE_WITH_EXTENSION_ID` 的 Chrome 商店占位链接；发布后替换为好读的完整商店详情页链接，再重新构建、部署网站。
- `content/_index.md`：维护首页标题、SEO 标题、描述和正文。

首页安装入口统一显示“现在安装”，所有浏览器都直接打开配置的商店详情页，不检测浏览器，也不依赖 JavaScript。

也可以在构建时指定地址：

```sh
npm --prefix site run build -- --baseURL https://example.org/haodu/
```

页面使用 Doks/Thulite 的 SEO 集成生成元信息和 sitemap，保留自定义的 `robots.txt`。404 页面设有 `noindex`。子路径部署时，爬虫读取域名根目录的 `/robots.txt`，需在根配置中添加对应 sitemap 地址。

## 维护

| 路径 | 用途 |
| --- | --- |
| `config/_default/` | Hugo、Doks、SEO、导航和 npm 模块挂载配置 |
| `config/postcss.config.js` | 官方 PostCSS 配置，压缩生产 CSS 并保留动态主题样式 |
| `content/_index.md` | 产品首页 |
| `content/privacy.md`、`layouts/legal.html` | 隐私政策和简单的正文布局 |
| `layouts/home.html` | 使用 Doks 基础模板和 Bootstrap 栅格的产品首页 |
| `layouts/_partials/` | 项目扩展入口、站点图标、404 的 noindex |
| `assets/scss/common/` | 阅读分隔线、卡片边框与阴影、悬浮开关，其余使用 Bootstrap 预定义类 |
| `package.json`、`package-lock.json` | 固定版本的主题依赖和构建命令 |

没有复制官方示例的 docs、blog 等页面。隐私政策按本项目实际的数据流编写。文档搜索、侧栏、版本切换等功能在 `params.toml` 中关闭；页脚包含隐私政策入口。

升级主题时更新依赖与锁文件并重新构建，检查首页、404、明暗切换和移动端菜单。不修改 `node_modules` 中的主题源码。Doks 1.9.3 的主题切换事件绑定在按钮内的 SVG 上；`assets/js/custom.js` 将按钮空白处及键盘触发转交给对应 SVG，复用主题的保存与切换逻辑。升级主题后需确认是否仍需要此适配。

当前 Doks 1.9.3 及其上游依赖在 Hugo 0.164.0 下仍会输出 `LanguageCode` 和 LibSass 的弃用提示，正常构建成功。将来升级 Hugo 时需同时检查主题的兼容性。
