---
layout: default
title: differs' blog
---

# differs' blog

> 浏览器工程 · Chromium 网络栈 · 广告拦截 · 视频嗅探

---

{% for post in site.posts %}
### [{{ post.title }}]({{ post.url | relative_url }})

<small>{{ post.date | date: "%Y-%m-%d" }}</small>

{{ post.excerpt | strip_html | truncate: 200 }}

[阅读全文 →]({{ post.url | relative_url }})

---

{% endfor %}
