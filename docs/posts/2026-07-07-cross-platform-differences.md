# 跨平台开发的平台差异与解决方案：iOS / Android / 鸿蒙 实战对比

> 做了几年跨平台移动开发（Flutter / React Native），每次适配新平台都要踩一遍"同一个功能、不同写法"的坑。这篇文章把 iOS、Android、鸿蒙（HarmonyOS）三端的核心差异和统一解决方案整理出来，给准备做跨平台或三端统一的技术团队参考。

---

## 一、为什么需要关注三端差异？

跨平台框架（Flutter、React Native）解决了"写一份 UI 逻辑跑三端"的问题，但**平台桥接层（Platform Channel / Native Module）和原生功能适配**仍然是每个跨平台项目无法绕开的部分。常见的痛点：

```
同一个功能 → 三套原生实现 → 三套测试用例 → 三倍的 Bug 概率
```

以"安全存储密钥"为例：

| 维度 | iOS | Android | 鸿蒙 |
|------|-----|---------|------|
| 存储方案 | Keychain | Android Keystore | 鸿蒙安全存储（HUKS） |
| 生物识别 | LocalAuthentication | BiometricPrompt | 鸿蒙生物认证（UserAuth） |
| 加解密算法 | CommonCrypto | BouncyCastle / Conscrypt | 鸿蒙 Cypher Kit |
| 密钥隔离 | 硬件安全区（Secure Enclave） | TEE（StrongBox） | 鸿蒙可信执行环境（TEE） |

**核心结论**：跨平台的 UI 可以统一，但安全、权限、生命周期、推送、支付等系统级功能必须逐平台适配。下面从 8 个维度逐一展开。

---

## 二、UI 渲染体系对比

### 2.1 声明式 UI 三叉戟

| 维度 | Android | iOS | 鸿蒙 |
|------|---------|-----|------|
| 框架 | Jetpack Compose | SwiftUI | ArkUI（声明式） |
| 语言 | Kotlin | Swift | ArkTS（TypeScript 方言） |
| 布局模型 | Column/Row/Box | VStack/HStack/ZStack | Column/Row/Stack |
| 状态管理 | MutableState + StateFlow | @State / @Observable | @State / @Prop / @Link |
| 重组/刷新 | 重组范围自动优化 | 依赖跟踪自动刷新 | 状态变量驱动刷新 |

### 2.2 Flutter 如何统一三端

Flutter 使用 Skia/Impeller 自绘引擎，**不依赖平台原生 UI 组件**，所以 UI 层在三端表现一致。但在以下场景仍需平台适配：

```dart
// Flutter Platform Channel —— 三端统一的桥接模式
// Dart 端
final result = await platform.invokeMethod('getBiometricStatus');

// Android 端（Kotlin）
channel.setMethodCallHandler { call, result ->
    if (call.method == "getBiometricStatus") {
        val biometricManager = BiometricManager.from(context)
        result.success(biometricManager.canAuthenticate())
    }
}

// iOS 端（Swift）
channel.setMethodCallHandler { call, result in
    if call.method == "getBiometricStatus" {
        let context = LAContext()
        var error: NSError?
        result.success(context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error))
    }
}

// 鸿蒙端（ArkTS）
channel.setMethodCallHandler((call) => {
    if (call.method === 'getBiometricStatus') {
        const auth = new userAuth.UserAuth();
        result.success(auth.authSupported());
    }
});
```

**差异点**：Android 需要传递 Activity 上下文；iOS 需要确保在主线程调用 LAContext；鸿蒙的 UserAuth 模块需要先申请 `ohos.permission.ACCESS_BIOMETRIC` 权限。

---

## 三、生命周期管理

| 阶段 | Android Activity | iOS UIViewController | 鸿蒙 Page |
|------|-----------------|---------------------|-----------|
| 创建 | onCreate() | viewDidLoad() | aboutToAppear() |
| 可见 | onStart() / onResume() | viewWillAppear() / viewDidAppear() | onPageShow() |
| 暂停 | onPause() | viewDidDisappear() | onPageHide() |
| 停止 | onStop() | - | - |
| 销毁 | onDestroy() | deinit | aboutToDisappear() |
| 配置变更 | onConfigurationChanged() | traitCollectionDidChange | onConfigurationUpdate() |

