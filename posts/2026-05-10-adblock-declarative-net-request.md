layout: post
title: "Chrome 广告拦截技术深度解析：从 webRequest 到 declarativeNetRequest"
date: 2026-05-10
categories: [adblock, chrome-extensions]
tags: [adblock, mv3, declarative-net-request, ublock-origin, chromium]
---

> 本文基于对 uBlock Origin、Adblock Plus、Chrome Extensions API、declarativeNetRequest 机制以及 Chromium 网络栈的研究，系统梳理浏览器广告拦截的技术原理、MV3 变革与实战方案。

---

## 一、广告拦截的核心机制：net::ERR_BLOCKED_BY_CLIENT

当你使用 Chrome 打开一个网站，打开开发者工具的控制台，有时会看到：

```
Failed to load resource: net::ERR_BLOCKED_BY_CLIENT
```

这不是网络错误，而是**客户端主动拦截**。Chrome 的 `net/` 网络栈在收到拦截指令后，会立即中止请求并返回 `ERR_BLOCKED_BY_CLIENT` 错误码，相当于在请求发出之前就把它掐断了。

```
请求发起
  ↓
Extension 注册了 webRequest/declarativeNetRequest 监听
  ↓
匹配拦截规则？
  ├── 是 → 返回 ERR_BLOCKED_BY_CLIENT（请求从未到达服务器）
  └── 否 → 正常发送请求
```

---

## 二、两大拦截 API 对比

### 2.1 chrome.webRequest（MV2 时代）

MV2 时代的拦截方式，允许扩展**同步阻塞**请求：

```javascript
// manifest.json (MV2)
{
  "permissions": ["webRequest", "webRequestBlocking"],
  "host_permissions": ["*://*/*"]
}

// background.js
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (isAdUrl(details.url)) {
      return { cancel: true };  // 同步拦截
    }
    return { cancel: false };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]  // ← 关键：blocking 权限
);
```

**优点：** 灵活，可以运行任意 JS 逻辑判断  
**缺点：** 性能开销大，每次请求都要经过 JS 事件循环

### 2.2 chrome.declarativeNetRequest（MV3 标准）

MV3 引入了声明式 API，将过滤规则**提前编译**，在网络栈内部直接匹配：

```json
// manifest.json (MV3)
{
  "permissions": ["declarativeNetRequest"],
  "host_permissions": ["*://*/*"],
  "declarative_net_request": {
    "rule_resources": [{
      "id": "ruleset_1",
      "enabled": true,
      "path": "rules.json"
    }]
  }
}

// rules.json
[{
  "id": 1,
  "priority": 1,
  "action": {
    "type": "block"
  },
  "condition": {
    "urlFilter": "||doubleclick.net",
    "resourceTypes": ["script", "image"]
  }
}]
```

**优点：** 高性能（C++ 层匹配，不经过 JS）、隐私更好  
**缺点：** 规则数量受限（静态 30 万条 + 动态 5 万条 + 会话 5 万条）

---

## 三、uBlock Origin 深度解析（65.9k ⭐）

`https://github.com/gorhill/uBlock`

uBlock Origin 是目前最优秀的广告拦截器，它的架构值得深入学习：

### 3.1 架构概览

```
uBlock Origin
├── src/
│   ├── js/
│   │   ├── static-net-filtering.js  ← 核心：静态网络过滤引擎
│   │   ├── dynamic-net-filtering.js ← 动态网络过滤（高级用户防火墙）
│   │   ├── cosmetic-filtering.js    ← 元素隐藏（CSS 选择器）
│   │   ├── scriptlet-filtering.js   ← 脚本注入过滤
│   │   ├── url-net-filtering.js     ← URL 级别过滤
│   │   ├── redirect-engine.js       ← 资源重定向（替换为空白资源）
│   │   └── snfe.js                  ← 序列化网络过滤引擎
│   ├── web_accessible_resources/    ← 替换用的空白资源
│   └── assets/                      ← 预编译的规则列表
├── dist/                            ← 构建产物
└── platform/                        ← 浏览器适配层
```

### 3.2 静态网络过滤引擎（核心）

uBlock 的核心是 `static-net-filtering.js`，它将过滤规则编译成 **trie（字典树）** 数据结构，实现 O(n) 的匹配速度：

```javascript
// 简化的过滤引擎原理
class StaticNetFilteringEngine {
  constructor() {
    this.filterTrie = new Map();  // 基于 URL 片段的 trie 树
    this.filterCount = 0;
  }

  // 添加过滤规则
  addFilter(pattern) {
    // 将规则 "||example.com^" 转换为 trie 节点
    const tokens = this.tokenize(pattern);
    let node = this.filterTrie;
    for (const token of tokens) {
      if (!node.has(token)) {
        node.set(token, new Map());
      }
      node = node.get(token);
    }
    node._actions = node._actions || [];
    node._actions.push(patterns.type === 'block' ? 'block' : 'allow');
  }

  // 匹配 URL
  match(url) {
    const tokens = this.tokenize(url);
    // 在 trie 中搜索，优先匹配高优先级规则
    let node = this.filterTrie;
    // ... 遍历 URL 的每个 token，在 trie 中查找
    return 'block';  // 或 'allow'
  }
}
```

### 3.3 EasyList 规则语法

广告拦截规则有三种核心格式：

