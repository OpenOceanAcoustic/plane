# Material 弹出面板与字体修复

本轮依据用户 2026-10-11 的实际安装截图，修复系统默认选项窗口及规划页面字体。参考 [Google Material 3 / Reply 说明](https://developer.android.com/develop/ui/compose/designsystems/material3)，保留 V6 页面和业务结构，使用当前配色的统一面板。这是对早先固定 Liberation Sans 字体要求的明确更新。

## 实现约定

- 迁移原有 67 个移动端下拉选择器到共享 `MobileSelect`：主题色、圆角底部面板、选中标记、超过七项时搜索、多选完成按钮。保留实际表单控件、单选/多选、`name`、`defaultValue`、受控值、必填和禁用行为。
- 文档删除、共享评论删除及未同步文档离开确认使用统一主题面板。取消、返回、关闭和组件卸载均不执行操作；离开确认继续执行原导航回调。
- 完整 Roboto Regular/Medium/Bold 与完整 Noto Sans CJK SC Regular/Medium/Bold 随 APK 打包，单独声明 400/500/700，携带许可证及上游指纹。没有按示例文本裁剪字库。
- 规划页签、文件夹和看板标签使用 14px 字号、20px 行高、500 字重；文件夹视觉高度32px，触控区域48px。短屏保留滚动和固定底栏，四个常用标签完整显示，更多标签仍可水平滚动。
- 不新增后端接口；保留同一服务器、认证、权限、附件、协作、排期与资金行为。手机管理入口和导出仍禁用。

## 验证及交付约定

交付版本为 `OpenOceanAcoustic 1.0.5` / versionCode6，包名与发布证书保持一致。源码评审、构建检查、安装后局部 UI 观察分别记录；按用户要求不新增或运行业务及单元测试套件。

MuMu 的原始设置为 Android15/API35、WebView110.0.5481.154.1、1440×2560、density640、fontScale1。只通过实际设备操作观察正式签名 APK，不注入页面样式、脚本、会话或演示数据，不修改服务器业务数据。MuMu 独立应用显示区没有系统栏，必须单独注明，不能补画系统栏。

本轮局部检查不等于全 APP 严格像素验收。旧 [1.0.4 完整对照](android-v6-delivery.md) 的 52 首屏和12长页仅是历史结果，不归入1.0.5验收；其全部64项严格栅格未通过记录保持可查。本轮的深色、412px、长页和键盘检查未完成时需明确写出。

## 正式包身份

| 项目               | 值                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------- |
| 版本 / versionCode | 1.0.5 / 6                                                                                 |
| 包名               | `org.openoceanacoustic.mobile`                                                            |
| APK 对应源码       | `70ebb0557f98c69c463bfaa24547772f9d9b0c27`                                                |
| 字节数             | 39,891,845                                                                                |
| APK SHA-256        | `8a6adabeec5bea9fc3820252328d70b1934d99a2e0bebcab27d46fd548ebe52d`                        |
| 发布证书 SHA-256   | `6fab1f84864c680f21c34e5551005faba32ba8074a7ca9ed236e22faf9f3bed5`                        |
| PR                 | [OpenOceanAcoustic/plane #12](https://github.com/OpenOceanAcoustic/plane/pull/12)（草稿） |

签名校验通过，使用 APK v2 签名。通过 `android install -r` 覆盖安装，拉回设备的 `base.apk` 校验与交付包逐字节一致，保留用户0既有会话。发布密钥未进入 Git 或材料。

## 实际观察

20张1440×2560原始PNG及逐图SHA绑定上面同一个包，实际应用区为逻辑360×640、MuMu显示区21、task42、user0。未更改分辨率、density或fontScale。曾误采MuMu空白显示区22，该原图仅留在私有诊断目录，不纳入交付观察。CLI默认显示区的layout返回桌面，screen无法取得有效应用PNG，故采用只读 `IWindowManager.captureDisplay` 原生截图；交付保存调用源文件及指纹。没有通过WebView调试注入页面、重新绘制系统栏或修改图片。

| 检查           | 本版实际结果                                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| 资金项目选择   | 新底部面板、选中标记可见；选择fortest后标题与内容切换，再打开仍正确选中               |
| 选择器返回     | 单次系统返回只关闭面板，项目选择保留                                                  |
| 文件夹标签     | 全部、aa、dd、未分类四项在360px完整显示；点击dd切换空文件夹，看板标题及标签更新       |
| 表单内嵌套面板 | 新建事项默认文件夹/分类显示；一次返回关闭文件夹选项，第二次返回关闭表单；未保存       |
| 文档项目选择   | 同一主题面板，选择后展示真实项目文档列表（当前为空）                                  |
| 三处确认框     | 源码规格/规范评审通过；当前账号没有文档或共享评论，未原生触发，未为采图创建或删除记录 |

TypeScript、OxLint、Oxfmt、Vite、Capacitor同步、签名release构建通过。规范与规格双评审发现的受控异步选择显示、富文本焦点、安全区域和初始Tab边界问题已修正。Chrome110静态字体诊断的18个探针均使用打包字体；这只是源码兼容检查，不宣称已追踪release WebView实际选中的字体。

本版未重新检查深色、412px、展开长页、键盘遮挡或真实系统栏，也未完成全APP严格像素验收。搜索/多选/必填/禁用及三个确认框的边界只做源码检查，未提交业务操作进行验证。旧64图的未通过项仍保留，PR继续保持草稿；没有运行单元或业务测试套件。

## 安装及重复构建

交付目录为 `/mnt/repo/ly/android-delivery/OpenOceanAcoustic-1.0.5`，含APK、校验值、签名记录、20张原生图、构建及内嵌资源清单、字体许可证和采图源文件；旧版文件不覆盖。下载服务使用独立50013端口，业务服务50010保持不变。

```sh
sha256sum -c OpenOceanAcoustic-1.0.5.apk.sha256
adb install -r OpenOceanAcoustic-1.0.5.apk
```

已有账号覆盖安装保留数据。服务器根地址填写 `http://192.168.137.90:50010`，不添加 `/api`；`0.0.0.0:50010` 是监听地址。frp部署后填写实际公网HTTP/HTTPS根地址。

在独立工作树检出上述源码提交，用Node22、pnpm11、JDK21、Android SDK36和既有私有签名配置构建：

```sh
export JAVA_HOME=/absolute/path/to/jdk-21
export ANDROID_HOME=/absolute/path/to/android-sdk
export GRADLE_USER_HOME=/absolute/path/to/isolated-gradle-cache
export OOA_ANDROID_SIGNING_FILE=/private/path/to/signing.properties
tools/mobile/build-apk.sh /absolute/path/to/new-output --skip-tests
```

干净检出不加 `--skip-dependencies`；本轮复用已构建共享依赖时使用了该参数。构建不部署网页或后端。流程及发布证书可复用，工具链或归档时间变化时不承诺APK字节相同；用实际SHA识别下载包和设备包。
