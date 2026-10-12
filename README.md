# 好读 · Haodu

让中文更好读。

好读是一款中文阅读辅助浏览器扩展，在长句中添加视觉分隔线，帮助你按较短的语意块阅读，保留原文。

[安装使用](#安装使用) · [开发文档](docs/development.md) · [问题反馈](https://github.com/77Vincent/haodu/issues)

![好读首页预览](release/assets/haodu-cover-1280x640.jpg)

## 特点

- **保留原文**：添加阅读辅助分隔线，不改写或总结内容。
- **本地运行**：内置微型神经网络，网页文本和切分结果不上传，推理无需联网。
- **一键开关**：通过工具栏按钮或快捷键开启、关闭，设置保存在本机。
- **按需处理**：随着阅读滚动和页面内容变化，处理当前可见的中文文本。

## 安装使用

从源码安装需要 Node.js 24.13+ 和 `zip`（macOS 自带）。

```sh
git clone https://github.com/77Vincent/haodu.git
cd haodu
npm run release:extension
```

1. 打开 Chrome 的 `chrome://extensions/`，开启**开发者模式**。
2. 点击**加载已解压的扩展程序**，选择生成的 `dist/extension/` 目录。
3. 打开中文网页，点击工具栏中的好读图标开启辅助，再次点击关闭。红色表示开启，灰色表示关闭。

快捷键：macOS 使用 **Shift + Option + R**，其他平台使用 **Shift + Alt + R**。可在 `chrome://extensions/shortcuts` 修改。

开关状态会在切换网页、刷新页面及重启浏览器后保留。使用本地 HTML 文件时，需要在扩展设置中开启“允许访问文件网址”。

## 开发与贡献

欢迎通过 [Issues](https://github.com/77Vincent/haodu/issues) 反馈问题或提出建议，也欢迎提交 Pull Request。报告切分或页面兼容问题时，请附上复现步骤、相关例句和浏览器版本。

修改扩展代码后，运行测试：

```sh
npm test
```

本仓库包含扩展源码和可直接使用的模型，开发、测试及打包无需训练数据。详细步骤见 [开发与测试](docs/development.md)。

## 文档

- [架构与实现](docs/architecture.md)
- [网站开发](site/README.md)
- [发布与部署](release/README.md)
- [隐私政策](site/content/privacy.md)
