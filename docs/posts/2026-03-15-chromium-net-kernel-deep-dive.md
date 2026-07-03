# Chromium Network Stack 深度解析：从 net/ 层到内核定制实战

## 一、为什么要理解 Chromium 的 net/ 层？

Chromium 不仅是一个浏览器，更是一个**现代操作系统的网络运行时**。它的网络栈（`//net`）承担了：

- HTTP/1.1、HTTP/2、HTTP/3（QUIC）协议实现
- DNS 解析、域名缓存、预加载
- 代理解析、SOCKS5 支持
- SSL/TLS 握手与证书校验
- WebSocket、WebRTC 底层传输
- 网络变更检测、连接迁移

对于浏览器内核定制工程师来说，理解 `net/` 层是在 Chromium 中做**网络拦截、协议修改、代理定制**的必经之路。

---

## 二、Chromium 网络栈架构全景

### 2.1 目录结构

```
//net/                      # 核心网络库
├── base/                   # 连接池、网络变更检测
├── cert/                   # SSL 证书管理
├── cookie/                 # Cookie 存储与策略
├── dns/                    # DNS 解析器、缓存、预取
├── http/                   # HTTP/1.1 实现
├── http2/                  # HTTP/2 实现
├── http3/                  # HTTP/3 (QUIC) 实现（使用 quiche）
├── proxy_resolution/       # 代理解析（PAC、WPAD）
├── socket/                 # TCP/UDP socket 封装
├── ssl/                    # SSL/TLS（BoringSSL）
├── websocket/              # WebSocket 实现
└── quic/                   # QUIC 会话管理

//services/network/         # Network Service（进程隔离）
//content/browser/loader/   # Navigation URLRequest 调度
//chrome/browser/net/       # Chrome 特有的网络策略
```

### 2.2 核心组件：URLRequest

`URLRequest` 是整个网络栈的**核心抽象**。每次页面请求（无论是 HTML、CSS、XHR 还是 fetch）最终都会创建一个 `URLRequest`：

```
Navigation
    ↓
Browser process
    └─ NavigationURLLoaderImpl
         └─ URLLoader
              └─ URLRequest
                   ├─ HttpStreamFactory → TCP/TLS/QUIC
                   ├─ ProxyResolution → 代理
                   └─ CertVerifier → 证书
```

**关键类（C++）：**

```cpp
// //net/url_request/url_request.h
class URLRequest {
  // 网络请求的核心控制类
  void Start();                      // 发起请求
  void Cancel();                     // 取消请求
  void DelegateRedirect(GURL&);      // 重定向处理
  void DelegateResponseStarted();    // 响应开始回调
  int Read(IOBuffer*, int);          // 读取响应体
};
```

---

## 三、四个核心定制切入点

### 3.1 切入点一：net::URLRequestInterceptor（请求拦截）

这是**最常用**的定制点。通过注册自定义拦截器，可以在请求发送前/响应返回后介入：

```cpp
// 自定义拦截器
class CustomInterceptor : public URLRequestInterceptor {
  URLRequestJob* MaybeInterceptRequest(
      URLRequest* request,
      NetworkDelegate* network_delegate) const override {
    // 检查请求 URL
    if (request->url().host_piece() == "ads.example.com") {
      // 返回一个空 job 来阻止请求
      return new EmptyURLRequestJob(request, network_delegate);
    }
    return nullptr;  // 不拦截
  }
};

// 注册（在 //chrome/browser/net 中）
interceptors.push_back(std::make_unique<CustomInterceptor>());
```

**实际应用：** 广告拦截器的底层实现就是基于这个机制。

### 3.2 切入点二：URLRequestHttpJob（协议层修改）

HttpJob 负责具体的 HTTP 事务。如果你想在 HTTP 层面做文章（改 header、注入 cookie、降级协议）：

```cpp
// //net/url_request/url_request_http_job.h
class URLRequestHttpJob : public URLRequestJob {
  void Start() override;
  void OnHeadersReceived();  // 在这里可以修改响应头
  // 修改请求头
  int d = a->extra_headers().SetHeader("X-Custom", "value");
};
```

**真实案例：** 指纹浏览器通过修改 `User-Agent`、`Accept-Language` 等请求头来模拟不同设备。

### 3.3 切入点三：ProxyResolutionService（代理定制）