### 3.1 Flutter 侧的抽象

Flutter 通过 `WidgetsBindingObserver` 统一三端生命周期：

```dart
class LifecycleAwareWidget extends StatefulWidget {
  @override
  State<LifecycleAwareWidget> createState() => _LifecycleAwareWidgetState();
}

class _LifecycleAwareWidgetState extends State<LifecycleAwareWidget>
    with WidgetsBindingObserver {

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        // Android onResume / iOS viewDidAppear / 鸿蒙 onPageShow
        break;
      case AppLifecycleState.paused:
        // Android onPause / iOS viewDidDisappear / 鸿蒙 onPageHide
        break;
      case AppLifecycleState.inactive:
        // Android onStart → onResume 之间
        break;
      case AppLifecycleState.detached:
        // Android onDestroy / iOS deinit
        break;
    }
  }
}
```

### 3.2 注意差异

- **Android**：Activity 可能被系统回收（onSaveInstanceState 存储状态）
- **iOS**：ViewController 通常不被系统回收，但需要处理 Memory Warning
- **鸿蒙**：Page 的 `aboutToDisappear` 不一定被调用（类似 Android 的 onStop vs onDestroy）

### 3.3 跨平台状态恢复方案

```dart
class StateRestorationService {
  // Android: onSaveInstanceState → Bundle
  // iOS:  stateRestorationActivity / NSUserActivity
  // 鸿蒙: LocalStorage + AppStorage

  static Future<void> saveState(Map<String, dynamic> state) async {
    await Future.wait([
      SharedPreferences.save(state),           // 通用方案
      SecureStorage.save(state),                // 敏感数据
    ]);
  }

  static Future<Map<String, dynamic>> restoreState() async {
    return {
      ...await SharedPreferences.load(),
      ...await SecureStorage.load(),
    };
  }
}
```

---

## 四、安全存储与加解密

这是跨平台开发中**差异最大的模块**之一。

### 4.1 密钥管理方案对比

```kotlin
// Android —— Android Keystore + 生物识别解锁
val keyGen = KeyPairGenerator.getInstance("Ed25519", "AndroidKeyStore")
keyGen.initialize(
    KeyGenParameterSpec.Builder("my-key", KeyProperties.PURPOSE_SIGN)
        .setUserAuthenticationRequired(true) // 需要生物识别
        .setUserAuthenticationValidityDurationSeconds(300)
        .build()
)
val keyPair = keyGen.generateKeyPair()
```

```swift
// iOS —— Keychain + Secure Enclave
let attributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeEC,
    kSecAttrKeySizeInBits as String: 256,
    kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
    kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: "com.doai.my-key",
    ]
]
var error: Unmanaged<CFError>?
guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
    throw KeyError.generationFailed
}
```

```typescript
// 鸿蒙 —— HUKS（Harmony Universal KeyStore）
import { huks } from '@kit.UniversalKeyStore';

const keyAlias = 'my_key';
const properties: huks.HuksOptions = {
    properties: [
        { tag: huks.HuksTag.PURPOSE, value: huks.HuksPurpose.SIGN },
        { tag: huks.HuksTag.KEY_SIZE, value: huks.HuksKeySize.ED25519_KEY_SIZE_256 },
        { tag: huks.HuksTag.KEY_ALGORITHM, value: huks.HuksKeyAlgorithm.ED25519 },
        { tag: huks.HuksTag.USER_AUTH_TYPE, value: huks.HuksUserAuthType.BIOMETRIC },
        { tag: huks.HuksTag.USER_AUTH_CHALLENGE, value: new Uint8Array(32) },
    ]
};
huks.generateKeyItem(keyAlias, properties, (err, data) => {
    if (err) throw new Error('HUKS key generation failed');
});
```

### 4.2 Flutter 统一封装