```
# 1. 网络请求拦截（最常用）
||example.com^$third-party    # 拦截 example.com 的第三方请求
||ads.example.com^            # 拦截 ads.example.com 所有请求
google-analytics.com^         # 拦截包含此域名的任何请求

# 2. 元素隐藏（CSS 选择器）
##.ad-banner                  # 隐藏 class="ad-banner" 的元素
##div[class*="advertisement"]  # 隐藏 class 包含 advertisement 的 div
example.com##.sidebar-ad     # 只在 example.com 生效

# 3. 脚本注入（高级）
example.com##+js(set-timeout.js)  # 注入脚本覆盖计时器
```

### 3.4 三种规则类型在 Chromium 中的映射

| 规则类型 | Chromium 实现 | API |
|---------|---------------|-----|
| URL 拦截 | `declarativeNetRequest` 的 `block` action | C++ 网络层 |
| 元素隐藏 | Content Script 注入 CSS | 渲染进程 |
| 脚本注入 | Content Script 注入 JS | 渲染进程 |

---

## 四、Manifest V3 对广告拦截的影响

### 4.1 核心变化

```
MV2                          MV3
─────────────────────────  ─────────────────────────
webRequest + blocking        declarativeNetRequest
background page (常驻)       Service Worker (事件驱动)
任意 JS 判断规则             静态 JSON 编译规则
无限制规则数量               静态 30 万 + 动态 5 万
手动更新规则                规则列表自动更新
```

### 4.2 uBlock Origin Lite（MV3 适配版）

uBO 的 MV3 版本使用 `declarativeNetRequest` 重新实现了过滤引擎：

```json
// uBO Lite 输出的编译后规则
{
  "id": 89342,
  "priority": 10000,
  "action": {
    "type": "block"
  },
  "condition": {
    "urlFilter": "||example.com^*/ad/*",
    "resourceTypes": ["script", "image", "sub_frame"]
  }
}
```

**挑战：** 30 万条静态规则限制意味着需要更智能的规则编译策略。

### 4.3 Replace Google CDN 项目参考

`https://github.com/justjavac/ReplaceGoogleCDN`

一个轻量级的 declarativeNetRequest 示例项目，通过 URL 重定向实现 CDN 替换：

```json
{
  "id": 1,
  "priority": 1,
  "action": {
    "type": "redirect",
    "redirect": {
      "regexSubstitution": "https://cdnjs.loli.net/\\1"
    }
  },
  "condition": {
    "regexFilter": "^https?://cdnjs\\.cloudflare\\.com/(.*)"
  }
}
```

---

## 五、网盘直链解析

### 5.1 核心原理

网盘直链解析 = **请求拦截 + 认证提取**：

```
用户操作 → 浏览器发起请求
                  ↓
拦截 XHR/Fetch 响应 ← declarativeNetRequest / content script
                  ↓
提取直链 URL ← 从 API 响应 JSON 中解析
                  ↓
拼接下载参数 ← token / timestamp / signature
                  ↓
触发下载 ← chrome.downloads.download API
```

### 5.2 实现方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **declarativeNetRequest** | 性能好、稳定 | 无法读取响应体 | 修改请求头/重定向 |
| **Content Script + fetch 拦截** | 可以读取响应体 | 性能稍差 | 提取 API 返回的直链 |
| **Service Worker** | 可持久化状态 | 生命周期受限 | 管理 Cookie/Token |

### 5.3 Content Script 拦截示例

```javascript
// content_script.js - 拦截 fetch 响应
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args);
  
  // 只拦截目标网盘的 API
  if (args[0].includes('/get_download_url')) {
    const cloned = response.clone();
    const data = await cloned.json();
    
    // 提取直链并通知扩展后台
    chrome.runtime.sendMessage({
      type: 'DIRECT_LINK',
      url: data.download_url,
      filename: data.file_name
    });
  }
  return response;
};
```

---

## 六、推荐学习路径

### 6.1 必读开源项目

| 项目 | ⭐ | 学习内容 |
|------|-----|---------|
| **uBlock Origin** | 65.9k | 完整广告拦截引擎实现 |
| **uBlock Origin Lite** | - | MV3 + declarativeNetRequest 适配 |
| **Adblock Plus** | - | 经典实现，EasyList 规则引擎 |
| **Replace Google CDN** | - | declarativeNetRequest 轻量示例 |

### 6.2 动手实验

```bash
# 1. 加载一个未打包的扩展
chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序

# 2. 模拟声明式规则
cat > rules.json << 'EOF'
[{
  "id": 1,
  "priority": 1,
  "action": { "type": "block" },
  "condition": {
    "urlFilter": "||doubleclick.net",
    "resourceTypes": ["script"]
  }
}]
EOF

# 3. 用 Chrome DevTools 调试拦截效果
# Network tab → 过滤 ERR_BLOCKED_BY_CLIENT
```

---

## 七、总结

广告拦截技术演进的本质，是从** JS 层拦截**走向**引擎层拦截**：

```
MV2: JS 层        → 每次请求过 JS 事件循环
MV3: C++ 引擎层   → 预编译规则，网络栈直接匹配
```

作为浏览器开发者，理解 `declarativeNetRequest` 和 Chromium 网络栈的关系，是掌握广告拦截/网络请求定制的关键。

---

*参考项目：uBlock Origin (github.com/gorhill/uBlock), Chrome Extensions API (developer.chrome.com), Replace Google CDN, Adblock Plus (gitlab.com/eyeo/adblockplus)*
