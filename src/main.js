/* ============================================
   differs' blog — Vite SPA
   可折叠左侧目录 · 光暗切换 · Markdown 渲染
   ============================================ */

import './style.css';
import { marked } from 'marked';

// 按需加载 highlight.js 语言（减小包体积）
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import cpp from 'highlight.js/lib/languages/cpp';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/github-dark.css';

hljs.registerLanguage('javascript', javascript);
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

// ---------- Marked 配置 ----------
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang }).value; } catch (_) {}
    }
    try { return hljs.highlightAuto(code).value; } catch (_) {}
    return code;
  },
  breaks: false,
  gfm: true,
});

// ---------- 状态 ----------
const state = {
  sidebarOpen: true,
  theme: localStorage.getItem('theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  posts: [],
  currentSlug: null,
};

// ---------- DOM ----------
const $ = (s, p = document) => (p ? p.querySelector(s) : document.querySelector(s));
const $$ = (s, p = document) => Array.from((p || document).querySelectorAll(s));

const html = document.documentElement;
const sidebar = $('#sidebar');
const mainContent = $('#main-content');
const toggleBtn = $('#sidebar-toggle');
const themeBtn = $('#theme-btn');
const tocList = $('#toc-list');
const heroSection = $('#hero-section');
const articleContainer = $('#article-container');
const contentBody = $('#content-body');

// ---------- 主题 ----------
function setTheme(t) {
  state.theme = t;
  html.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  if (themeBtn) themeBtn.textContent = t === 'dark' ? '☀️ 亮色' : '🌙 暗色';
}

function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('theme')) setTheme(e.matches ? 'dark' : 'light');
});

// ---------- 侧边栏 ----------
function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  sidebar?.classList.toggle('collapsed', !state.sidebarOpen);
  mainContent?.classList.toggle('expanded', !state.sidebarOpen);
  if (toggleBtn) {
    toggleBtn.textContent = state.sidebarOpen ? '◀' : '▶';
    toggleBtn.setAttribute('aria-label', state.sidebarOpen ? '收起侧边栏' : '展开侧边栏');
  }
}

// ---------- 获取文章列表 ----------
async function fetchPosts() {
  try {
    const resp = await fetch('/posts.json');
    state.posts = await resp.json();
  } catch (e) {
    console.error('Failed to load posts:', e);
    state.posts = [];
  }
  return state.posts;
}

// ---------- 构建侧边栏目录 ----------
function buildToc(posts) {
  if (!tocList) return;
  tocList.innerHTML = '';

  posts.forEach((post, i) => {
    const li = document.createElement('li');
    li.className = 'toc-item';
    const a = document.createElement('a');
    a.className = 'toc-link';
    a.dataset.index = i;
    a.dataset.slug = post.slug;
    a.innerHTML = `<span class="post-date">${post.date}</span> ${post.title}`;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(post.slug);
    });

    li.appendChild(a);
    tocList.appendChild(li);
  });
}

// ---------- 高亮 TOC 当前项 ----------
function highlightToc(slug) {
  $$('.toc-link').forEach(link => {
    link.classList.toggle('active', link.dataset.slug === slug);
  });
}

// ---------- 渲染文章 ----------
function renderPost(post) {
  if (!articleContainer || !heroSection) return;

  state.currentSlug = post.slug;
  highlightToc(post.slug);

  // 隐藏欢迎区，显示文章容器
  heroSection.style.display = 'none';
  articleContainer.style.display = 'block';
  articleContainer.innerHTML = '<div class="article-loading"><div class="spinner"></div><p>加载中...</p></div>';

  // 更新标题
  document.title = `${post.title} · differs' blog`;
  history.pushState({ slug: post.slug }, '', post.url);

  // 加载并渲染 Markdown
  fetch(`/posts/${post.date}-${post.slug}.md`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(md => {
      // 去掉已有的 # 标题（用 post.title 替代）
      md = md.replace(/^#\s.+$/m, '').trim();
      const html = marked.parse(md);

      articleContainer.innerHTML = `
        <article class="article-view visible">
          <header class="article-header">
            <h1 class="article-title">${escapeHtml(post.title)}</h1>
            <div class="article-meta">
              <time>${post.date}</time>
            </div>
          </header>
          <div class="article-body">${html}</div>
        </article>
      `;

      // 处理文章内标题的 ID（用于锚点）
      $$('h2, h3, h4', articleContainer).forEach((h, i) => {
        if (!h.id) h.id = `heading-${i}`;
      });

      window.scrollTo({ top: 0, behavior: 'smooth' });

      // 手机上收起侧边栏
      if (window.innerWidth <= 768 && state.sidebarOpen) toggleSidebar();
    })
    .catch(err => {
      articleContainer.innerHTML = `
        <div class="article-error">
          <p>😅 文章加载失败</p>
          <p class="error-detail">${err.message}</p>
          <button onclick="location.reload()" class="retry-btn">重试</button>
        </div>
      `;
    });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------- 导航 ----------
function navigate(slug) {
  if (!slug) return showHome();
  const post = state.posts.find(p => p.slug === slug);
  if (post) renderPost(post);
}

function showHome() {
  state.currentSlug = null;
  if (heroSection) heroSection.style.display = '';
  if (articleContainer) articleContainer.style.display = 'none';
  document.title = "differs' blog";
  highlightToc(null);
  history.pushState({}, '', '/');
}

// ---------- 路由 ----------
function handleRoute() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/' || path === '/index.html') {
    // 如果当前已经显示文章，回到首页
    if (state.currentSlug) showHome();
    return;
  }

  // 匹配 /post/slug/
  const match = path.match(/^\/post\/([^/]+)/);
  if (match) {
    const slug = match[1];
    if (slug !== state.currentSlug) {
      // 如果文章还没加载，先加载 post list 再导航
      if (state.posts.length === 0) {
        fetchPosts().then(posts => {
          buildToc(posts);
          navigate(slug);
        });
      } else {
        navigate(slug);
      }
    }
  } else {
    showHome();
  }
}

// ---------- 初始化 ----------
async function init() {
  setTheme(state.theme);

  // 加载文章列表
  const posts = await fetchPosts();
  buildToc(posts);

  // 绑定事件
  toggleBtn?.addEventListener('click', toggleSidebar);
  themeBtn?.addEventListener('click', toggleTheme);

  window.addEventListener('popstate', (e) => {
    if (e.state?.slug) navigate(e.state.slug);
    else showHome();
  });

  // 路由
  handleRoute();
}

// ---------- 启动 ----------
document.addEventListener('DOMContentLoaded', init);
