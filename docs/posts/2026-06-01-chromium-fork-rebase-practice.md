layout: post
title: "Chromium Fork 的版本管理艺术：Upstream Rebase 实战指南"
date: 2026-06-01
categories: [chromium, git]
tags: [chromium, fork, rebase, merge, git, version-management]
---

> 本文基于对 Kiwi Browser Next、Supermium、Brave Browser、Hysteria (fork Quinn) 等开源项目的源码分析，系统梳理 Chromium fork 的 Upstream 同步策略、冲突解决与版本管理最佳实践。

---

## 一、为什么要维护 Chromium Fork？

### 1.1 Fork 的典型场景

```
Chromium 上游 (chromium.org)
    │
    ├── Kiwi Browser（移动端 + 扩展支持）
    ├── Su妹妹ium（Win32 支持）
    ├── Brave（隐私 + 广告拦截内置）
    ├── Edge（微软账号 + 生态整合）
    └── Opera（内置 VPN + 侧边栏）
```

当你 fork Chromium 后，你就进入了一个"双线作战"状态：

```
上游 Chromium:  ── C1 ── C2 ── C3 ── C4 ── C5 ── (持续更新)
                          \
你的 Fork:       ── F1 ── F2 ── F3 ── F4 ── (你的定制)
```

你的定制（F1-F4）需要**始终建基于上游**，否则 Chromium 更新后你的 patch 就会冲突。

---

## 二、Git 层面的核心问题

### 2.1 Merge vs Rebase

| 维度 | Merge | Rebase |
|------|-------|--------|
| 历史 | 保留分叉，"丫"字形 | 重写成直线，"一"字形 |
| 冲突解决 | 一次解决 | 每个 commit 依次解决 |
| 安全性 | 安全，可 push 到共享分支 | **危险**，需 force push |
| 适用场景 | 长期共享分支 | 本地/个人分支 |

**铁律：**

```
已经 push 的、别人在用的分支 → 只能用 merge
只有自己在用的本地分支    → 可以用 rebase
```

### 2.2 Chromium 的特殊性

Chromium 不是普通的 Git 仓库。它有：

- **177 万+ commits**
- **20GB+ 源码**（不含 `.git`）
- **40+ 子仓库**（通过 DEPS 管理）
- **每天数百个 commits**

在这样的体量下，一次简单的 `git merge` 可能涉及数千个文件变更。

---

## 三、两种主流同步策略

### 3.1 策略一：Merge 主线（推荐团队使用）

Supermium 使用的方式：

```bash
# 配置上游远程
git remote add upstream https://github.com/chromium/chromium.git

# 定期拉取上游更新
git fetch upstream main

# 合并到你的主分支
git checkout main
git merge upstream/main
# → 产生一个 Merge Commit
# → 冲突在此次合并中一次性解决
```

**Supermium 真实数据：** 领先上游 **4860 commits**，落后上游 **10 万+ commits**。他们通过 merge 保持同步，因为他们的 fork 有多个贡献者。

**优点：**
- 安全，push 到共享分支
- 冲突一次解决
- 其他人不会受影响

**缺点：**
- 提交历史有分叉
- 多个 merge commit 使历史变复杂

### 3.2 策略二：Rebase（适合个人分支）

Kiwi Browser Next 的 `fetch_from_upstream.sh` 使用的方式：

```bash
#!/bin/bash
# fetch_from_upstream.sh (Kiwi Browser)
# 自动同步最新 Chromium 代码

# 1. 添加上游
git remote add upstream https://github.com/kiwibrowser/src.next

# 2. 拉取上游代码
git fetch upstream

# 3. 自动变基
git rebase upstream/main
# ← 如果冲突，脚本会尝试自动解决
# ← 无法自动解决的，中止并提示人工介入
```

**Kiwi 的自动冲突解决策略：**

```bash
# 对于已知的、无害的冲突（如版本号变更），使用预设策略
git rebase -X theirs upstream/main
# -X theirs = 遇到冲突使用上游版本
# 适用于：版本号、更新日志等不影响功能的内容
```

**优点：**
- 提交历史干净（直线）
- 方便代码审查

**缺点：**
- 需要 force push（`git push --force-with-lease`）
- 如果多人协作，会搞乱其他人的仓库

---

## 四、实战：维护一个 Chromium Fork

### 4.1 仓库初始化

```bash
# 1. Fork Chromium
# GitHub 上 fork chromium/chromium → your-org/chromium

# 2. 本地克隆（只用 bare 克隆，节省空间）
git clone --bare https://github.com/your-org/chromium.git
cd chromium.git

# 3. 添加上游
git remote add upstream https://github.com/chromium/chromium.git
git fetch upstream
```

### 4.2 建立 Patch 栈

不要直接修改 Chromium 源码。使用 **patch 栈** 管理你的定制：

```bash
# 为每个功能创建独立分支
git checkout -b feature/adblock
# ... 修改代码 ...
git commit -m "feat: add built-in adblock integration"
git format-patch main  # → 生成 0001-feat-add-built-in-adblock-integration.patch
```

