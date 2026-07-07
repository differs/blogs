# Android 浏览器定制实战：默认搜索、主页、网盘入口集成

> 这是 Chromium 浏览器定制系列的第四篇。前三篇分别讲了 net/ 层、content/blink 层、fork/rebase 管理。本文将聚焦 **Android 浏览器层**——如何修改 Kiwi/Chromium 的默认搜索引擎、自定义主页、集成网盘入口，直接对应 JD 中的核心职责。

---

## 一、JD 核心职责拆解

JD 第二条明确要求：

> **改造默认搜索、主页、品牌，集成自有搜盘 / AI 搜索 / 网盘入口**

这意味着你需要在 Android 层做以下改造：

```
┌─────────────────────────────────────────────┐
│           Android 浏览器定制层                │
├─────────────────────────────────────────────┤
│ 1. 默认搜索引擎（Default Search Engine）      │
│    → SearchEngineManager / SuggestProvider  │
│                                              │
│ 2. 自定义主页（New Tab Page）                │
│    → ChromeStartupController /ntp/           │
│                                              │
│ 3. 品牌定制（Branding）                      │
│    → Strings / Colors / Icons / BuildConfig  │
│                                              │
│ 4. 网盘入口集成（Drive Integration）          │
│    → CustomTabs / Intent Bridge / Toolbar    │
│                                              │
│ 5. AI 搜索入口                                │
│    → Search Widget / Omnibox Integration     │
└─────────────────────────────────────────────┘
```

---

## 二、默认搜索引擎改造

### 2.1 Chromium 搜索引擎架构

```
SearchEngineManager（管理可用搜索引擎列表）
    ↓
DefaultSearchManager（确定当前默认搜索引擎）
    ↓
SuggestProvider（搜索建议提供者）
    ↓
Omnibox（地址栏搜索输入框）
```

### 2.2 修改默认搜索引擎

在 Kiwi Browser 中，搜索引擎配置在 `chrome/browser/search/`：

```java
// chrome/browser/search/search_engine_manager.java（简化）
public class SearchEngineManager {
    private static final Map<String, SearchEngine> KNOWN_ENGINES = new HashMap<>();
    
    static {
        // 内置搜索引擎列表
        KNOWN_ENGINES.put("google", new SearchEngine(
            "Google",
            "https://www.google.com/search?igu=1&q=",
            "https://www.google.com/complete/search?q=",
            "en-US,en;q=0.9"
        ));
        
        KNOWN_ENGINES.put("bing", new SearchEngine(
            "Bing",
            "https://www.bing.com/search?q=",
            null,
            "en-US,en;q=0.9"
        ));
        
        // 你的自有搜索引擎
        KNOWN_ENGINES.put("kwawa_search", new SearchEngine(
            "蛙蛙搜索",
            "https://search.kwawa.app/?q=",
            "https://search.kwawa.app/suggest?q=",
            "zh-CN,zh;q=0.9,en;q=0.5"
        ));
        
        // AI 搜索引擎
        KNOWN_ENGINES.put("kwawa_ai", new SearchEngine(
            "蛙蛙AI搜索",
            "https://ai.kwawa.app/?q=",
            "https://ai.kwawa.app/suggest?q=",
            "zh-CN,zh;q=0.9,en;q=0.5"
        ));
    }
    
    public SearchEngine getDefaultSearchEngine(Context context) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
        String engineId = prefs.getString("default_search_engine", "kwawa_search");
        return KNOWN_ENGINES.getOrDefault(engineId, KNOWN_ENGINES.get("kwawa_search"));
    }
}
```

### 2.3 强制设置默认搜索引擎

如果你想在浏览器安装时**强制**使用自有搜索引擎，可以修改 `ChromeBrowserInitializer`：

```java
// 在浏览器首次启动时强制设置默认搜索引擎
public class ChromeBrowserInitializer {
    public void initializeSearchEngine(Context context) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
        
        // 首次启动时设置
        if (!prefs.getBoolean("search_engine_initialized", false)) {
            prefs.edit()
                .putString("default_search_engine", "kwawa_search")
                .putBoolean("search_engine_initialized", true)
                .apply();
            
            Log.i("ChromeBrowser", "默认搜索引擎设置为：蛙蛙搜索");
        }
    }
}
```

