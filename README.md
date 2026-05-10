<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Daily Doodle Gallery / 每日 Doodle 画廊

A small Doodle gallery that serves a local Google Doodle archive from the repo so production does not depend on live Google image/API access for every visitor.

一个轻量的 Doodle 画廊。项目会把 Google Doodle 图片与索引归档到仓库中，线上访问时优先读取本地归档，避免每个访客请求都依赖 Google 实时连接。

## Run Locally / 本地运行

**Prerequisites / 前置要求:** Node.js 22+

```bash
npm install
npm run dev
```

Open the local URL printed by the dev server.

打开开发服务器输出的本地地址即可预览。

## Useful Commands / 常用命令

```bash
npm run dev
```

Start the local Express/Vite server.

启动本地 Express/Vite 开发服务器。

```bash
npm run lint
```

Run TypeScript checks without emitting files.

运行 TypeScript 检查，不生成构建文件。

```bash
npm run build
```

Build the frontend into `dist/`. This is only needed when you intentionally want a local production build.

把前端构建到 `dist/`。只有在你明确需要本地生产构建时才运行。

```bash
npm run preview
```

Preview the built `dist/` output locally.

本地预览已经构建出来的 `dist/`。

## Doodle Archive / Doodle 归档

The archive lives in `public/doodles` and `doodleArchive.ts`.

归档数据位于 `public/doodles` 和 `doodleArchive.ts`。

```bash
npm run doodles:update
```

Fetch recent Google Doodles, download images, update `public/doodles/manifest.json`, update `public/doodles/translations.zh-CN.json`, and regenerate `doodleArchive.ts`.

拉取最近的 Google Doodle，下载图片，更新 `public/doodles/manifest.json`，更新 `public/doodles/translations.zh-CN.json`，并重新生成 `doodleArchive.ts`。

### Archive Options / 归档脚本参数

```bash
DOODLE_LIMIT=30 npm run doodles:update
```

Limit the archive to the newest 30 Doodles. The script defaults to 30.

限制归档为最近 30 张 Doodle。脚本默认就是 30。

```bash
DOODLE_MONTHS=12 npm run doodles:update
```

Control how many recent months are scanned from Google. The default is 12.

控制从 Google 扫描最近多少个月的数据。默认是 12。

```bash
DOODLE_TRANSLATE=0 npm run doodles:update
```

Disable online Google Translate and use the local fallback translation rules/cache.

关闭在线 Google 翻译，改用本地兜底翻译规则和缓存。

```bash
DOODLE_TRANSLATE_REFRESH=1 npm run doodles:update
```

Force refresh cached Chinese translations when online translation is available.

在在线翻译可用时强制刷新中文翻译缓存。

```bash
DOODLE_OFFLINE=1 npm run doodles:update
```

Rebuild `manifest.json` and `doodleArchive.ts` only from local files, without network requests.

只根据本地文件重建 `manifest.json` 和 `doodleArchive.ts`，不发起网络请求。

```bash
HTTPS_PROXY=http://127.0.0.1:7890 npm run doodles:update
```

Use a proxy for Google archive, image, and translation requests. `HTTP_PROXY` and `ALL_PROXY` are also supported.

为 Google 归档、图片和翻译请求使用代理。也支持 `HTTP_PROXY` 和 `ALL_PROXY`。

## Remote Update Workflow / 远程自动更新

`.github/workflows/update-doodles.yml` runs `npm run doodles:update` every day on GitHub Actions and commits archive changes back to `main`.

`.github/workflows/update-doodles.yml` 会每天在 GitHub Actions 上运行 `npm run doodles:update`，并把归档变化自动提交回 `main`。

You can also run it manually:

也可以手动触发：

1. Open GitHub Actions.
2. Choose **Update Doodle Archive**.
3. Click **Run workflow**.

The workflow runs on GitHub-hosted servers, not on your laptop. If Google is temporarily unreachable there, run the script locally with a proxy and push the generated archive files.

这个 workflow 跑在 GitHub 托管服务器上，不跑在你的电脑上。如果 GitHub 服务器临时连不上 Google，可以在本地配代理运行脚本，然后推送生成的归档文件。

## Local Update Status / 本地更新状态

Before committing, check what changed:

提交前先看本地改了什么：

```bash
git status --short
git diff --stat
```

Inspect archive-only changes:

只查看归档相关变化：

```bash
git diff -- public/doodles doodleArchive.ts
```

Sync the latest remote code before a manual archive update:

手动更新归档前，先同步远端最新代码：

```bash
git pull --ff-only origin main
npm run doodles:update
git status --short
```

Commit only the files you intend to publish:

只提交你明确想发布的文件：

```bash
git add public/doodles doodleArchive.ts
git commit -m "Update Doodle archive"
git push origin main
```

Avoid accidentally committing `dist/` after a local build unless you intentionally want to publish generated build output.

本地跑过构建后，注意不要误提交 `dist/`，除非你明确想发布生成出来的构建产物。
