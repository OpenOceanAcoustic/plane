# V6 安卓交付记录

本轮源代码已实现 V6 的 13 个基准页面及其它页面的公共组件，安装后视觉验收正在进行。本记录中的待完成项不能视为通过。未增加或运行业务、单元测试套件，业务验收由用户执行。

## 构建身份

| 项目               | 值                                                                                |
| ------------------ | --------------------------------------------------------------------------------- |
| 应用 / 包名        | OpenOceanAcoustic / `org.openoceanacoustic.mobile`                                |
| 版本 / versionCode | 1.0.4 / 5                                                                         |
| APK 对应源码       | `e6d028f1f79f18148741581ddfde19512aa71fe8`                                        |
| 候选包字节数       | 39,969,801                                                                        |
| 候选包 SHA-256     | `39dcd91971e4266847cb92177de5f8824dd56a9b3427a9556e051682790508ae`                |
| 发布证书 SHA-256   | `6fab1f84864c680f21c34e5551005faba32ba8074a7ca9ed236e22faf9f3bed5`                |
| 设计 ZIP SHA-256   | `a22370a06f7ed0474040eaba8fb46e58a8886f9c1361424938a56ada54071889`                |
| PR                 | [OpenOceanAcoustic/plane #12](https://github.com/OpenOceanAcoustic/plane/pull/12) |

字体随 APK 固定打包：Liberation Sans 2.1.5 Regular/Bold，Noto Sans CJK SC 2.004 Regular/Medium/Bold；完整字库及 OFL 许可证位于 `apps/mobile/public/fonts/v6`。字重与设计绑定，不使用系统替代字体或合成字重。完整字库使本版 APK 大于历史版本。

参考清单见 [64 张图片指纹](android-v6-reference.json)，实现规格见 [V6 规格](android-v6-alignment.md)，规范与规格评审及修正见 [评审记录](android-v6-review.md)。

## 安装与服务器

使用同一发布密钥覆盖安装即可保留已有应用数据；不要卸载旧版后再安装。

```sh
sha256sum -c OpenOceanAcoustic-1.0.4.apk.sha256
adb install -r OpenOceanAcoustic-1.0.4.apk
```

首次启动输入手机可以访问的部署根地址：局域网部署为 `http://192.168.137.90:50010`，不附加 `/api`。`0.0.0.0:50010` 是服务监听地址，不能作为手机连接地址。使用 frp 后填写实际公网 HTTP/HTTPS 根地址。切换服务器会退出账号并清除会话与业务缓存。

网页与手机继续使用同一后端，本轮未新增后端接口。保留动态码认证、角色权限、附件、协作文档、排期冲突检查、资金幂等及十进制金额行为。手机管理员入口及数据导出继续禁用；电脑管理与服务器生成一次性注册链接沿用 [共享部署说明](shared-web-mobile-deployment.md)。当前 50010 服务、已发布网页文件及用户业务数据未作修改。

最低 Android 7 / API 24；需要 System WebView 95 或更新版本。旧版本提供原生更新提示。离线写入、额外系统推送、iOS 和商店上架不属于本次交付。

## 重复构建

在独立工作树中检出上面的源码提交，使用 Node 22、pnpm 11、JDK 21、Android SDK platform/build-tools 36。复用已有发布密钥，不重新生成密钥；私钥和密码不进入 Git 或交付材料。

```sh
export JAVA_HOME=/absolute/path/to/jdk-21
export ANDROID_HOME=/absolute/path/to/android-sdk
export GRADLE_USER_HOME=/absolute/path/to/isolated-gradle-cache
export OOA_ANDROID_SIGNING_FILE=/private/path/to/signing.properties
tools/mobile/build-apk.sh /absolute/path/to/new-output --skip-tests
```

构建脚本安装锁定依赖、构建工作区依赖、执行 TypeScript/Vite、同步 Capacitor、构建签名 release、校验签名和写入 SHA-256。已准备共享包产物时可加 `--skip-dependencies`；干净检出不要使用该参数。源码 CSS 在完整打包后转换 cascade layers，以保留 WebView 95 兼容性。构建不发布网页、不安装 APK，也不修改运行中的服务。

重复构建说明保证构建流程与签名身份可复用；若工具链或归档时间不同，不把重新构建字节相同当作未经验证的承诺。交付包身份用 SHA-256、证书及内嵌资源指纹核对。

## 实际验收边界

TypeScript、OxLint、Oxfmt、Vite、Android release 构建和签名校验已通过；独立规范与规格评审发现的兼容性、字体、返回图标、标题和组件入口问题已修正。

浏览器源码诊断覆盖 52 张首屏、316 个组件配对，检查尺寸、颜色和字体属性；它只用于定位源码差异，不是 APK 验收。

实际 MuMu 为 Android 15 / API 35、WebView 110.0.5481.154.1，原设置为 1440×2560、density 640、fontScale 1。在独立 Android 测试账号安装候选 APK，使用隔离真实后端的数据场景；用户原账号的服务器、会话、缩放与业务数据保持不变。安装后 52 张首屏、12 张展开长页及原缩放短屏/返回/弹层/键盘记录尚在制作中。

基准应用区域是 828px；参考第 829 行单独记录为边界取整。真实系统栏、参考预览外框及文字抗锯齿差异单列，不修改参考图，不注入临时应用样式。原始设备截图保留，裁切/密度归一化/差异图/长页拼接均标为派生材料。最终结论必须对应同一个签名 APK，不能用过程包或浏览器截图代替。