### 2.4 参考：Kiwi 的搜索引擎选择 UI

```java
// chrome/android/java/src/org/chromium/chrome/browser/search/SearchEnginePicker.java
// Kiwi 在设置中提供了一个搜索引擎选择器
// 你可以在此基础上添加"蛙蛙搜索"作为默认选项

public class SearchEnginePickerDialog {
    private void buildEngineList() {
        List<SearchEngineItem> engines = new ArrayList<>();
        
        for (Map.Entry<String, SearchEngine> entry : KNOWN_ENGINES.entrySet()) {
            engines.add(new SearchEngineItem(
                entry.getKey(),
                entry.getValue().getName(),
                entry.getValue().getSearchUrl()
            ));
        }
        
        // 将"蛙蛙搜索"置顶
        Collections.sort(engines, (a, b) -> {
            if ("kwawa_search".equals(a.id)) return -1;
            if ("kwawa_search".equals(b.id)) return 1;
            return a.name.compareTo(b.name);
        });
    }
}
```

---

## 三、自定义主页（New Tab Page）

### 3.1 Chromium NTP 架构

Chromium 的新标签页（New Tab Page, NTP）在 `chrome/browser/ui/webui/ntp/`：

```
New Tab Page
├── HTML: chrome/browser/resources/ntp_cards/
├── JS:   ntp_cards.js（卡片渲染逻辑）
├── CSS:  ntp_cards.css（样式）
└── Backend: chrome://newtab（WebUI 端点）
```

### 3.2 修改 NTP 布局

```java
// 在 ChromeStartupController 中自定义 NTP 行为
public class ChromeStartupController {
    
    public void customizeNewTabPage(Context context, Bundle savedInstanceState) {
        // 1. 设置自定义 NTP URL
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
        String customNtp = prefs.getString("custom_ntp_url", "chrome://newtab");
        
        // 2. 如果你的浏览器有专属主页
        if (!customNtp.equals("chrome://newtab")) {
            // 加载自定义主页
            loadUrl(customNtp, NavigationEntry.GENERATED);
        }
    }
}
```

### 3.3 集成网盘入口到 NTP

在 NTP 页面中嵌入网盘入口是最常见的做法。Kiwi Browser 在 NTP 中集成了快捷方式：

```java
// chrome/android/java/src/org/chromium/chrome/browser/ntp/AppSuggestIntegration.java
// 你可以在此基础上添加"网盘入口"卡片

public class KwawaNtpCardsProvider implements NtpCardsProvider {
    
    @Override
    public List<NtpCardData> getCards(Context context) {
        List<NtpCardData> cards = new ArrayList<>();
        
        // 1. 快捷方式卡片（Kiwi 原生功能）
        cards.addAll(getShortcuts(context));
        
        // 2. 网盘入口卡片（自定义）
        cards.add(NtpCardData.builder()
            .setId("kwawa_drive")
            .setTitle("蛙蛙网盘")
            .setIconResId(R.drawable.ic_kwawa_drive)
            .setAction(NtpAction.builder()
                .setType(NtpAction.Type.OPEN_TAB)
                .setUrl("kwawa://drive/home")  // 自定义协议
                .build())
            .build());
        
        // 3. AI 搜索卡片（自定义）
        cards.add(NtpCardData.builder()
            .setId("kwawa_ai_search")
            .setTitle("AI 搜索")
            .setIconResId(R.drawable.ic_kwawa_ai)
            .setAction(NtpAction.builder()
                .setType(NtpAction.Type.OPEN_TAB)
                .setUrl("chrome://newtab?q=kwawa_ai:")  // 触发 AI 搜索模式
                .build())
            .build());
        
        return cards;
    }
}
```

### 3.4 自定义主页 HTML

如果你想要更彻底的主页定制，可以提供一个独立的 HTML 页面作为主页：