推荐工具：[**quilt**](https://wiki.debian.org/UsingQuilt) 或 [**git stash**](https://git-scm.com/docs/git-stash)。

### 4.3 定期的 Rebase 流程

```bash
# 每月一次的同步流程
#!/bin/bash
set -e

# 1. 暂停 CI，通知团队
echo "即将同步上游 Chromium..."

# 2. 拉取最新上游
git fetch upstream
git checkout main
git merge upstream/main
# 或 git rebase upstream/main

# 3. 尝试自动解决已知冲突
# 4. 通知团队解决剩余冲突
# 5. 运行完整测试套件
ninja -C out/Default chrome
./out/Default/chrome --version

# 6. 如果失败，回滚
git merge --abort
echo "同步失败，请手动解决冲突后重试"
```

### 4.4 冲突解决技巧

当 Chromium 上游修改了你的定制代码区域时：

```bash
# 1. 查看冲突文件
git diff --name-only --diff-filter=U

# 2. 使用 git mergetool 可视化解决
git mergetool

# 3. 对于已知的"无害冲突"（如版本号、copyright year）
# 可以直接使用上游版本
git checkout --theirs chrome/VERSION
git add chrome/VERSION

# 4. 对于你的核心定制（如新功能）
# 必须手动逐行检查
vim chrome/browser/BUILD.gn  # 手动合并
```

**常见冲突类型：**

| 冲突类型 | 特征 | 解决策略 |
|---------|------|---------|
| 版本号/年份 | `VERSION`、`copyright` | 直接接受上游 |
| 构建文件 | `BUILD.gn`、`DEPS` | 重新生成 |
| 功能冲突 | 双方改了同一个文件 | 手动合并 |
| API 变更 | 上游改了接口签名 | 更新你的调用方 |
| 文件被删 | 上游删了你改的文件 | 评估是否需要保留 |

### 4.5 从 Hysteria fork Quinn 中学到的

在 Hysteria-rs 项目中，我维护了一个深度修改的 Quinn（Rust QUIC 库）fork：

```toml
# Cargo.toml 的 patch 机制
[patch.crates-io]
quinn = { git = "https://github.com/our-org/quinn", branch = "hysteria" }
quinn-proto = { git = "https://github.com/our-org/quinn-proto", branch = "hysteria" }
```

这就是一种"轻量级 fork 管理"。与 Chromium fork 相比：

```
Chromium Fork                     Rust Cargo Patch
─────────────────────────────    ────────────────────────────
20GB+ 源码                        几个 MB 的 Rust crate
177 万 + commits                  几千 commits
DEPS 管理子仓库                    Cargo.toml 管理依赖
需要专门 CI/CQ                    常规 CI 即可
同步成本极高                      同步成本低
```

核心理念是相通的：**维护 patch 栈，定期 rebase，控制冲突范围**。

---

## 五、开源项目参考

### 5.1 Supermium（Win32SS）

`https://github.com/win32ss/supermium`

- **领先上游：** 4860 commits
- **落后上游：** 10 万+ commits
- **策略：** Merge 主线
- **特点：** 最活跃的第三方 Chromium fork

```bash
# Supermium 的同步方式
git fetch chromium
git merge chromium/main  # merge 而非 rebase
```

### 5.2 Kiwi Browser Next

`https://github.com/kiwibrowser/src.next`

- **策略：** `fetch_from_upstream.sh` 自动化
- **特点：** 针对移动端，增加扩展支持
- **补丁管理：** 使用专门的 patch 管理脚本

### 5.3 Brave Browser

`https://github.com/brave/brave-core`

- **策略：** 使用 `npm-run sync` 管理同步
- **特点：** 最成熟的 Chromium fork 管理工具链
- **工具：** [brave-browser-cocoa](https://github.com/brave/brave-browser-cocoa) 等

---

## 六、推荐工具链

| 工具 | 用途 |
|------|------|
| **Quilt** | Debian 风格的 patch 管理 |
| **Git Worktree** | 并行工作多个分支 |
| **git rebase -i** | 交互式变基，整理提交 |
| **git range-diff** | 对比两段提交历史差异 |
| **diffoscope** | 深入对比文件差异 |

---

## 七、总结：Fork 管理铁律

```
┌─────────────────────────────────────────┐
│            Chromium Fork 管理            │
├─────────────────────────────────────────┤
│ 1. 永远不要直接修改上游代码               │
│ 2. 用独立分支/独立 commit 管理定制        │
│ 3. 定期同步（至少每月一次）               │
│ 4. 建立自动化冲突检测机制                 │
│ 5. 维护 patch 栈文档（改了什么、为什么）   │
│ 6. 同步前全面测试                         │
│ 7. 使用 --force-with-lease 而非 --force   │
└─────────────────────────────────────────┘
```

最后记住 Git 核心原则：

> **个人分支用 rebase，共享分支用 merge。**

只要这条原则不出错，Chromium fork 再大也不怕。

---

*参考项目：Supermium (github.com/win32ss/supermium), Kiwi Browser Next (github.com/kiwibrowser/src.next), Brave Browser (github.com/brave/brave-core), Hysteria-rs (Quinn fork)*