```dart
// flutter_secure_storage + local_auth 封装
class SecureKeyManager {
  static Future<bool> storePrivateKey(String keyId, List<int> keyData) async {
    // Android: 存入 EncryptedSharedPreferences (AEAD 加密)
    // iOS: 存入 Keychain (kSecClassGenericPassword)
    // 鸿蒙: 存入 HUKS PersistentKey
    await FlutterSecureStorage().write(
      key: keyId,
      value: base64Encode(keyData),
      aOptions: _getAndroidOptions(),
      iOptions: _getIOSOptions(),
    );
    return true;
  }

  static AndroidOptions _getAndroidOptions() {
    return const AndroidOptions(
      encryptedSharedPreferences: true,
      minSdkVersion: 23,
    );
  }

  static IOSOptions _getIOSOptions() {
    return const IOSOptions(
      accessibility: KeychainAccessibility.passcode_this_device_only,
      authenticationType: BiometricType.biometricsAny,
    );
  }
}
```

**重要差异**：
- Android `EncryptedSharedPreferences` 基于 AES-256 GCM，但密钥在应用级别，不像 Keychain/HUKS 是系统级隔离
- iOS Keychain 在备份恢复时会保留，Android Keystore 不会随备份迁移
- 鸿蒙 HUKS 的密钥材料与设备绑定，**无法跨设备迁移**

---

## 五、权限模型对比

| 场景 | Android | iOS | 鸿蒙 |
|------|---------|-----|------|
| 权限声明 | AndroidManifest.xml | Info.plist | module.json5 |
| 运行时请求 | ActivityResultLauncher | CLLocationManager.requestWhenInUseAuthorization | abilityAccessCtrl.requestPermissionsFromUser |
| 权限分组 | 普通/危险/签名 | 静态/运行时敏感权限 | normal/system_grant/user_grant |
| 用户拒绝后 | 可以再次请求（有 2 次限制） | 被拒绝后系统弹窗不再出现，须引导去设置 | 可重复请求但需说明理由 |
| 权限撤回 | 用户可在设置中随时关闭 | 同左 | 同左 |

### 5.1 Flutter 跨平台权限封装

```dart
// permission_handler 插件 —— 统一的三端权限调用
Future<bool> requestCameraPermission() async {
  final status = await Permission.camera.request();
  switch (status) {
    case PermissionStatus.granted:
      return true;
    case PermissionStatus.denied:
      // Android: 可以再请求一次
      // iOS: 已被拒绝时引导去设置
      // 鸿蒙: 可以再次请求
      if (Platform.isIOS && status.isPermanentlyDenied) {
        await openAppSettings();
      }
      return false;
    case PermissionStatus.permanentlyDenied:
      await openAppSettings();
      return false;
    default:
      return false;
  }
}
```

---

## 六、推送通知

| 维度 | Android | iOS | 鸿蒙 |
|------|---------|-----|------|
| 推送服务 | FCM（Google） + 厂商通道 | APNs | 鸿蒙推送服务（HMS Push） |
| 统一方案 | 各厂商 SDK + FCM 兜底 | APNs 单通道 | HMS Push Kit |
| 通知分类 | NotificationChannel | UNNotificationCategory | NotificationSlot |
| 富媒体 | BigPicture / InboxStyle | UNNotificationAttachment | 鸿蒙富媒体通知 |

### 6.1 跨平台推送集成架构

```
                    ┌─────────────────────┐
                    │   Flutter 统一层     │
                    │  (firebase_messaging)│
                    └──────┬──────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────────┐
   │  FCM     │    │  APNs    │    │  HMS Push    │
   │ Android  │    │  iOS     │    │  鸿蒙        │
   └──────────┘    └──────────┘    └──────────────┘
```

**注意**：Android 在国内必须接入各厂商推送（华为/小米/OPPO/vivo），不能只依赖 FCM。鸿蒙设备上可以直接用 HMS Push Kit，不需要额外厂商适配。

---

## 七、支付集成

| 维度 | Android | iOS | 鸿蒙 |
|------|---------|-----|------|
| 应用内支付 | Google Play Billing | StoreKit 2 | IAP Kit（HMS） |
| H5 支付 | WebView + 支付宝SDK | WKWebView + 支付宝SDK | WebView + 支付宝SDK |
| 微信支付 | 微信 SDK（JAR） | 微信 SDK（Framework） | 微信 SDK（鸿蒙版） |
| 签名算法 | RSA2（支付宝） | RSA2 | RSA2（相同） |

