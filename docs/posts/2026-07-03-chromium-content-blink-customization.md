# Chromium content/blink 层定制实战：自定义协议、渲染管线与内核改造

> 本文是 Chromium 内核定制的第三篇。第一篇讲 net/ 层（网络栈），第二篇讲 fork/rebase 管理。本文将深入 **content/** 和 **blink/** 两个核心模块，展示如何在 Chromium 源码级别做实际定制。

---

## 一、Chromium 进程架构全景

在谈 content/blink 之前，先理清 Chromium 的多进程架构：

```
Chrome Browser Process（单例）
├── GPU Process
├── Utility Process
├── Renderer Process × N（每个 Tab 一个）
│   └── Blink（渲染引擎）+ V8（JS 引擎）
├── Network Service（网络服务）
├── Storage Service
└── Content Service（桥梁层）
```

**content/** 是 Chromium 的"胶水层"——它不直接实现功能，而是协调 Blink（渲染）、Net（网络）、CC（合成器）等子系统：

```
//content/ 的职责：
├── 管理 Browser/Renderer/Network 进程间通信（IPC）
├── 实现 Navigation 流程（页面加载生命周期）
├── 提供 WebContents API（JS 扩展可以调用的 C++ 接口）
├── 实现 Protocol Handler（自定义协议注册）
├── 管理 RenderProcessHost（渲染进程生命周期）
└── 实现 ResourceDispatcher（资源加载调度）
```

**blink/** 的职责：
```
//third_party/blink/ 的职责：
├── HTML/CSS/DOM 解析与渲染
├── Layout 树构建与几何计算
├── Painting（绘制到 Layer）
├── JavaScript 绑定（V8 ↔ Blink）
├── Web API 实现（Fetch、WebSocket、Storage 等）
└── Service Worker 运行时
```

---

## 二、实战一：注册自定义协议（kexample://）

这是 Chromium 内核定制最常见的场景之一。比如你要做一个"蛙蛙网盘"浏览器，需要支持 `kwawa://` 协议来直接打开网盘文件。

### 2.1 核心类图

```
ProtocolHandler（抽象基类）
    ↑
CustomSchemeHandler（你的实现）
    ↑
ContentBrowserClient::GetSchemeHandlerFactories() → 注册工厂
```

### 2.2 步骤详解

#### Step 1：定义 Scheme Handler

在 `chrome/browser/custom_scheme_handler.h`：

```cpp
#ifndef CHROME_BROWSER_CUSTOM_SCHEME_HANDLER_H_
#define CHROME_BROWSER_CUSTOM_SCHEME_HANDLER_H_

#include "content/public/browser/resource_handle_actor.h"
#include "net/url_request/url_request_job_factory.h"

// 自定义协议 handler，处理 kwawa:// 开头的请求
class CustomSchemeHandler : public net::URLRequestJobFactory::ProtocolHandler {
 public:
  explicit CustomSchemeHandler(
      std::unique_ptr<content::ProtocolHandler> protocol_handler)
      : protocol_handler_(std::move(protocol_handler)) {}

  // net::URLRequestJobFactory::ProtocolHandler 接口
  std::unique_ptr<net::URLRequestJob> CreateJob(
      net::URLRequest* request,
      net::NetworkDelegate* network_delegate) const override;

  // 协议前缀，如 "kwawa"
  const std::string& scheme() const { return scheme_; }

 private:
  std::unique_ptr<content::ProtocolHandler> protocol_handler_;
  std::string scheme_ = "kwawa";
};

#endif  // CHROME_BROWSER_CUSTOM_SCHEME_HANDLER_H_
```

#### Step 2：实现 CreateJob

```cpp
// custom_scheme_handler.cc
#include "chrome/browser/custom_scheme_handler.h"
#include "content/public/browser/browser_task_threads.h"
#include "net/url_request/url_request_job.h"

std::unique_ptr<net::URLRequestJob> CustomSchemeHandler::CreateJob(
    net::URLRequest* request,
    net::NetworkDelegate* network_delegate) const {
  // 委托给 content 层的 ProtocolHandler
  return protocol_handler_->CreateProtocolHandler(
      request, network_delegate);
}
```

#### Step 3：在 ContentBrowserClient 中注册

这是最关键的一步。你需要修改 `//chrome/browser/chrome_content_browser_client.cc`：

```cpp
// chrome_content_browser_client.cc

void ChromeContentBrowserClient::ConfigureSchemes() {
  // 1. 注册自定义协议到 URL 规范
  net::SchemeRegistry::RegisterURISchemeAsLocal(
      GURL::kStandardSchemeFromString("kwawa"));
  net::SchemeRegistry::RegisterURISchemeAsSecure("kwawa");
  net::SchemeRegistry::RegisterURISchemeAsBypassingContentSecurityPolicy(
      "kwawa", net::SchemeRegistry::ShouldBypassForScheme::kNever);
}

void ChromeContentBrowserClient::RegisterSchemeWithFeatureMap(
    net::FeatureMap* feature_map) {
  // 2. 注册 scheme handler factory
  auto handler = std::make_unique<CustomSchemeHandler>(
      std::make_unique<ContentBrowserProtocolHandler>());
  feature_map->RegisterSchemeWithCustomHandler("kwawa", std::move(handler));
}
```

#### Step 4：处理导航请求

当用户在地址栏输入 `kwawa://drive/open?file=abc123` 时，Chromium 会创建一个 `NavigationEntry`，你需要在 content 层拦截并处理：

```cpp
// content/browser/navigation_controller_impl.cc 附近
// 自定义 NavigationController 钩子

class KwawaNavigationHandler : public content::NavigationController::Delegate {
 public:
  // 在导航开始前调用
  void WillNavigate(content::NavigationController* controller,
                    const GURL& url) override {
    if (url.SchemeIs("kwawa")) {
      // 拦截 kwawa:// 导航
      // 1. 解析 URL 参数
      // 2. 创建特殊的 WebContents
      // 3. 加载自定义 UI（可以是本地 HTML 或远程页面）
      
      // 示例：打开网盘文件查看器
      OpenFileViewer(url);
    }
  }
};
```

### 2.3 Kiwi Browser 的实际参考

Kiwi Browser 在 `chrome/android/` 中做了类似的事情——它注册了 `intent://` 协议处理器来支持 Android Intents：

```cpp
// Kiwi 的 IntentBridge.java → JNI → C++
// 路径：chrome/android/java/src/org/chromium/chrome/browser/intent/IntentBridge.java

@JavascriptInterface
public void openUrl(@Nullable String url) {
    // 从 JS 调用，转发到 native
    // 这就是 Chrome 扩展 content script 与 native 通信的方式
}
```

**关键理解：** Chrome 扩展的 `chrome.runtime.connectNative()` 和 `chrome.windows.create()` 最终都是通过 `content/` 层的 IPC 通道到达 Browser Process 的。

---

## 三、实战二：修改 Blink 渲染管线

Blink 的渲染管线是 Chromium 最复杂的部分之一。了解它是在浏览器定制中做**页面内容注入、DOM 修改、CSS 拦截**的基础。

### 3.1 渲染管线流程图

```
HTML Parser (blink/html/parser)
    ↓
DOM Tree + CSSOM Tree
    ↓
Render Tree (blink/core/render_tree)
    ↓
Layout (blink/layout)
    ↓
Paint (blink/painting)
    ↓
Compositing (blink/compositor)
    ↓
GPU Rasterization
```

### 3.2 切入点一：Document 生命周期钩子

`Document` 是 Blink 的核心类，代表一个 HTML 页面。你可以在 `Document` 创建和加载过程中插入自定义逻辑：

```cpp
// 自定义 Document 子类
class KwawaDocument : public blink::Document {
 public:
  static blink::PassRefPtr<KwawaDocument> Create(
      blink::ExecutionContext* context,
      blink::Frame* frame) {
    auto doc = adoptRef(*new KwawaDocument(context, frame));
    return doc.release();
  }

 protected:
  KwawaDocument(blink::ExecutionContext* context, blink::Frame* frame)
      : blink::Document(context, frame) {}

  // 在 DOM 解析完成后调用
  void finishedParsing() override {
    blink::Document::finishedParsing();
    
    // 在这里注入自定义脚本或修改 DOM
    InjectCustomScripts();
  }

  // 拦截资源加载
  void didReceiveTitle(const WebString& title) override {
    blink::Document::didReceiveTitle(title);
    // 可以修改页面标题
    if (title.Utf8().find("广告") != std::string::npos) {
      SetTitle(WebString::FromUTF8("蛙蛙浏览器 - 纯净阅读"));
    }
  }

 private:
  void InjectCustomScripts() {
    // 在页面 body 末尾注入自定义 script
    auto script = blink::HTMLScriptElement::Create(*this);
    script->SetText("console.log('Kwawa Browser injected!');");
    body()->appendChild(script);
  }
};
```

### 3.3 切入点二：RenderView 拦截

`RenderView` 是 Blink 的顶级渲染对象，控制整个页面的布局。通过继承并重写关键方法，可以实现**页面级定制**：

```cpp
// 自定义 RenderView
class KwawaRenderView : public blink::RenderView {
 public:
  void layout() override {
    // 在布局前修改 CSS 属性
    PreLayoutCustomization();
    
    blink::RenderView::layout();
    
    // 布局后执行自定义逻辑
    PostLayoutProcessing();
  }

 private:
  void PreLayoutCustomization() {
    // 例如：强制所有图片最大宽度为 100%
    auto* document = GetDocument();
    if (document) {
      auto images = document->getElementsByTagName("img");
      for (unsigned i = 0; i < images->length(); ++i) {
        auto* img = toHTMLImageElement(images->item(i));
        if (img) {
          img->style()->setProperty("max-width", "100%", "");
          img->style()->setProperty("height", "auto", "");
        }
      }
    }
  }
};
```

### 3.4 切入点三：CSS 样式拦截

在 Chromium 中，CSS 规则的加载和解析由 `CSSStyleSheet` 管理。你可以注入自定义规则：

```cpp
// 在 ContentBrowserClient 中注入全局 CSS
void ChromeContentBrowserClient::OverridePageStyle(
    blink::WebDocument& document) {
  
  // 1. 创建自定义 CSS 规则
  WebString custom_css = WebString::FromUTF8(R"(
    /* 隐藏所有广告容器 */
    [data-ad], .ad-container, #adsbox, .adsbygoogle {
      display: none !important;
      visibility: hidden !important;
    }
    /* 强制深色模式 */
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
    }
  )");

  // 2. 注入到页面
  document.addStyleSheet(custom_css);
}
```

**实际项目参考：** AdBlocker Lite 的 `cosmetic-engine.js` 就是用 JS 层面实现的类似功能——通过 `document.adoptedStyleSheets` 注入 CSS 规则来隐藏广告元素。在 C++ 层做同样的事情性能更好，因为不需要等待 JS 执行。

---

## 四、实战三：WebView 集成（安卓端定制的关键）

Chromium 的安卓层定制离不开 `WebView`。Android 系统内置的 WebView 其实就是 Chromium 的一个子集：

### 4.1 WebView 架构

```
Android WebView (System)
├── Chromium Content Shell
│   ├── RenderProcessHost（渲染进程）
│   ├── BrowserPlugin（JNI 桥接层）
│   └── WebViewClient（Java 回调）
├── Java API
│   ├── WebView.loadUrl()
│   ├── WebView.addJavascriptInterface()
│   └── WebViewClient.onPageFinished()
└── JNI 绑定层（//content/public/android/）
```

### 4.2 在 Kiwi Browser 中，WebView 被替换为完整的 Browser

Kiwi Browser 的核心改动在 `chrome/android/java/src/org/chromium/chrome/browser/`：

```java
// Kiwi 的 CustomTabsService（支持 Chrome Custom Tabs 协议）
public class KiwiCustomTabsService extends CustomTabsService {
    @Override
    public boolean onNewIntent(Intent intent) {
        // 处理来自其他 App 的 Custom Tab 请求
        // 这是浏览器扩展能力的核心入口
        String uri = intent.getDataString();
        openInKiwi(uri);
        return true;
    }
}
```

### 4.3 自定义 WebViewClient 实现

```java
// 在 Kiwi Browser 中，你可以覆盖 WebViewClient
public class KwawaWebViewClient extends WebViewClient {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, 
                                                       WebResourceRequest request) {
        String url = request.getUrl().toString();
        
        // 拦截特定 URL，返回自定义响应
        if (url.contains("/api/download")) {
            // 网盘直链解析：拦截 API 请求，返回解析后的直链
            String directLink = resolveDirectLink(url);
            return new WebResourceResponse("application/json", "utf-8",
                ByteArrayInputStream.of(
                    ("{\"url\":\"" + directLink + "\"}").getBytes()));
        }
        
        // 广告拦截：返回空响应
        if (isAdUrl(url)) {
            return new WebResourceResponse("text/plain", "utf-8",
                new ByteArrayInputStream(new byte[0]));
        }
        
        return super.shouldInterceptRequest(view, request);
    }
}
```

**与 declarativeNetRequest 的关系：** `shouldInterceptRequest` 是**应用层**拦截（Java/Kotlin 代码），`declarativeNetRequest` 是**引擎层**拦截（C++ 网络栈）。两者互补——DNR 处理大规模规则匹配，`shouldInterceptRequest` 处理复杂的业务逻辑（如网盘直链解析）。

---

## 五、实战四：修改 BUILD.gn 构建配置

Chromium 使用 GN/Ninja 构建系统。任何定制都需要在 `BUILD.gn` 中注册新文件和新目标：

```gn
# chrome/BUILD.gn 中添加自定义模块