```html
<!-- kwawa-home.html -->
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: sans-serif; background: #1a1a2e; color: #eee; margin: 0; padding: 20px; }
        .search-box { display: flex; gap: 10px; margin: 30px 0; }
        .search-box input { flex: 1; padding: 12px 16px; border-radius: 24px; border: none; background: #16213e; color: #eee; font-size: 16px; }
        .search-box button { padding: 12px 24px; border-radius: 24px; border: none; background: #0f3460; color: #eee; cursor: pointer; }
        .quick-links { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-top: 30px; }
        .quick-link { background: #16213e; border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; }
        .quick-link:hover { background: #0f3460; }
        .quick-link .icon { font-size: 32px; margin-bottom: 8px; }
        .quick-link .label { font-size: 14px; }
    </style>
</head>
<body>
    <h1>🐸 蛙蛙浏览器</h1>
    
    <!-- 搜索框 -->
    <div class="search-box">
        <input type="text" id="searchInput" placeholder="搜索或输入网址">
        <button onclick="search()">搜索</button>
    </div>
    
    <!-- 快捷入口 -->
    <div class="quick-links">
        <div class="quick-link" onclick="openDrive()">
            <div class="icon">📁</div>
            <div class="label">蛙蛙网盘</div>
        </div>
        <div class="quick-link" onclick="openAiSearch()">
            <div class="icon">🤖</div>
            <div class="label">AI 搜索</div>
        </div>
        <div class="quick-link" onclick="openDownloads()">
            <div class="icon">⬇️</div>
            <div class="label">下载管理</div>
        </div>
        <div class="quick-link" onclick="openHistory()">
            <div class="icon">📜</div>
            <div class="label">历史记录</div>
        </div>
    </div>
    
    <script>
        function search() {
            const q = document.getElementById('searchInput').value;
            // 通过 Android Bridge 调用原生方法
            if (window.AndroidBridge) {
                window.AndroidBridge.search(q);
            }
        }
        
        function openDrive() {
            if (window.AndroidBridge) {
                window.AndroidBridge.openUrl('kwawa://drive/home');
            }
        }
        
        function openAiSearch() {
            if (window.AndroidBridge) {
                window.AndroidBridge.searchWithAI(document.getElementById('searchInput').value);
            }
        }
        
        function openDownloads() {
            if (window.AndroidBridge) {
                window.AndroidBridge.showDownloads();
            }
        }
        
        function openHistory() {
            if (window.AndroidBridge) {
                window.AndroidBridge.showHistory();
            }
        }
    </script>
</body>
</html>
```

---

## 四、品牌定制（Branding）

Kiwi Browser 的品牌定制已经在简历中提到了（修改名称、图标、适配屏幕密度）。这里补充更多细节：

### 4.1 品牌常量集中管理

```java
// chrome/browser/branding/BuildConfig.java
public final class BrandConfig {
    // 应用名称
    public static final String APP_NAME = "蛙蛙浏览器";
    public static final String APP_NAME_SHORT = "蛙蛙";
    
    // 书签文件夹名称
    public static final String BOOKMARK_BAR_NAME = "蛙蛙书签";
    public static final String BOOKMARK_MOBI_BOOKMARKS = "蛙蛙书签";
    
    // 产品 ID（用于 Google Analytics 等）
    public static final String PRODUCT_ID = "kwawa-browser";
    
    // 默认搜索引擎 ID
    public static final String DEFAULT_SEARCH_ENGINE = "kwawa_search";
    
    // 版权信息
    public static final String COPYRIGHT = "© 2026 蛙蛙浏览器";
    
    // 品牌色
    public static final int PRIMARY_COLOR = 0xFF2ECC71;  // 绿色青蛙主题
    public static final int PRIMARY_DARK_COLOR = 0xFF27AE60;
}
```

### 4.2 AndroidManifest 中的品牌配置

```xml
<!-- AndroidManifest.xml -->
<application
    android:label="@string/app_name"
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:theme="@style/KwawaTheme">
    
    <!-- 应用类别：浏览器 -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="http" />
        <data android:scheme="https" />
        <data android:scheme="kwawa" />  <!-- 自定义协议 -->
    </intent-filter>
</application>
```