**关键差异**：三端的支付宝 SDK 接口不同，但签名算法一致。服务端可以统一生成签名，客户端只需调起支付：

```dart
Future<bool> processPayment({
  required String provider,  // 'alipay' | 'wechat' | 'iap'
  required String orderInfo,
}) async {
  switch (provider) {
    case 'alipay':
      // Android: AlipaySDK.pay(orderInfo)
      // iOS: AlipaySDK.pay(orderInfo, callback)
      // 鸿蒙: alipay.pay({orderInfo})
      return _payWithAlipay(orderInfo);
    case 'wechat':
      // Android: WXPayApi.sendReq(req)
      // iOS: WXApi.send(req)
      // 鸿蒙: wechat.pay({partnerId, prepayId, ...})
      return _payWithWechat(orderInfo);
    case 'iap':
      // 仅 iOS / 鸿蒙适用
      return _payWithInAppPurchase(orderInfo);
  }
}
```

---

## 八、构建与分发

| 维度 | Android | iOS | 鸿蒙 |
|------|---------|-----|------|
| 开发语言 | Kotlin/Java | Swift/ObjC | ArkTS/TS |
| 构建工具 | Gradle | Xcode Build | DevEco Hvigor |
| 应用签名 | apksigner + Keystore (JKS) | codesign + Apple Developer | HapSignTool + 鸿蒙证书 |
| 应用包格式 | APK / AAB | IPA | HAP / App Pack |
| 分发渠道 | Google Play / 国内商店 | App Store | 鸿蒙应用市场 |
| 审核周期 | 数小时～2 天 | 1～7 天 | 1～3 天 |

### 8.1 Flutter 构建配置差异

```dart
// flutter_secure_storage 平台配置
// android/app/build.gradle
defaultConfig {
    minSdkVersion 23   // KeyStore 要求 API 23+
    targetSdkVersion 34
}

// ios/Podfile
platform :ios, '13.0'  // Keychain 生物识别要求 iOS 13+

// 鸿蒙: oh-package.json5
{
  "minAPIVersion": 9,  // HUKS 要求 API 9+
  "targetAPIVersion": 12
}
```

---

## 九、总结：跨平台适配清单

```
开发阶段 ──────────────────────────────────────────────
□ 安全存储：Keystore / Keychain / HUKS 三端实现
□ 生物识别：BiometricPrompt / LAContext / UserAuth
□ 生命周期：Flutter WidgetsBindingObserver 统一监听
□ 权限管理：permission_handler + 平台特定引导逻辑
□ 推送通知：FCM + APNs + HMS Push 三通道

构建阶段 ──────────────────────────────────────────────
□ 签名：JKS / Apple Developer / 鸿蒙证书
□ 版本号：统一管理 versionCode + versionName
□ 混淆：ProGuard / Swift Obfuscation / 鸿蒙混淆

发布阶段 ──────────────────────────────────────────────
□ Google Play：AAB + 签名方案 v4
□ App Store：IPA + TestFlight + App Store Connect
□ 鸿蒙市场：HAP + App Pack + 上架审核
```

### 几句实在话

1. **不要相信"一套代码跑三端"的完美神话**。UI 层可以，但系统级功能必须逐端适配。
2. **用 Platform Channel 抽象统一接口**，每个平台内部实现细节屏蔽在原生侧。
3. **优先用成熟的社区插件**（permission_handler、flutter_secure_storage、local_auth），它们已经踩过大部分坑。
4. **鸿蒙的 ArkUI + ArkTS 学习曲线不高**（如果你熟悉 Compose 或 SwiftUI），但 HUKS、UserAuth、推送等系统 Kit 跟 Android/iOS 差异明显，需要专门适配。
5. **三端统一测试**：自动化测试要覆盖每个平台的原生桥接路径，不能只在模拟器上跑。

---

*这篇是跨平台系列的第一篇。后续计划写具体的 Flutter Platform Channel 插件开发实战和鸿蒙原生模块接入指南。*


**文章信息**
- 日期：2026-07-07
- 标签：Flutter / 跨平台 / iOS / Android / 鸿蒙 / HarmonyOS / Platform Channel