# 1. 定义源文件集合
config("custom_scheme_config") {
  include_dirs = [ "//chrome/browser/custom_scheme" ]
  defines = [ "CHROME_CUSTOM_SCHEME=1" ]
}

source_set("custom_scheme") {
  sources = [
    "custom_scheme/custom_scheme_handler.cc",
    "custom_scheme/custom_scheme_handler.h",
    "custom_scheme/kwawa_protocol_handler.cc",
    "custom_scheme/kwawa_protocol_handler.h",
  ]
  
  configs -= [ "//build/config/compiler:wchar_config" ]
  configs += [ ":custom_scheme_config" ]
  
  deps = [
    "//base",
    "//content/public/browser",
    "//net",
  ]
}

# 2. 在 chrome_browser 目标中引入
executable("chrome") {
  # ...
  deps += [ ":custom_scheme" ]
}
```

**关键理解：** 修改 `BUILD.gn` 后运行 `gn gen` 重新生成 Ninja 文件。这就是 Kiwi Browser 编译中"增量编译 2 分 34 秒"的原理——只有修改过的 `.cc` 文件和其 `BUILD.gn` 会重新编译。

---

## 六、从开源项目学习的实践路径

### 6.1 推荐研究的开源项目

| 项目 | 学习重点 | 关键文件 |
|------|---------|---------|
| **Kiwi Browser** | 安卓层定制、扩展支持、DownloadManager | `chrome/android/java/src/.../browser/download/` |
| **Supermium** | Win32 兼容层、旧版 Windows 适配 | `chrome/browser/win/` |
| **Brave Browser** | 内置广告拦截、HTTPS-First 模式 | `chrome/browser/brave/` |
| **Ghostery Privacy Browser** | 隐私保护、Tracker 拦截 | `chrome/browser/ghostery/` |
| **Waterfox** | 旧版扩展兼容、隐私定制 | `browser/extensions/` |

### 6.2 Kiwi Browser 扩展支持的源码路径

```
chrome/android/
├── java/
│   └── src/
│       └── org/chromium/chrome/browser/
│           ├── extensions/          ← 扩展核心
│           │   ├── ChromeExtensionManager.java
│           │   └── ExtensionMessageHandler.java
│           ├── download/            ← 下载管理器（资源浏览器关键）
│           │   ├── DownloadServiceImpl.java
│           │   └── DownloadDialog.java
│           └── search/              ← 搜索引擎
│               ├── SearchEngineManager.java
│               └── DefaultSearchManager.java
```

### 6.3 动手实验清单

```
□ 1. 在 Kiwi Browser 源码中找到 DefaultSearchManager.java
     → 理解如何修改默认搜索引擎
   
