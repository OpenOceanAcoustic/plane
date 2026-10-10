# 公网 HTTPS 部署与迁移

公网使用独立的 `compose.public.yml`，包含主站、`/god-mode/` 后台、Space、Live 和附件。保留 TOTP 登录；不需要 WAF 或 VPN。公网业务端口仅为 TCP 80、443，80 自动跳转到 HTTPS。数据库、Redis、RabbitMQ、Minio、API、Live 均没有宿主机端口。

## 先准备域名和配置

将正式域名的 A / AAAA 记录指向服务器，并允许 Caddy 从公网接受 TCP 80、443。仅在确实支持 IPv6 时发布 AAAA。服务器 SSH 按自己的运维访问策略配置，不是业务入口。不要通过另一层代理转发此配置：限流只信任 Caddy 本身记录的连接来源 IP，第三方代理会让多个用户共用同一来源。

```bash
tools/lab/lab.sh --profile public setup --public-url https://dashboard.example.org
```

地址必须是无端口、路径的 HTTPS 正式域名。命令只生成 `.env.public`、`apps/api/.env.public`、`apps/live/.env.public`，不覆盖已有开发 `.env`。从当前配置保留数据库、对象存储、Django、Live 和 TOTP 密钥。`.secrets/lab-totp.key` 保持原值，另生成同值 `.secrets/public-totp.key`，以 `0600` 和 `PUBLIC_API_UID` 保证非 root API 能读取。文件和副本不能入库；复制备份时也要保留权限与所有者。

首次迁移必须先把旧 `.env`、`apps/api/.env`、`apps/live/.env`、`.secrets/lab-totp.key` 安全复制到新服务器，再运行公网 setup。已经存在的公网密钥副本若与本地密钥不同，setup 会拒绝继续，避免将有效 TOTP 凭据指向错误密钥。不要通过重新生成密钥解决这个错误。

正式设置契约为：

