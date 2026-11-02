# awesome-agentic-ai-site

一个基于 **Astro** 构建的学习型网站，用来把 [WenyuChiou/awesome-agentic-ai-zh](https://github.com/WenyuChiou/awesome-agentic-ai-zh) 网站化，并支持定期同步内容。

## 当前多语言策略

- **默认语言：简体中文（zh-CN）**
- 繁体中文：`/zh-tw/...`
- English：`/en/...`

这样可以避免不同语言页面混在同一套路由里。

## 已实现

- Astro 项目骨架
- 内容集合：`stages`、`tracks`、`branches`、`resources`、`walkthroughs`
- 首页、Roadmap、Updates、各内容列表页与详情页
- 语言切换器（简中 / 繁中 / English）
- 内容同步脚本：直接从上游仓库拉取 Markdown 与 `resources/` 静态资源；内容没有变化时不产生提交
- Markdown 相对链接重写为站内多语言路由
- GitHub Actions：每 12 小时定时同步上游内容
- Vercel 部署配置

## 本地启动

```bash
cd awesome-agentic-ai-site
npm install
npm run sync:content
npm run dev
```

默认内容源：

- `https://github.com/WenyuChiou/awesome-agentic-ai-zh.git`
- 分支：`main`

如果想临时改成别的仓库（比如自己的 fork），可以覆盖：

```bash
REPO_URL=https://github.com/<yourname>/awesome-agentic-ai-zh.git npm run sync:content
```

## 部署建议

### Vercel
- Build command: `npm run build`
- Output directory: `dist`

### Cloudflare Pages
- Build command: `npm run build`
- Output directory: `dist`

## 工作流说明

工作流文件：[`.github/workflows/sync-content.yml`](./.github/workflows/sync-content.yml)

流程：每 12 小时（也可手动触发）拉取上游内容 → 生成站内 Markdown → `astro build` 校验 → 有变化才提交 → push 触发 Vercel 部署。

上游的提交经常只改动网站用不到的文件，这种情况脚本会保留原有的 `src/data/sync-manifest.json`，不产生提交，也不触发部署。

可在 GitHub 仓库 Variables 中覆盖内容源：
- `CONTENT_REPO_URL`：内容仓库地址，默认 `https://github.com/WenyuChiou/awesome-agentic-ai-zh.git`
- `CONTENT_REPO_REF`：分支名，默认 `main`

## 下一步建议

- 把首页换成品牌化设计
- 给资源页增加筛选/标签
- 接入站内搜索（Pagefind / Algolia）
- 增加 SEO（sitemap、OG、canonical）
- 为 Roadmap 增加图形化视图