### 4.3 strings.xml 品牌替换

```xml
<!-- res/values/strings.xml -->
<string name="app_name">蛙蛙浏览器</string>
<string name="bookmark_bar_name">蛙蛙书签</string>
<string name="bookmarks_folder_title">蛙蛙书签</string>
<string name="default_search_engine_name">蛙蛙搜索</string>
<string name="about_chromium">关于蛙蛙浏览器</string>
```

---

## 五、网盘入口集成

### 5.1 通过 Custom Tabs 集成外部网盘

```java
// chrome/android/java/src/org/chromium/chrome/browser/customtabs/KwawaDriveBridge.java
// 桥接层：在浏览器内嵌入网盘体验

public class KwawaDriveBridge {
    
    /**
     * 在浏览器内打开网盘文件
     */
    public static void openFileInBrowser(Context context, String fileId) {
        // 方案 1：通过 Custom Tab 打开网盘 Web 版
        CustomTabsIntent.Builder builder = new CustomTabsIntent.Builder();
        builder.setToolbarColor(ContextCompat.getColor(context, R.color.kwawa_primary));
        builder.setShareState(CustomTabsIntent.SHARE_STATE_OFF);
        builder.setCloseButtonIcon(BitmapFactory.decodeResource(
            context.getResources(), R.drawable.ic_back_kwawa));
        
        CustomTabsIntent tabsIntent = builder.build();
        tabsIntent.launchUrl(context, Uri.parse(
            "https://drive.kwawa.app/file/" + fileId));
    }
    
    /**
     * 方案 2：通过 Intent 调用系统下载管理器
     */
    public static void downloadViaSystemManager(Context context, String directUrl, String fileName) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(directUrl), "application/octet-stream");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        context.startActivity(intent);
    }
    
    /**
     * 方案 3：通过浏览器内置下载管理器
     */
    public static void downloadViaBrowser(Context context, String url, String referer) {
        // 调用 Chrome 的 DownloadService
        DownloadService.startDownload(context, url, referer);
    }
}
```

### 5.2 网盘直链解析（与 AdBlocker Lite 博客呼应）

```java
// 网盘直链解析服务
public class DirectLinkResolver {
    
    /**
     * 解析网盘分享链接为直链
     * 策略：拦截 API 响应 → 提取下载 URL
     */
    public static String resolve(String shareUrl) {
        // 1. 识别网盘类型
        String provider = detectProvider(shareUrl);
        
        // 2. 根据提供商调用不同的解析策略
        switch (provider) {
            case "aliyun":
                return resolveAliyun(shareUrl);
            case "quark":
                return resolveQuark(shareUrl);
            case "baidu":
                return resolveBaidu(shareUrl);
            default:
                return shareUrl;
        }
    }
    
    private static String resolveAliyun(String shareUrl) {
        // 阿里云盘：模拟登录 → 调用 /api/share/get_share_link 获取 share_token
        // → 调用 /api/v2/get_file_list 获取文件列表
        // → 调用 /api/v2/get_video_preview_token 获取视频预览 token
        // → 拼接直链
        // 
        // 这个逻辑可以在 Content Script（JS 层）或 shouldInterceptRequest（Java 层）实现
        return null;
    }
}
```

---

## 六、与后端对接（JD 第七条）

JD 第七条提到"与后端（Go/PHP）、产品对接，定义客户端接口"。这是浏览器定制中容易被忽视但极重要的一环。

### 6.1 客户端-服务端接口设计

```java
// 定义浏览器后端 API 接口
public interface KwawaApi {
    
    // 1. 搜索 API（对接自有搜索引擎）
    @GET("search")
    Call<SearchResponse> search(
        @Query("q") String query,
        @Query("engine") String engine,
        @Query("page") int page
    );
    
    // 2. AI 搜索 API
    @POST("ai/search")
    Call<StreamingResponse> aiSearch(
        @Body AiSearchRequest request
    );
    
    // 3. 网盘解析 API
    @POST("drive/resolve")
    Call<DirectLinkResponse> resolveDirectLink(
        @Query("url") String shareUrl,
        @Query("provider") String provider
    );
    
    // 4. 下载管理 API
    @POST("downloads/create")
    Call<DownloadResponse> createDownload(
        @Body DownloadRequest request
    );
}
```

