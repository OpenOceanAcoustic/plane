# 安装后 UI 修正

状态：进行中。不能把浏览器呈现、编译检查或资源 hash 相等写成 Android 视觉验收通过。

## 基准与范围

源码基准 `ec7ebea68725cf4fbfe5ec4695198ce3c898e203`；交付 APK 1.0.2，版本码 3，SHA-256 `69bb67f91674fa4f98d5369a9c8a6a73f756d49e98df7a73fff302e230b42484`。已通过 ADB 从用户设备拉取安装包，SHA-256 与交付文件完全相同；用户安装的版本与构建身份已确认。

用户提供的已安装首页截图尺寸为 533×935 图像像素；不能据此推算 CSS viewport、设备密度或字体倍率。设备为 Windows 宿主机上的 MuMu，用户已授权临时查看和操作模拟器；实际连通地址为 `192.168.137.45:5555`。不改用户系统缩放以迎合设计，也不修改真实记录。

已读设备信息：Android 15 / SDK 35；WebView `com.android.webview` 110.0.5481.154.1；`wm size` 为 1440×2560，`wm density` 为 640，逻辑屏幕尺寸 360×640dp，`font_scale` 为 1.0。模拟器上报 vivo V2284A，这是模拟设备标识，不是实际 vivo 手机测试。原始 screencap 为 1440×2560，保留系统栏；原始 PNG、安装包和只读信息保存在审计目录的 `native-before/`，不发布用户会话或业务数据。

继续沿用 V4、原 APK 包名、发布密钥和真实后端。当前明确修正首页已有便签分支和原来漏做的 `native-stickies` 页面；其它实机差异需要原始设备画面与几何信息，不能以新展示数据掩盖。

## 已复现的具体症状

后端 `Sticky.name` 允许 null，网页主要保存 HTML 内容和背景色。输入 `name:null`、`description:{}`、`description_html:"<p></p>"` 时，1.0.2 的 Home 显示字面标题“—”与两个通用大按钮；这是合法数据，不能当作账号或后端异常。

诊断命令：

```sh
node /mnt/repo/ly/android-delivery/installed-ui-audit-20261010/reproduce-home-null-note.cjs
```

修正前已执行，退出码 1，输出 `DEFECT_REPRODUCED`，具体项为 `valid untitled sticky rendered as a dash title` 和 `generic large edit/delete buttons on the note card`。`null-note-before.json` 保存结果。这是当前组件的桌面 Chromium 合同重放，使用隔离合成响应、没有注入应用 CSS 或原生 inset；不是原生实机或全量视觉验证。

## 修正要求

- Home 的记录态使用紧凑内容卡，不为合法无标题记录生成“—”，不把 JSON 富文本对象强制转为 HTML 字符串。
- 编辑、删除采用小操作入口和明确的删除确认，避免两颗通用大按钮挤占卡片。已有记录不沿用空态的固定 360px 最小留白。
- `native-stickies` 对应独立真实页面：搜索、颜色筛选、记录日期、更多记录、创建与编辑；不能继续仅映射到 Home 并声称覆盖。
- 使用真实 `background_color` 色键；V4 最终记录卡为白色 surface，并未接入规格中的整卡 tone。保留白底，颜色以小色标和原色选项体现，不据此另造整套皮肤。
- 标题不强制必填；保存只使用符合合同的 name、description_html、background_color。修改标题和颜色不得损失原有 HTML 内容或附件。
- 搜索必须说明和落实实际覆盖范围；真实后端只搜索正文，不能把已加载一页的本地筛选称作全量标题搜索。
- 保留真实 API、用户权限、会话、系统返回和用户业务数据。手机管理员入口与导出限制继续生效。

## 实机证据要求

连通后记录已安装包版本与资源身份、Android/WebView 版本、wm size/density、font_scale，以及原始 screencap。原始截图保留系统栏，不调大模拟器画布，不为截图注入样式，不替换真实数据；示例数据或隔离重放必须单独标明。

与 V4 比较时保留原设计文件。任何裁切、显示缩放或内容状态差异都逐项记录；不得以修改参考几何后得出的图片证明逐像素一致。真实设备看到的未解决差异继续列出。

用户要求自行测试，不增加业务或单元测试套件；本次仅做授权的设备查看、问题诊断和构建所需检查。发布前列出实际完成的检查与尚未完成的验收。