代理是浏览器网络栈最灵活的扩展点：

```cpp
// 自定义代理解析
class CustomProxyResolver : public ProxyResolver {
  int GetProxyForURL(const GURL& url,
                     ProxyInfo* results,
                     ...) override {
    if (url.SchemeIs("https")) {
      results->UseProxy("socks5://127.0.0.1:1080");
    }
    return OK;
  }
};
```

**真实案例：** Hysteria 代理工具的 Chrome 侧就是通过修改系统代理设置或使用 PAC 文件来接管流量。

### 3.4 切入点四：QUIC/HTTP3 定制（//net/quic）

这是最高级的定制点，涉及修改 QUIC 协议栈：

```cpp
// //net/quic/quic_stream_factory.cc
QuicStreamFactory::CreateSession(...) {
  // 可以在这里切换 QUIC 版本、修改拥塞控制参数
  QuicConfig config;
  config.SetMaxTimeBeforeCryptoHandshake(...);
  config.SetIdleConnectionTimeout(...);
}
```

**我的实践经验：** 在 Hysteria-rs 项目中，我 fork 了 Rust Quinn QUIC 栈，实现了自定义 Brutal 拥塞控制算法，深度修改了 BBR 实现（70+ 调优参数）。这本质上是和修改 Chromium 的 QUIC 栈（`//net/quic`）相同的工作。

---

## 四、从开源项目学习

### 4.1 CEF（Chromium Embedded Framework）

`https://github.com/chromiumembedded/cef`

CEF 是 Chromium 内容层（`//content`）的封装，提供了网络请求拦截接口：

```cpp
// CefRequestHandler::OnBeforeResourceLoad
// 可以在这里拦截/修改所有网络请求
bool OnBeforeResourceLoad(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefRequest> request,
    CefRefPtr<CefCallback> callback) {
  // 修改请求 URL 或 Header
  request->SetHeaderByName("X-Custom", "value", true);
  return false;  // 继续请求
}
```

### 4.2 Supermium（Chromium fork）

`https://github.com/win32ss/supermium`

一个活跃维护的 Chromium fork，领先上游 **4860 commits**。研究它的 Git 历史可以看到：
- 如何 fork Chromium
- 如何管理自己的 patch 栈
- 如何与上游同步（rebase）

### 4.3 Kiwi Browser Next

Kiwi Browser 是移动端 Chromium 定制的最佳参考。它的核心在 `chrome/android/` 中添加扩展支持、下载管理等。

```bash
# Kiwi 的自动同步脚本机制
./fetch_from_upstream.sh  # 拉取最新 Chromium 代码
# 使用 git rebase 管理 patch
git rebase upstream/main
```

---

## 五、学习路线图

如果你也想掌握 Chromium net/ 层定制，建议按以下顺序：

1. **阅读源码**：`//net/base/` → `//net/http/` → `//net/socket/` → `//net/quic/`
2. **编译 Chromium**：完成一次全量编译，理解 GN/Ninja 构建
3. **写一个 CEF 应用**：嵌入 Chromium 并实现请求拦截
4. **修改一个请求头**：在 `URLRequestHttpJob` 中添加自定义 Header
5. **实现一个自定义协议**：在 `//net/url_request/` 注册 `kExampleScheme`
6. **研究 Kiwi 的 patch 管理**：理解 Chromium fork 的补丁栈

---

## 六、总结

Chromium 网络栈是一个庞大但设计精良的系统。关键是要找到正确的切入点：

| 定制目标 | 切入点 | 文件位置 |
|---------|--------|---------|
| 请求拦截 | URLRequestInterceptor | `//net/url_request/` |
| Header 修改 | URLRequestHttpJob | `//net/url_request/` |
| 代理定制 | ProxyResolutionService | `//net/proxy_resolution/` |
| QUIC 修改 | QuicStreamFactory | `//net/quic/` |
| Content 层 | CefRequestHandler | CEF wrapper |

理解这些之后，Chromium 对你来说就不再是一个黑盒，而是一套可以用代码控制的网络工具箱。

---

*参考项目：Chromium (chromium.org), CEF (github.com/chromiumembedded/cef), Supermium (github.com/win32ss/supermium), Kiwi Browser Next (github.com/kiwibrowser/src.next)*