### 6.2 与 Go 后端的对接示例

```go
// Go 后端（gin 框架）
package handler

import "github.com/gin-gonic/gin"

func Search(c *gin.Context) {
    q := c.Query("q")
    engine := c.DefaultQuery("engine", "kwawa")
    
    switch engine {
    case "kwawa":
        // 自有搜索引擎
        results := kwawaSearch.Search(q)
        c.JSON(200, gin.H{"results": results})
    case "kwawa_ai":
        // AI 搜索（调用 LLM）
        resp := callLLM(q)
        c.JSON(200, gin.H{"answer": resp})
    default:
        c.JSON(400, gin.H{"error": "unknown engine"})
    }
}
```

---

## 七、从 Kiwi Browser 源码中学习

### 7.1 关键源码路径

```
chrome/android/java/src/org/chromium/chrome/browser/
├── ChromeStartupController.java    ← 浏览器启动流程，NTP 设置
├── ChromeBrowserInitializer.java   ← 初始化搜索引擎、偏好设置
├── search/
│   ├── SearchEngineManager.java    ← 搜索引擎管理
│   ├── DefaultSearchManager.java   ← 默认搜索引擎
│   └── SuggestProvider.java        ← 搜索建议
├── download/
│   ├── DownloadServiceImpl.java    ← 下载服务实现
│   └── DownloadDialog.java         ← 下载对话框
├── ntp/
│   ├── NtpGridModel.java           ← 新标签页网格模型
│   └── AppSuggestIntegration.java  ← 应用建议集成
├── webapps/
│   └── WebAppService.java          ← Web App 安装
└── settings/
    ├── SettingsConstants.java      ← 设置常量
    └── Preferences.java            ← 偏好设置管理
```

### 7.2 Kiwi 的扩展桥接

```java
// Kiwi 的核心：ExtensionBridge
// 这是 Chrome 扩展能力在 Android 上的实现
public class ExtensionBridge {
    // 将 Chrome 扩展的 API 调用桥接到 Android 原生功能
    public static void handleMessage(ExtensionMessage msg) {
        switch (msg.getType()) {
            case "open_url":
                openUrl(msg.getData().getString("url"));
                break;
            case "show_downloads":
                showDownloads();
                break;
            case "search":
                search(msg.getData().getString("query"));
                break;
        }
    }
}
```

---

## 八、总结：Android 浏览器定制 Checklist

```
□ 1. 修改 BuildConfig 中的品牌常量（名称、ID、颜色）
□ 2. 替换 strings.xml 中的品牌文本
□ 3. 替换 res/ 中的图标和主题色
□ 4. 修改 SearchEngineManager 添加自有搜索引擎
□ 5. 强制设置默认搜索引擎（首次启动时）
□ 6. 定制 NTP 页面（添加网盘/AI 搜索入口卡片）
□ 7. 实现 CustomTabs 支持（允许其他 App 在浏览器内打开链接）
□ 8. 集成 DownloadManager（网盘直链下载）
□ 9. 定义客户端-服务端 API 接口（Retrofit + Go 后端）
□ 10. 编写 ProGuard 混淆规则（上架必备）
□ 11. 配置 App Signing（keystore 管理）
□ 12. 编写 Google Play 隐私政策页面
```

Android 浏览器定制的核心在于理解 **Chrome/Chromium 的 Android 层架构**——哪些功能在 Java/Kotlin 层实现，哪些需要通过 JNI 调用 C++ 层，哪些可以通过 Content Script 和 Web API 实现。掌握这个分层思维，比死记硬背具体代码更重要。

---

*参考项目：Kiwi Browser (github.com/kiwibrowser/src.next), Brave Browser, Supermium, Chromium (chromium.org)*
