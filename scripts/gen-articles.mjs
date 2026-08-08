#!/usr/bin/env node
/**
 * 静态文章生成器 — 为博客生成爬虫友好的纯静态 HTML 版本
 * =============================================================
 *
 * 背景：博客是 Vite SPA，GitHub Pages 对 /post/{slug}/ 返回 404 状态码 +
 * SPA fallback（内容靠 JS 客户端渲染）。curl / AI 爬虫抓取会看到 404，
 * 简历链接被误判为失效。
 *
 * 本脚本把 posts/*.md 渲染为 docs/articles/{slug}.html —— 纯静态、
 * 无 JS 依赖、内容直接内联在 HTML 中，任何抓取工具直接返回 200 + 完整正文。
 *
 * 用法：
 *   node scripts/gen-articles.mjs              # 全部文章
 *   node scripts/gen-articles.mjs --only <slug>[,<slug>...]
 *   node scripts/gen-articles.mjs --outdir docs
 *
 * 在 vite.config.js 的 postIndexPlugin.closeBundle 中自动调用（全部文章）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lexer, parse, Parser } from 'marked';

// ---------- highlight.js（与博客 main.js 保持一致的语言集合） ----------
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import cpp from 'highlight.js/lib/languages/cpp';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('python', python);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(BLOG_ROOT, 'posts');
const DEFAULT_OUT_DIR = path.join(BLOG_ROOT, 'docs');

// ---------- 工具 ----------

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function stripMarkdown(s) {
  return String(s)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[`*_~\[\]()>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function listMdFiles() {
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse();
}

function parseMeta(filename, content) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  const date = m ? m[1] : '';
  const slug = m ? m[2] : filename.replace(/\.md$/, '');
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : slug;
  const excerptMatch = content
    .replace(/^#\s+.+$/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .match(/(?:^|\n)([^\n]{20,})/g);
  const excerpt = excerptMatch
    ? stripMarkdown(excerptMatch.slice(0, 3).join(' ')).slice(0, 180)
    : '';
  return { date, slug, title, excerpt };
}

// ---------- Markdown 渲染（带锚点 + 代码高亮 + TOC） ----------

function renderArticleBody(md) {
  const tokens = lexer(md, { gfm: true, breaks: false });
  const toc = [];
  let sec = 0;
  const parser = new Parser({ gfm: true, breaks: false });

  const html = tokens
    .map((t) => {
      switch (t.type) {
        case 'space':
          return '';
        case 'code': {
          const lang = t.lang || 'text';
          let code;
          try {
            code = hljs.getLanguage(lang)
              ? hljs.highlight(t.text, { language: lang }).value
              : hljs.highlightAuto(t.text).value;
          } catch (_) {
            code = escapeHtml(t.text);
          }
          return `<pre><code class="hljs language-${escapeHtml(lang)}">${code}</code></pre>`;
        }
        case 'heading': {
          sec += 1;
          const id = `sec-${sec}`;
          const inner = t.tokens?.length
            ? parser.parseInline(t.tokens)
            : escapeHtml(t.text);
          toc.push({ id, depth: t.depth, text: stripMarkdown(t.text) });
          return `<h${t.depth} id="${id}">${inner}</h${t.depth}>`;
        }
        default:
          // 段落 / 列表 / 表格 / 引用 / 分隔线 等：用原始片段重新渲染
          return parse(t.raw, { gfm: true, breaks: false });
      }
    })
    .join('');

  return { html, toc };
}

// ---------- 页面模板 ----------

const HLJS_CSS = (() => {
  try {
    return fs.readFileSync(
      path.join(BLOG_ROOT, 'node_modules', 'highlight.js', 'styles', 'github-dark.css'),
      'utf-8',
    );
  } catch {
    return '';
  }
})();

const PAGE_CSS = `
:root {
  --bg: #f7f8fa;
  --card: #ffffff;
  --text: #1f2328;
  --text-light: #57606a;
  --text-muted: #8b949e;
  --border: #d0d7de;
  --accent: #1a56db;
  --accent-bg: #eef4ff;
  --code-bg: #f6f8fa;
  --quote-bg: #f0f4ff;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC",
    "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.85;
  font-size: 16px;
}
.site-header {
  border-bottom: 1px solid var(--border);
  background: var(--card);
  position: sticky; top: 0; z-index: 10;
}
.site-header .inner {
  max-width: 860px; margin: 0 auto; padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.site-header .site-title { font-weight: 700; font-size: 15px; color: var(--text); text-decoration: none; }
.site-header .site-title:hover { color: var(--accent); }
.site-header .site-sub { font-size: 12px; color: var(--text-muted); }
.site-header .back-link { font-size: 13px; color: var(--accent); text-decoration: none; }
.site-header .back-link:hover { text-decoration: underline; }
.container { max-width: 860px; margin: 0 auto; padding: 40px 24px 64px; }
article.post { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 40px 48px; }
.post-header { border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 24px; }
.post-title { font-size: 26px; line-height: 1.4; margin: 0 0 10px; }
.post-meta { font-size: 13px; color: var(--text-light); display: flex; gap: 16px; flex-wrap: wrap; }
.post-meta a { color: var(--accent); text-decoration: none; }
.post-meta a:hover { text-decoration: underline; }
.toc {
  background: var(--accent-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  margin: 0 0 28px;
  font-size: 14px;
}
.toc summary { cursor: pointer; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.toc ul { margin: 0; padding-left: 18px; }
.toc li { margin: 3px 0; }
.toc a { color: var(--accent); text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.article-body { font-size: 16px; }
.article-body > *:first-child { margin-top: 0; }
.article-body h1, .article-body h2, .article-body h3, .article-body h4 {
  line-height: 1.45; margin: 1.6em 0 0.6em; scroll-margin-top: 80px;
}
.article-body h2 { font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.article-body h3 { font-size: 18px; }
.article-body h4 { font-size: 16px; }
.article-body p { margin: 0.8em 0; }
.article-body a { color: var(--accent); }
.article-body ul, .article-body ol { padding-left: 26px; margin: 0.8em 0; }
.article-body li { margin: 0.3em 0; }
.article-body blockquote {
  margin: 1em 0; padding: 10px 18px;
  background: var(--quote-bg);
  border-left: 4px solid var(--accent);
  border-radius: 0 8px 8px 0;
  color: var(--text-light);
}
.article-body blockquote p { margin: 0.3em 0; }
.article-body table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; display: block; overflow-x: auto; }
.article-body th, .article-body td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.article-body th { background: var(--accent-bg); font-weight: 600; }
.article-body tr:nth-child(even) td { background: #fafbfc; }
.article-body code {
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro", Consolas, monospace;
  font-size: 0.88em;
  background: var(--code-bg);
  padding: 2px 6px; border-radius: 4px;
}
.article-body pre {
  margin: 1.2em 0; padding: 0; border-radius: 8px; overflow-x: auto;
  background: #24292e; line-height: 1.6; font-size: 13.5px;
}
.article-body pre code {
  display: block; padding: 16px 18px; background: none;
  color: #e6edf3; font-size: inherit; overflow: visible;
}
.article-body hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
.article-body img { max-width: 100%; border-radius: 8px; }
.post-footer {
  margin-top: 36px; padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 13px; color: var(--text-light);
  display: flex; gap: 18px; flex-wrap: wrap;
}
.post-footer a { color: var(--accent); text-decoration: none; }
.post-footer a:hover { text-decoration: underline; }
.site-footer { text-align: center; font-size: 12px; color: var(--text-muted); padding: 0 24px 40px; }
@media (max-width: 640px) {
  article.post { padding: 24px 18px; }
  .post-title { font-size: 21px; }
  .container { padding: 20px 12px 48px; }
}
@media print {
  body { background: #fff; }
  article.post { border: none; padding: 0; }
  .site-header { position: static; }
  pre { white-space: pre-wrap; word-break: break-all; }
}
`;

function buildPage(meta, bodyHtml, toc, siteBase = 'https://blog.wedevs.org') {
  const tocHtml = toc.length
    ? `<nav class="toc" aria-label="目录"><details open><summary>目录</summary><ul>${toc
        .map(
          (h) =>
            `<li style="margin-left:${(h.depth - 2) * 14}px"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`,
        )
        .join('')}</ul></details></nav>`
    : '';

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: meta.title,
    datePublished: meta.date,
    description: meta.excerpt,
    url: `${siteBase}/articles/${meta.slug}.html`,
    author: { '@type': 'Person', name: "differs", url: 'https://github.com/differs' },
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(meta.title)} · differs' blog</title>
<meta name="description" content="${escapeHtml(meta.excerpt)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${siteBase}/articles/${meta.slug}.html">
<script type="application/ld+json">${jsonLd}</script>
<style>
${PAGE_CSS}
${HLJS_CSS}
</style>
</head>
<body>
<header class="site-header">
  <div class="inner">
    <a class="site-title" href="/">differs' blog <span class="site-sub">浏览器工程实践笔记</span></a>
    <a class="back-link" href="/">← 返回博客</a>
  </div>
</header>
<div class="container">
  <article class="post">
    <header class="post-header">
      <h1 class="post-title">${escapeHtml(meta.title)}</h1>
      <div class="post-meta">
        <span>📅 ${meta.date}</span>
        <a href="/">differs' blog</a>
        <a href="/post/${meta.slug}/">交互版（SPA）</a>
      </div>
    </header>
    ${tocHtml}
    <div class="article-body">
${bodyHtml}
    </div>
    <footer class="post-footer">
      <span>本文为静态版，供抓取与检索；交互版请访问 <a href="/post/${meta.slug}/">/post/${meta.slug}/</a></span>
      <a href="https://github.com/differs">GitHub</a>
    </footer>
  </article>
</div>
<footer class="site-footer">differs' blog — 浏览器工程实践笔记 · <a href="/">首页</a></footer>
</body>
</html>`;
}

// ---------- 主流程 ----------

export function generateStaticArticles({ only = null, outDir = DEFAULT_OUT_DIR, siteBase } = {}) {
  const files = listMdFiles();
  const wanted = only ? new Set(Array.isArray(only) ? only : [only]) : null;
  const outArticles = path.join(outDir, 'articles');
  fs.mkdirSync(outArticles, { recursive: true });

  let count = 0;
  for (const f of files) {
    const content = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8');
    const meta = parseMeta(f, content);
    if (wanted && !wanted.has(meta.slug)) continue;

    const { html, toc } = renderArticleBody(content);
    const page = buildPage(meta, html, toc, siteBase);
    const outFile = path.join(outArticles, `${meta.slug}.html`);
    fs.writeFileSync(outFile, page, 'utf-8');
    console.log(`📄 ${meta.slug}.html (${(page.length / 1024).toFixed(1)} KB)`);
    count += 1;
  }
  console.log(`✅ 静态文章生成完成：${count} 篇 → ${path.relative(BLOG_ROOT, outArticles)}/`);
  return count;
}

// CLI 入口
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 && args[onlyIdx + 1] ? args[onlyIdx + 1].split(',').map((s) => s.trim()) : null;
  const outIdx = args.indexOf('--outdir');
  const outDir = outIdx >= 0 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : DEFAULT_OUT_DIR;
  generateStaticArticles({ only, outDir });
}
