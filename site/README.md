# 好读静态入口页

独立的 Hugo + [Doks](https://github.com/thuliteio/doks) 项目。包含中英文产品首页、中文隐私政策和 404 页面，不生成 docs、blog、分类、标签、RSS 或搜索索引。内容在构建时生成静态 HTML，主题的 JavaScript 用于明暗切换、移动端导航等交互。

主题通过官方 npm 包 `@thulite/doks-core` 安装，按 [Doks 官方安装方式](https://getdoks.org/docs/start-here/installation/) 和 Thulite 模块挂载配置接入。主题、构建依赖和锁文件都位于 `site/`，与插件的根目录 npm 项目独立。

配置参考官方 Doks starter，其 MIT 许可保留在 `LICENSE-Doks.txt`。

中文品牌文字标志为「好｜读」，英文为「hao｜du」，由 `layouts/_partials/brand-wordmark.html` 统一生成。导航栏和移动端菜单通过本地 `header/header.html` 覆盖使用它；该文件基于 Doks 1.9.3 的导航模板，调整品牌、界面译文及语言选择菜单，升级主题时需同步检查。中英文品牌分隔线固定为品牌红色并随字号缩放，始终显示，不受预览开关、颜色及粗细调节影响。正文和页面元数据中的品牌名仍为「好读」和小写 `haodu`。

网站 favicon 与插件图标统一为透明底的红色粗竖线，颜色为 `#ff1744`；在仓库根目录运行 `npm run icons:generate` 可同时重新生成 SVG、插件各尺寸 PNG 和 `static/favicon.png`。

首页的切分示例是静态演示，浏览器不加载模型。切点直接写在 `content/_index.md` 的 `lead` 和 `reader-demo` 正文中，以 `｜` 标记，由人工维护并定期审查。模板将这些标记渲染为分隔线；开发服务启动、热刷新和构建均使用文案中保存的切点，不改写源文件。

产品文案以本站为准，按用途复用：

| 内容 | 文案来源 | 同步位置 |
| --- | --- | --- |
| 中文名称、标语与介绍 | `config/_default/hugo.toml`、`content/_index.md` 的 `title`、`lead` | [项目 README](../README.md)、商店材料、截图用例；复用正文时仅省略 `｜` 标记 |
| 中文摘要 | `content/_index.md` 的 `description` | `params.toml`、根 `manifest.json`、两份 `package.json`、商店摘要 |
| 英文名称与介绍 | `config/_default/languages.toml`、`content/_index.en.md` | 名称统一为小写 `haodu`，英文摘要同时用于语言配置 |
| 按钮 | `i18n/zh-cn.toml`、`i18n/en.toml` | 安装入口统一为“现在安装” / “Install now”；文档中的按钮引用沿用这些名称 |
| 宣传图短语 | 从中文 `lead` 概括为“保留原文 · 长句切分 · 离线运行 · 安全高效” | `release/assets/` 中的两份 SVG、对应 JPEG 和截图用例页脚 |

修改时手动同步对应位置，宣传图更新 SVG 后需重新导出 JPEG。商店详细介绍复用第二条 `lead` 并补充显示方式和操作，避免重复摘要的用途介绍。历史截图与测试输入是记录和用例，不作为当前宣传文案；历史截图不得直接用于新版本发布。demo 切点仍由人工维护，不自动同步。

中文首页位于 `/`，英文首页位于 `/en/`，通过页头的 Doks 语言下拉菜单切换语言，按钮使用 `中` / `En` 简写，菜单保留完整语言名称。`content/_index.en.md` 仅维护英文标题、介绍和元信息，按钮等界面文案放在 `i18n/`。两种首页都通过 `hugo.Sites.Default.Home.Content` 渲染 `content/_index.md` 中的同一份中文 demo，包括引用来源和手写切点，不复制或翻译示例。隐私政策暂保留中文，英文页脚会标明其语言。

安装入口位于顶部中央，使用品牌红色 `#ff1744` 的白字直角矩形按钮；`btn-install` 复用 Bootstrap 按钮状态样式，悬停及按下时红色加深，保留键盘焦点提示，中英文及明暗主题一致。视口底部中央的悬浮面板包含预览开关、连续色带和五档粗细滑块，与扩展共用控件样式及颜色、粗细规则。默认开启、品牌红色、第二档粗细；拖动实时更新简介及示例分隔线，关闭后两项滑块禁用并淡化、去色，再开启时保留选择。主标题和品牌分隔线固定显示。预览设置仅作用于当前页面，刷新恢复默认，不读写扩展偏好；高对比度模式隐藏色带并使用系统颜色。面板使用底部 sticky 定位，阅读时悬浮，滚至页尾时停在页脚上方，不覆盖链接、不增加页脚本身高度。卡片使用自定义边框和阴影，间距使用 Bootstrap 的 `p-3 p-md-4`。没有 JavaScript 时仍显示静态示例，面板隐藏。

开关左侧显示快捷键提示：未连接扩展时，macOS 为 `⌥⇧U`，其他平台为 `Alt+Shift+U`，由网页切换本页预览；按住不重复切换，输入法组合输入、编辑文本及其他修饰键组合不触发。使用物理 `KeyU` 判断，避免 macOS Option 改变字符值。

安装配套新版扩展后，后台通过 `<meta name="haodu" content="off">` 识别预览页面，不依赖域名；正式官网、localhost 和临时部署使用同一规则。在加载完成或页面聚焦时同步实际快捷键，网页停止自己的默认按键处理，由扩展命令单向转交给预览，避免重复切换，也不改变扩展的全局开关、颜色和粗细。自定义绑定随下次聚焦同步；清空绑定显示“未设置”，仍可点击开关。带标记的隐私页、404 等没有预览控件的页面不执行切换。没有标记的网站维持原来的全局快捷键行为；扩展 popup 的开关仍控制全局。

这项协作需要同时更新网站与扩展；旧扩展不会转交快捷键，不能仅靠新版网站改变它的行为。开发时重新打包、重载扩展并刷新站点；扩展被禁用或卸载后刷新站点可恢复网页快捷键。协作只使用 DOM 属性和事件，不增加权限、不开放网站调用扩展后台的接口，也不注入 reader 或加载模型。

面板后方有一层固定在视口底部、200px 高的渐变遮罩，从透明过渡到页面底色（浅色为白色，深色跟随主题），降低背景文字对控件的干扰。遮罩不拦截点击，不改变布局；页脚文字和链接保持在遮罩上方。

演示引用可用 `{{< reader-demo source="罗素《幸福之路》" >}}` 指定来源，模板直接显示该文字。来源在卡片内渲染为正文之后的独立段落，使用 Bootstrap 的 `text-end mb-0` 靠右对齐；不指定 `source` 时不生成来源段落。

首页主标题 `headline` 的“让中文｜更好读”使用固定分隔线，不参与模型切分。主标题和 `lead` 均由 `layouts/_partials/reader-copy.html` 渲染，不显示字面量竖线。每个语意块优先保持完整，分隔线随前一块一起换行，避免单独落在行首；两条 `lead` 之间使用 `<br>`。`title` 和 `seo.title` 保留不带分隔标记的纯文本，供页面元信息使用。

官网与扩展的分隔线均以桌面正文的 18px 字号、默认 3px 线宽为基准：高度 `1em`，粗细为档位 × `1em / 12`，默认第二档即 `1em / 6`，间距和垂直偏移也使用 `em`。主标题及品牌固定使用默认比例；使用实色伪元素绘制，避免边框宽度取整改变细线比例。

站点布局和样式优先使用 Bootstrap 预定义类，包括栅格、间距、排版、背景和按钮；标题语意块使用 `d-inline-block mw-100`，正文使用 `lh-lg text-break`。自定义 SCSS 保留阅读分隔线、卡片边框与阴影，以及悬浮面板的定位和外框，位于 `assets/scss/common/_custom.scss`。控件本身直接挂载扩展的 `../src/reader-controls.css`，颜色和粗细规则挂载 `../src/divider-color.js`、`../src/divider-width.js`，不维护第二份组件样式。卡片跟随页面配色，深色模式调整边框颜色。`bootstrapJavascript = false` 关闭完整 Bootstrap 脚本，`assets/js/custom.js` 按需导入移动端菜单所需的 Offcanvas 和语言菜单所需的 Dropdown 组件。

全站通过 `layouts/_partials/head/custom-head.html` 在 HTML 的 `<head>` 中输出 `<meta name="haodu" content="off">`。即使扩展全局开启，也会跳过这些页面，不运行切分推理，避免影响静态演示控件；其他网站仍按全局设置处理。此标记不依赖域名或页面 JavaScript，部署后同样生效。已安装旧版开发扩展时，重新加载扩展及页面后该规则生效。

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

该入口必须指定真实 HTTPS 地址，输出到独立的 `dist/site/`，并检查中英文首页、隐私页、扩展跳过标记及下面列出的 SEO 元信息。它不会修改开发配置；部署只上传 `dist/site/` 的内容。详细步骤见 [`../release/README.md`](../release/README.md)。

只需检查本地构建产物时，运行 `npm run release:site:preview`，生成 `dist/site-preview/`，用本地静态服务器预览即可。预览产物禁用抓取并标记 noindex，不能当作正式发布包。

## 发布前配置

- `config/production/hugo.toml` 的 `baseURL` 为 `https://haodu.site/`；正式发布命令仍显式传入地址。`config/_default/hugo.toml` 的 `https://example.org/` 仅作默认占位，不用于部署。
- `config/_default/params.toml` 的 `chromeWebStoreURL`：首页安装按钮的固定地址。目前使用含 `REPLACE_WITH_EXTENSION_ID` 的 Chrome 商店占位链接；发布后替换为好读的完整商店详情页链接，再重新构建、部署网站。
- `content/_index.md`：维护中文首页标题、SEO 标题、描述和两种语言共用的中文 demo；`content/_index.en.md` 维护对应英文介绍。

首页安装入口中文显示“现在安装”，英文显示“Install now”；所有浏览器都直接打开配置的商店详情页，不检测浏览器，也不依赖 JavaScript。

也可以在构建时指定地址：

```sh
npm --prefix site run build -- --baseURL https://example.org/haodu/
```

页面使用 Doks/Thulite 的 SEO 集成生成元信息和 sitemap，保留自定义的 `robots.txt`。404 页面设有 `noindex`。子路径部署时，爬虫读取域名根目录的 `/robots.txt`，需在根配置中添加对应 sitemap 地址。

## SEO

- 标题与描述来自各页面 front matter；中英文首页分别使用自己的 canonical。语言互链与 sitemap 直接使用主题默认模板：HTML 使用 `zh-cn` / `en` 并提供 `x-default`，sitemap 使用 `zh-CN` / `en-US`。两者都链接到中英文首页并包含自身，无需为统一写法覆盖模板。
- 分享卡片复用 [`haodu-cover-1280x640.jpg`](../release/assets/haodu-cover-1280x640.jpg)。`module.toml` 将这一个文件挂载为站点资源，Thulite 输出 Open Graph / Twitter 大图，项目补充实际尺寸和中英文替代文字。换封面后重新构建即可，不需维护第二份图片。
- `WebSite` 结构化数据使用主题默认模板，名称按语言配置输出「好读」或 `haodu`，URL 均指向站点根地址。无需维护本地覆盖模板来额外添加别名。
- 页面正文在静态 HTML 中可读取，不依赖 JavaScript。英文 H1 的分隔线处保留文本空格，避免文本提取后变成 `Chineseeasier`，不增加视觉间距。中文演示区保留在中英文首页，使用 `data-nosnippet` 避免书籍例文被 Google 抽作产品搜索摘要；不影响演示显示及正文收录。搜索摘要仍由搜索引擎决定。
- 正式站允许抓取；开发和预览页、所有 404 页面使用 `noindex`。sitemap 索引包含两种语言的子 sitemap，仅列出两个首页及隐私政策，不包含 404 或语言重定向页。
- [`check-site-seo.mjs`](../scripts/check-site-seo.mjs) 随发布和预览构建执行，检查标题、描述、H1、canonical、语言互链、收录设置、分享图片文件、JSON-LD 和 sitemap 覆盖；不通过就终止构建。检查允许主题默认的语言代码与 locale 差异，不要求两种语言的结构化数据全文相同，也不要求 sitemap 重复 HTML 中的 `x-default`。

主题的描述长度提醒使用统一的 110–160 长度区间，不能当作中英文 SEO 的硬性标准。保持当前准确简洁的描述，不为消除提醒填充文字；Google 会根据设备宽度截断摘要，见[官方说明](https://developers.google.com/search/docs/appearance/snippet)。

**部署后仍需核验：** 域名 HTTPS 可访问；首页、英文页、隐私页、robots 和 sitemap 返回正确内容；无效路径返回真实 HTTP 404；HTTP 与备用域名跳转到正式 HTTPS 域名。然后在 Google Search Console 验证域名、提交 `/sitemap.xml` 并查看 URL 检查和实际 Core Web Vitals；这些线上状态不能由本地构建确认。安装入口的商店占位地址仍需在扩展发布后替换。

2026-10-12 本地审查时，`https://haodu.site/` 的外部访问未成功，本机请求报 TLS 握手失败，因此未确认线上收录、跳转和性能状态；以上修补尚需重新部署。

## 维护

| 路径 | 用途 |
| --- | --- |
| `config/_default/` | Hugo、Doks、SEO、导航和 npm 模块挂载配置 |
| `config/postcss.config.js` | 官方 PostCSS 配置，压缩生产 CSS 并保留动态主题样式 |
| `content/_index.md` | 中文首页介绍及共用的中文 demo |
| `content/_index.en.md` | 英文首页介绍与元信息 |
| `i18n/` | 中英文按钮、导航和 404 文案 |
| `content/privacy.md`、`layouts/legal.html` | 隐私政策和简单的正文布局 |
| `layouts/home.html` | 使用 Doks 基础模板和 Bootstrap 栅格的产品首页 |
| `layouts/_partials/` | 项目扩展入口、站点图标、404 的 noindex |
| `assets/scss/common/` | 阅读分隔线、卡片边框与阴影、悬浮面板外框，其余使用 Bootstrap 预定义类 |
| `assets/js/reader-preview.js` | 静态示例开关、颜色及粗细交互，不加载模型、不改变切点 |
| `../src/reader-controls.css`、`../src/divider-color.js`、`../src/divider-width.js` | 通过 Hugo 挂载，与扩展共用的控件样式和取值规则 |
| `package.json`、`package-lock.json` | 固定版本的主题依赖和构建命令 |

没有复制官方示例的 docs、blog 等页面。隐私政策按本项目实际的数据流编写。文档搜索、侧栏、版本切换等功能在 `params.toml` 中关闭；页脚包含隐私政策入口。

升级主题时更新依赖与锁文件并重新构建，检查中英文首页、语言切换、404、明暗切换和移动端菜单。不修改 `node_modules` 中的主题源码。Doks 1.9.3 的主题切换事件绑定在按钮内的 SVG 上；`assets/js/custom.js` 将按钮空白处及键盘触发转交给对应 SVG，复用主题的保存与切换逻辑。升级主题后需确认是否仍需要此适配。

当前 Doks 1.9.3 及其上游依赖在 Hugo 0.164.0 下仍会输出 `LanguageCode` 和 LibSass 的弃用提示，正常构建成功。将来升级 Hugo 时需同时检查主题的兼容性。
