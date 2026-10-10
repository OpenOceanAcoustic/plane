# Web 与 Android 共享发布记录

2026-10-10 已把移动端与现有功能合入 `ooa/main`，并发布到当前运行实例。产品合并提交为 `5b6643aa53a43509a99cdacdfcd562cb6f42315a`；之后的文档提交不改变运行代码。

| PR                                                      | 内容                       | 状态   |
| ------------------------------------------------------- | -------------------------- | ------ |
| [#4](https://github.com/OpenOceanAcoustic/plane/pull/4) | 我的项目与 VC              | 已合并 |
| [#5](https://github.com/OpenOceanAcoustic/plane/pull/5) | 悬赏发布输入与导航         | 已合并 |
| [#7](https://github.com/OpenOceanAcoustic/plane/pull/7) | 项目与任务文档上传         | 已合并 |
| [#6](https://github.com/OpenOceanAcoustic/plane/pull/6) | 公网安全、认证与限额       | 已合并 |
| [#8](https://github.com/OpenOceanAcoustic/plane/pull/8) | Android 应用与共享移动接口 | 已合并 |

## 实际入口

- Caddy 宿主机监听 `0.0.0.0:50010`，原 8080 入口已停止。
- 手机和电脑的当前根地址：`http://192.168.137.90:50010`。
- 主站 `/`、God Mode `/god-mode/`、Space `/spaces/`、API `/api/`、Live `/live/` 和附件 `/uploads/` 共用该入口。
- 后端、worker 和定时任务使用同一 API 镜像、现有 PostgreSQL、Redis、RabbitMQ、Minio 和认证密钥；没有另建手机业务数据库。
- 旧会话需重新登录。Android 会话不允许专用数据导出，普通查询、授权附件和文档同步继续保留。

现用 `lab` HTTP 配置。FRP 本机目标填 `localIP=127.0.0.1`、`localPort=50010`。公网地址确定后，按实际外部根地址同步配置 API/Live 来源并重建前端；正式 HTTPS 配置与转发说明见 [部署指南](shared-web-mobile-deployment.md)。仅修改 FRP 转发不会自动修改应用生成的链接。

## 构建与上线

构建来自独立工作树。冻结依赖安装、12 个共享包、Web/Admin/Space 构建及类型检查、Live 类型检查和两个构建入口完成；API 全部 Python 源静态解析、113 个锁定 Python 依赖版本与 `pip check` 通过。唯一 API 镜像为 `ooa-plane-api:unified-web-mobile-20261010T083000Z`，镜像 ID 为 `sha256:7372ca88a8b372886c5d18eb28186a8bcad3e50147d6d96bf27e4b3da66a670f`。

完整 Web/Admin、Space/Live 和冻结 Node 依赖位于独立不可变发布目录 `/mnt/repo/ly/.shared-releases/shared50010-20261010T083600Z`。API 使用镜像内源码，未挂载旧 `/code`。原 checkout 的 `.temp/lab-runtime/compose.proxy.yml` 持续引用该完整发布版本，`tools/lab/lab.sh start` 会沿用已发布产物。该发布目录是运行挂载，不能在其中安装依赖、构建或清理。旧已发布目录保留。

切换期间停写 API、worker、beat 与 Live，在 Git 和公共交付目录之外保存一致性 PostgreSQL 自定义格式备份、附件副本、原环境配置和发布信息，目录权限 0700、数据库备份权限 0600。备份目录为 `/mnt/repo/ly/.deploy-backups/shared50010-20261010T083600Z`，没有进入 Git 或 APK。

保留已部署的 `0013_document_file_versions`，实际应用了 `0013_trusted_browsers`、`0014_api_token_expiry` 和 `0015_merge_document_files_security`。安全迁移给仍活跃的无期限 API token 设置三十天期限，并清理未知身份配额；反向迁移不会恢复这些数据。回滚可切回旧镜像、配置和资产，保留新增表列；不能直接还原数据库备份覆盖上线后的业务写入。

代理使用现有 Docker 网络的独立固定地址 `172.19.0.250`，API/Live 只信任其 `/32` 转发来源。初次切换发生旧地址被 worker 占用的冲突，改用已核对的空闲地址后启动完成，未扩大代理信任范围。

上线后只进行了构建、静态和启动检查：`/`、`/god-mode/`、`/spaces/`、`/api/instances/`、`/live/health` 均返回 200，实例返回 `mobile_api_version: 1`，Docker 确认 `0.0.0.0:50010 -> 80`，其余数据服务持续运行。未执行新的业务、设备安装、Android UI 或 FRP 公网验收，业务测试由用户完成。

## Android 1.0.1

APK：`/mnt/repo/ly/android-delivery/OpenOceanAcoustic-1.0.1/OpenOceanAcoustic-1.0.1.apk`，4,288,535 字节；包名 `org.openoceanacoustic.mobile`，versionCode 2，min SDK 24、target SDK 36。

SHA-256：`93fbf4c67edfb785ecb1068f8810eb5249d37bec7e058d2996e19ecd1f8b961e`。

与 1.0.0 使用同一保留的 RSA 发布密钥，签名证书 SHA-256 为 `6fab1f84864c680f21c34e5551005faba32ba8074a7ca9ed236e22faf9f3bed5`，APK v2 签名与 manifest 校验通过，可覆盖更新。私钥未进入仓库。

God Mode 新增动态码续验：管理员写请求被 `ADMIN_REAUTH_REQUIRED` 拒绝后打开底部面板，验证成功只重试一次原始请求，保留幂等键；并发请求共享一次续验，取消和服务器切换停止重试。错误动态码允许重输，真正失效会话退出管理员登录，普通登录独立保留。

本次使用明确的 `--skip-tests` 构建参数，未执行新版本业务、安装或模拟器测试。旧版 1.0.0 的证据不会当作新版验收结果。安装、签名保留与重复构建见 [安卓交付说明](android-delivery.md)，输出目录同时提供安装说明、构建说明、SHA-256 文件和公开构建证据。
