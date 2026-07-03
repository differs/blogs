---
layout: default
title: differs' blog
---

<section class="hero">
  <span class="hero-emoji">👋</span>
  <h1>你好，欢迎来到我的小站</h1>
  <div class="hero-divider"></div>
  <p>
    这里记录了我对 <strong>Chromium 网络栈</strong>、<strong>浏览器内核定制</strong>、
    <strong>广告拦截技术</strong> 和 <strong>流媒体传输</strong> 的研究与实践。
  </p>
  <p style="margin-top: 12px; font-size: 0.95rem; color: var(--text-muted);">
    偶尔也会聊聊开源、Rust 和那些折腾到深夜的有趣项目。
  </p>
</section>

<section class="section-posts" id="posts">
  <div class="container">
    <h2>📝 最新文章</h2>
    <div class="posts-grid">
      {% for post in site.posts %}
      <a href="{{ post.url | relative_url }}" class="post-card">
        <div class="post-card-title">{{ post.title }}</div>
        <div class="post-card-meta">
          <time>{{ post.date | date: "%Y-%m-%d" }}</time>
          {% for cat in post.categories %}
          · <span>{{ cat }}</span>
          {% endfor %}
        </div>
        <div class="post-card-excerpt">
          {{ post.excerpt | strip_html | truncate: 200 }}
        </div>
      </a>
      {% endfor %}
    </div>
  </div>
</section>