| 参数                                                          | 含义 / 默认值                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PUBLIC_DEPLOYMENT=1`                                         | 启用生产配置检查与服务端安全限制                                                                      |
| `PUBLIC_ORIGIN` / `PUBLIC_HOST`                               | 唯一 HTTPS 来源 / 不带协议的域名                                                                      |
| `ALLOWED_HOSTS`                                               | 只允许正式域名                                                                                        |
| `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS`               | 仅 `PUBLIC_ORIGIN`，没有 localhost 来源                                                               |
| `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE`                | `1`，登录与 CSRF cookie 仅 HTTPS                                                                      |
| `SECURE_SSL_REDIRECT`                                         | `1`                                                                                                   |
| `SECURE_HSTS_SECONDS`                                         | `300`；稳定后可延长，不默认包含子域或 preload                                                         |
| `PUBLIC_BACKEND_SUBNET` / `PUBLIC_PROXY_IP`                   | `172.29.240.0/24` / `172.29.240.2`，选择不与已有 Docker / VPN 网段重叠的网段                          |
| `TRUSTED_PROXY_CIDRS`                                         | 仅代理 IP `/32`；修改代理 IP 后重跑 setup，禁止配置 `0.0.0.0/0`                                       |
| `LIVE_HANDSHAKE_SOURCE_LIMIT` / `LIVE_HANDSHAKE_GLOBAL_LIMIT` | Live 升级握手来源 / 全局默认 `60` / `240` 次每分钟；在 `apps/live/.env.public` 调整，所有握手共用预算 |
| `PUBLIC_DATA_PROJECT`                                         | `ooa-plane-lab`，表示要使用的外部数据卷前缀                                                           |
| `PUBLIC_IMAGE_TAG`                                            | 镜像版本标签，默认 `security`，正式发布建议改为 commit / release 标签                                 |
| `PUBLIC_API_UID`                                              | 执行 setup 的宿主 UID；root 执行时默认 `10001`                                                        |
| `PUBLIC_APP_CPUS` / `PUBLIC_APP_MEMORY` / `PUBLIC_PIDS_LIMIT` | 每服务默认 `1.0` CPU / `768m` / `256` PID，可按容量调整                                               |

`PUBLIC_ORIGIN` 变化后必须重建前端镜像。Live 的 `API_BASE_URL` 也为该 HTTPS 地址，Docker 网络将正式域名解析到 Caddy，使用正常 TLS 校验；不要改成直接访问 `api:8000`，以免绕过 Host 和 TLS 入口设置。Caddy 不等待 Live 健康检查，Live 等待代理服务启动，避免互相等待。

Live 在升级握手前先检查精确 Origin，再以 Redis 原子检查来源和全局预算；Redis 失败或 500 毫秒内无响应时返回 503。来源只接受固定代理地址 `/32` 或 `/128` 传来的单个规范 IP；其他连接忽略转发头。建立文档前，传输层也限制每 socket 每秒 20 条消息、未完成授权/加载的累计帧最多 8 MiB 和最多八个文档，所有 socket 的待处理帧合计最多 64 MiB；已授权用户还受八个并发文档、每秒 20 条消息的共同预算。这些限制覆盖脚本伪造合法 Origin 后仍未认证的连接。

后端 Docker 网络为 internal，因此邮件、外部 OAuth、Webhooks 等出网集成不在该部署默认能力内。当前 TOTP 业务无需这些服务；以后启用集成时要另行设计受控出网，不能把内部服务发布到公网。

## 备份、镜像和数据卷

先用新工具为旧栈做一致性备份。该命令会短暂停止写入服务与对象存储，然后恢复原先运行的服务；`--keep-stopped` 用于维护窗口。不要在审核阶段对正在使用的栈执行备份或停机。

```bash
tools/lab/lab.sh backup /private/backups/pre-public /private/backup-keys
tools/lab/lab.sh restore-verify /private/backups/pre-public /private/backup-keys/pre-public.totp.key
```

备份目录含数据库、附件和环境凭据，密钥另存。目录为 `0700`、文件 `0600`；还需用自己已验证的加密备份方案离线保存。`manifest.json` 记录实际部署的各服务镜像 SHA256、profile 和数据卷身份，包含恢复需要的 API、Postgres 原版本。镜像 ID 不能从另一个服务器直接拉取：迁移前用 `docker image save` 归档这些原镜像并在新机器 `docker image load`。不要以同名的新标签替代旧镜像。旧格式备份缺少镜像 manifest 时，恢复工具拒绝猜测版本，应重新备份。

`restore-verify` 使用随机项目名、独立 internal 网络和临时卷，不映射端口，也不会覆盖运行数据。先用原版本镜像验证数据库记录数、附件和 TOTP 解密。验证升级时显式传入新 API 镜像：

```bash
tools/lab/lab.sh restore-verify /private/backups/pre-public /private/backup-keys/pre-public.totp.key --upgrade-image ooa-plane-api:RELEASE
```

只有原版本验证成功后才在隔离数据库执行新版本迁移。生产切换前还应验证实际登录、权限和新配置行为。不要将恢复演练的临时环境文件当作生产配置，它会关闭外部端点与 TLS 跳转。

开发机上的自动恢复演练可显式运行 `RUN_DOCKER_RESTORE_TEST=1 python3 -m unittest test_restore_docker`（在 `tools/lab` 目录）。它创建全新的隔离数据库、对象存储与加密凭据，验证实际附件恢复并清理临时资源；需要已有 `ooa-plane-api:lab`、`postgres:15.7-alpine`、`ooa-plane-minio:source` 和 `alpine:3.20` 镜像，不使用当前 lab 数据卷。可通过 `RESTORE_TEST_API_IMAGE` 指定基线 API 镜像，或添加 `RESTORE_TEST_UPGRADE_IMAGE=ooa-plane-api:RELEASE` 演练原镜像恢复后的升级。

公网 Compose 的四个业务数据卷明确为外部卷：`${PUBLIC_DATA_PROJECT}_pgdata`、`_uploads`、`_redisdata`、`_rabbitmq_data`。它不会自动创建空卷顶替旧数据。迁移须在新机器恢复这些卷，保留数据库所有者 `70:70`、Valkey 所有者 `999:1000`、RabbitMQ 所有者 `100:101`；这些 UID / GID 已按当前固定镜像确认。Minio 上传卷要允许 `10001:10001` 读写。旧上传卷如属于 root，停写后对**迁移副本**调整所有者，禁止在旧栈仍运行时同时让两个栈写同一数据卷。

新实例没有历史数据时，先明确选择新的 `PUBLIC_DATA_PROJECT`，再创建这四个外部卷并设置对应所有者。不要使用旧项目默认卷名，以免误接入已有业务数据。

## 构建和启动

```bash
tools/lab/lab.sh --profile public build
tools/lab/lab.sh --profile public init
tools/lab/lab.sh --profile public start
tools/lab/lab.sh --profile public status
```

构建采用 `pnpm-lock.yaml` 和完整版本锁 `apps/api/requirements/public-lock.txt`，开发 requirements 保持原样；基础镜像使用固定版本。API / Node / Caddy 均以非 root 运行，应用没有宿主源码挂载，根文件系统只读，日志和临时目录使用有限 tmpfs。Caddy `/data` 和 `/config` 使用独立持久卷保存证书；不要在升级时删除。证书签发成功前 Live 的内部 HTTPS 请求可能暂时失败，待 DNS 与 ACME 完成后重试。正式镜像构建和迁移完成前保留原版本镜像和备份。

`init` 对所选数据卷运行 Django 迁移、实例初始化和 bucket 检查。已有实例应根据迁移演练结果安排维护窗口；该命令会修改所选数据库，不属于只读检查。

## 上线验收

部署前接口测试与 Caddy 校验不接触正式数据：

```bash
cd tools/lab
python3 -m unittest test_setup test_public_deployment test_backup
RUN_DOCKER_CADDY_TEST=1 python3 -m unittest test_public_deployment
RUN_DOCKER_PUBLIC_IMAGE_TEST=1 PUBLIC_TEST_API_IMAGE=ooa-plane-api:RELEASE python3 -m unittest test_public_image
RUN_DOCKER_PUBLIC_PROXY_IMAGE_TEST=1 PUBLIC_TEST_PROXY_IMAGE=ooa-plane-proxy:RELEASE python3 -m unittest test_public_proxy_image
```

正式域名上线后验证：

- HTTP 跳转 HTTPS，证书有效，主站 / 后台 / Live 使用同一正式域名。
- Django `check --deploy` 没有 Secure cookie、HTTPS 跳转和缺少 HSTS 时长的警告。初期不启用 includeSubDomains / preload，保留 W005 / W021 两条预期提醒。观察登录响应中 cookie 的 `Secure`、`HttpOnly`、`SameSite` 标志。
- 不在白名单中的 Host / Origin 被拒绝；伪造 `X-Forwarded-For` 不能改变限流身份。入口会覆盖转发头，API 只信任该代理 IP。
- TOTP 正常登录、同一验证码重放被拒绝、过期或撤销的 session 无法继续调用 API / Live。
- 未登录无法调用转换等业务功能；大量失败登录、接口请求、WebSocket 建连或消息得到服务端限制。验证限制时使用隔离测试栈，避免对生产做压力测试。
- 5 MiB 附件可上传，入口允许 multipart 总大小 6 MiB；超额请求返回 413。匿名直接读取 private bucket 失败，下载使用短时签名。不要因为设置中有 `public-read` 字样就推断桶公开，应验证实际桶政策和对象行为。
- 从另一台机器确认业务只有 80 / 443 可达；没有 API、DB、Redis、MQ、Minio console 的公网端口。
- 日志不记录 cookie、Authorization、API key、CSRF token 或对象签名 URL。入口 access log 删除整个请求与响应 headers 和 URI，覆盖任意头大小写与 `Set-Cookie` 凭据；保留来源、状态与耗时。应用安全日志提供可用于限流事件监控的路径 / 事件类型。
- 在新实例上重新做公网 profile 备份与隔离恢复演练，并检查证书卷持久化、磁盘容量和告警。

公网备份使用 `tools/lab/lab.sh --profile public backup ...`；恢复演练读取备份 manifest，不依赖正在运行的公网栈。上线切换失败时用已验证的原镜像和备份回退，不直接对已经升级的数据库进行版本降级。

实现依据：[Django 部署检查](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)、[OWASP 防自动化登录攻击建议](https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html)。多层限流须保留可用的正常登录通道；本地资源限额无法承担超出服务器带宽的攻击流量。
