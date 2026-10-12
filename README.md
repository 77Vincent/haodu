<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="release/assets/haodu-wordmark-dark.svg">
    <img src="release/assets/haodu-wordmark.svg" alt="好读 · haodu" width="259" height="52">
  </picture>
</h1>

让中文更好读

好读是一款阅读辅助插件。保留原文的同时按人类习惯把长句切成短句，使阅读更轻松。<br>
使用离线运行的微型神经网络，极致智能、安全、高效且无额外网络开销。

[安装使用](#安装使用) · [开发文档](docs/development.md) · [问题反馈](https://github.com/77Vincent/haodu/issues)

![好读首页预览](release/assets/haodu-cover-1280x640.jpg)

## 安装使用

从源码安装需要 Node.js 24.13+ 和 `zip`（macOS 自带）。

```sh
git clone https://github.com/77Vincent/haodu.git
cd haodu
npm run release:extension
```

1. 打开 Chrome 的 `chrome://extensions/`，开启**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择生成的 `dist/extension/` 目录。
3. 打开中文网页，点击工具栏中的好读图标开启辅助，再次点击关闭；也可右键图标，选择「启用」或「关闭」。红色表示开启，灰色表示关闭。

快捷键：macOS 使用 **Shift + Option + R**，其他平台使用 **Shift + Alt + R**。可在 `chrome://extensions/shortcuts` 修改。

开关状态会在切换网页、刷新页面及重启浏览器后保留。使用本地 HTML 文件时，需要在扩展设置中开启“允许访问文件网址”。

## 开发与贡献

欢迎通过 [Issues](https://github.com/77Vincent/haodu/issues) 反馈问题或提出建议，也欢迎提交 Pull Request。报告切分或页面兼容问题时，请附上复现步骤、相关例句和浏览器版本。

修改扩展代码后，运行测试：

```sh
npm test
```

本仓库用于构建“好读“浏览器插件和产品展示站点，包含已训练并导出的模型，及推理代码。插件按一定规则提取页面可见文字，在本地运用模型推理出切分点，再写回页面。后端包含一整套读取、写回、标记、撤销等逻辑，以便高效、低开销地在本地设备，完成实时计算和DOM操作。模型训练在独立的私有仓库维护，日常开发、测试和构建无需训练数据。详细步骤见 [开发与测试](docs/development.md)。

## 文档

- [架构与实现](docs/architecture.md)
- [网站开发](site/README.md)
- [发布与部署](release/README.md)
- [隐私政策](site/content/privacy.md)
