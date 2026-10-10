# OpenOceanAcoustic 安卓版安装与构建

当前 V6 / 1.0.4 的构建身份、安装说明和设备验收状态见 [V6 交付记录](android-v6-delivery.md)。以下保留 1.0.2 的历史交付记录；其浏览器对照不代表新版安装验收。

应用：OpenOceanAcoustic 1.0.2（`org.openoceanacoustic.mobile`）。源码位于同一仓库的 `apps/mobile`，已合入 `ooa/main`；主应用和 Space 使用独立移动界面及真实后端接口，按 [V4 设计](android-v4-alignment.md) 对齐。God Mode 仅供电脑网页使用。

本次交付文件位于 `/mnt/repo/ly/android-delivery/OpenOceanAcoustic-1.0.2/`，APK 为 4,390,684 字节，Android versionCode 为 3。源码提交、实际签名和构建文件指纹记录在交付目录 `release-info.json`，可用于核对构建来源。

SHA-256：`69bb67f91674fa4f98d5369a9c8a6a73f756d49e98df7a73fff302e230b42484`。

用户于 2026-10-10 决定自行测试，后续测试已停止。1.0.2 的类型、静态 lint、构建、manifest 和签名检查通过，未执行新版业务、单元、安装或模拟器测试。只读浏览器对照使用隔离展示数据，覆盖 360/412px 和浅深色的 13 个主要页面，不代表设备或全量操作验收。1.0.0 的原生 HTTP/Keystore 及浏览器证据仅代表旧版，安卓 React 界面验收未完成；实际边界见验收记录。

## 安装

1. 将签名的 `OpenOceanAcoustic-1.0.2.apk` 传到手机，允许当前文件管理器安装此应用，然后打开 APK 安装。
2. 首次打开输入手机能访问的部署根地址，当前填 `http://192.168.137.90:50010`；无需添加 `/api` 路径。
3. 使用现有实验室用户名和 Authenticator 六位动态码登录。手机没有 God Mode 入口；管理员在电脑打开同一服务器的 `/god-mode/` 登录。
4. 切换服务器会退出账号、清除会话和业务缓存；同一发布密钥签名的后续 APK 可以直接覆盖安装。

最低系统为 Android 7（API 24）。需要 Android System WebView/Chrome 95 或更新版本；旧组件会显示更新提示。Android 7 的系统组件可使用其最后支持版本 Chromium 119。手机需保持在线进行业务写入。

共享服务监听 `0.0.0.0:50010`，手机与网页使用同一数据库、附件和认证密钥。API 包含 `mobile_api_version: 1`、普通移动登录、会话能力及 Live 一次性票据。移动管理员登录和管理请求返回 403；旧移动管理会话同样被拒绝。电脑管理员使用现有动态码登录，首次绑定及成员注册使用服务器 SSH 生成的一次性邀请链接；旧邮件邀请已关闭。新版采用原发布密钥签名，可覆盖安装 1.0.0 或 1.0.1。旧完整发布目录保留，新构建使用独立目录。详见 [共享部署记录](shared-web-mobile-release.md)。

手机不提供数据导出；服务端和 Live 同时拒绝移动会话的专用导出。正常数据查询、协作文档同步和已有附件的授权下载继续可用。

命令行安装或校验：

```sh
sha256sum -c OpenOceanAcoustic-1.0.2.apk.sha256
adb install -r OpenOceanAcoustic-1.0.2.apk
```

## 电脑管理与一次性成员邀请

在服务器仓库根目录执行；只生成所需链接，不开放手机管理员登录：

```sh
# 仅首次初始化管理员；已有管理员时不会另建。
sh backend.sh
# 为已有工作区生成普通成员一次性注册链接（role 15）。
sh backend.sh invite --workspace openoceanacoustic --role 15
```

使用命令输出的链接。确认 Authenticator 绑定后邀请令牌即失效，之后账号使用动态码登录；查看链接不会直接消费令牌。工作区标识按实际部署填写。

## 保留签名与重复构建

要求 Node 22、pnpm 11、JDK 21、Android SDK platform/build-tools 36。应用的 Gradle wrapper 由仓库提供；首次构建需要联网下载依赖。

```sh
export JAVA_HOME=/absolute/path/to/jdk-21
export ANDROID_HOME=/absolute/path/to/android-sdk
export GRADLE_USER_HOME=/absolute/path/to/isolated-gradle-cache
# 仅首次创建；后续构建必须复用已有私钥，不要重新生成。
tools/mobile/create-release-key.sh /private/path/to/android-release
export OOA_ANDROID_SIGNING_FILE=/private/path/to/android-release/signing.properties
tools/mobile/build-apk.sh /absolute/path/to/output --skip-tests
```

构建脚本执行锁定依赖安装、工作区依赖构建、TypeScript 检查、Vite 构建、Capacitor 同步和 release 构建，随后校验 APK 签名并生成 SHA-256。默认会执行原生单元测试；`--skip-tests` 明确跳过测试，本次采用该参数。共享包已准备时，可额外使用 `--skip-dependencies`，避免重复写共享构建目录。私钥与密码保存在 Git 外的私有目录。请单独备份整套签名资料；重新生成密钥无法覆盖安装已发布版本。

本次私钥持续保存在工作树外 `/mnt/repo/ly/.android-release/`，不包含在源码或交付 APK 中。交付签名证书指纹由输出的 `signature-verification.txt` 提供。

## 范围与验收记录

[全部 V4 屏幕映射](android-screen-coverage.md)、[业务验证](android-business-validation.md)、[核心 API 与界面覆盖](android-core-coverage.md)、[移动后端契约](../../apps/api/docs/mobile-api.md)、[原生构建说明](../../tools/mobile/README.md)。实际命令、设备和发布文件校验见 [验收记录](android-app-progress.md)。

通知使用既有站内通知；未加入离线写入、额外系统推送、iOS 或应用商店上架。语言偏好保存至账号，首版移动界面使用中文。