□ 2. 阅读 chrome/browser/download/DownloadServiceImpl.java
     → 理解下载管理的 Android 层实现
   
□ 3. 在 content/public/browser/ 中找到 ProtocolHandler
     → 理解自定义协议的注册流程
   
□ 4. 阅读 blink/core/document.h
     → 理解 Document 的生命周期钩子
   
□ 5. 修改 BUILD.gn 添加一个自定义 source_set
     → 体验 Chromium 构建系统的定制流程
   
□ 6. 在 chrome/android/ 中找到 WebContentsDelegateAdapter
     → 理解如何拦截页面导航和弹窗
```

---

## 七、与 Hysteria 经验的关联

在 Hysteria-rs 项目中，我 fork 并修改了 Quinn（Rust QUIC 实现）的协议层：

```rust
// 修改 quinn-proto 的 Connection 状态机
impl Connection {
    fn handle_frame(&mut self, frame: Frame) {
        match frame {
            Frame::Datagram(d) => self.handle_datagram(d),
            // 自定义拥塞控制逻辑
            Frame::AckRanges(ranges) => self.bbr.handle_ack(ranges),
            _ => {}
        }
    }
}
```

这和修改 Chromium 的 `net/` 层（如上一篇博客所述）本质上是**同一类工作**：理解协议栈的状态机，找到正确的 hook 点，注入自定义逻辑。只不过 Hysteria 是在 Rust 层面操作 QUIC，而 Chromium 定制是在 C++ 层面操作 HTTP/HTTPS/QUIC。

**核心能力迁移：**
- Quinn 的 `Connection` ↔ Chromium 的 `URLRequest`（都是请求状态机）
- Quinn 的 `TransportConfig` ↔ Chromium 的 `NetworkQualityEstimator`（都是网络参数配置）
- Quinn 的 `Stream` ↔ Chromium 的 `HttpStream`（都是数据传输通道）

---

## 八、总结：Chromium 内核定制能力矩阵

```
┌──────────────────────────────────────────────────────────┐
│              Chromium 内核定制能力矩阵                      │
├────────────────────┬───────────────┬─────────────────────┤
│ 层级               │ 关键类/API    │ 典型应用场景           │
├────────────────────┼───────────────┼─────────────────────┤
│ content/           │ ProtocolHandler│ 自定义协议、导航拦截  │
│                    │ WebContents   │ 页面生命周期管理      │
│                    │ NavigationController │ 前进/后退/刷新 │
├────────────────────┼───────────────┼─────────────────────┤
│ blink/             │ Document      │ DOM 注入、标题修改    │
│                    │ RenderView    │ 布局拦截、CSS 注入    │
│                    │ CSSStyleSheet │ 全局样式注入          │
├────────────────────┼───────────────┼─────────────────────┤
│ net/               │ URLRequest    │ 请求拦截/修改         │
│                    │ HttpStream    │ 协议层定制            │
│                    │ ProxyResolver │ 代理管理              │
├────────────────────┼───────────────┼─────────────────────┤
│ chrome/android/    │ WebViewClient │ Android 层拦截        │
│                    │ DownloadManager│ 下载管理             │
│                    │ SearchEngine  │ 搜索引擎定制          │
└────────────────────┴───────────────┴─────────────────────┘
```

Chromium 的内核定制不是"改几行代码"那么简单——它需要理解整个多进程架构、IPC 通信机制、渲染管线流程。但一旦理解了这些，你会发现每个定制需求都能在正确的层级找到合适的 hook 点。

---

*参考项目：Kiwi Browser (github.com/kiwibrowser/src.next), Brave Browser, Supermium, Chromium (chromium.org), Hysteria-rs (github.com/differs/hysteria-rs)*
