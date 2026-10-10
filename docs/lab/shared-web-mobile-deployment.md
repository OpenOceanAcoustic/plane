# Web 与 Android 共享部署入口

主站、God Mode、Space、API、Live 和附件通过同一个 Caddy 入口连接同一套数据库和对象存储。Android APK 内置界面，只把服务器根地址作为业务接口地址；无需单独部署移动端 Web 页面。

## 当前内网 HTTP 配置

目标监听为 `0.0.0.0:50010`，电脑和手机使用 `http://192.168.137.90:50010`。`0.0.0.0` 表示服务器监听所有 IPv4 网卡，不能填写为客户端地址。设备须能到达该内网 IP。

在最终部署工作树生成配置：

```sh
python3 tools/lab/setup.py --profile lab \
  --public-url http://192.168.137.90:50010 \
  --bind-address 0.0.0.0 --listen-port 50010
```

| 参数 | 作用 |
| --- | --- |
| `LAB_BIND_ADDRESS` | 宿主机监听 IP，兼容默认 `127.0.0.1` |
| `LAB_HTTP_PORT` | 宿主机 HTTP 端口，兼容默认 `8080`；当前设为 `50010` |
| `LAB_PUBLIC_URL` | 设备实际访问的 HTTP/HTTPS 根地址 |
| `WEB_URL` / `APP_BASE_URL` | API 生成链接和主站根地址 |
| `ADMIN_BASE_URL` / `ADMIN_BASE_PATH` | 同一根地址，后台路径 `/god-mode` |
| `SPACE_BASE_URL` / `SPACE_BASE_PATH` | 同一根地址，共享页路径 `/spaces` |
| `LIVE_BASE_URL` / `LIVE_BASE_PATH` | 同一根地址，协作路径 `/live` |
| `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` | 精确的协议、主机、端口；lab 同时保留现有开发来源 |

监听端口与客户端 URL 分别配置，setup 不根据客户端端口猜测监听端口。未来 FRP 远端端口可以与本地端口不同。显式参数覆盖原值；未提供 `--listen-port` 时保留已有端口或默认 8080。未提供 `--bind-address` 时沿用原有规则：显式本机访问地址选择回环监听，其他访问地址选择 `0.0.0.0`；访问地址也未修改时保留原监听地址。

Compose 将宿主端口映射到 Caddy 容器端口 80，Caddy 继续分发 `/api/*`、`/auth/*`、`/live/*`、`/spaces/*`、`/god-mode/*`、`/uploads/*` 与主站路径。这次端口配置不要求给 API、Live 或 Minio 新增宿主端口。

附件签名使用当前请求的协议和 Host，通用存储地址也读取 `WEB_URL`。入口应保留设备访问的 Host 与端口；不能把已经签名的附件 URL 改写到另一个 Host。`AWS_S3_ENDPOINT_URL=http://plane-minio:9000` 是容器内部地址，不能填写到 APK。

Android 在首次连接或切换服务器时填写上述客户端根地址。普通原生 HTTP 使用 Android 会话，数据查询、附件和文档同步与 Web 共用后端，手机数据导出限制继续由后端执行。文档 WebSocket 从本地 WebView 创建，通过 Android 一次性协作票据授权；普通浏览器严格来源校验与握手、消息限额仍须保留。

## 发布目录与已有服务

运行实例可能通过 `.temp/lab-runtime/compose.proxy.yml` 挂载已发布的 Web/Admin/API 目录。构建必须在独立工作树或输出目录完成，发布时再切换完整资产与镜像。保留已有数据库、附件、认证密钥和实际挂载；不要把正在运行的目录用作临时构建输出。

执行 setup 会写入忽略的环境配置，部署动作会重建或重启服务。具体执行和实际上线状态由发布记录说明；本文给出的命令不代表已经执行。APK 验收由用户自行完成。

## 未来 FRP TCP 示例

未来在本机运行 frpc 时，可把同一个入口从远端端口透传到 `127.0.0.1:50010`。以下模板没有真实服务器地址或密码，环境变量由部署者私下提供：

```toml
serverAddr = "{{ .Envs.FRP_SERVER_ADDR }}"
serverPort = 7000
auth.method = "token"
auth.token = "{{ .Envs.FRP_AUTH_TOKEN }}"
transport.tls.enable = true

[[proxies]]
name = "openoceanacoustic-shared-http"
type = "tcp"
localIP = "127.0.0.1"
localPort = 50010
remotePort = 50010
```

FRP TCP 转发同时承载 HTTP、WebSocket 和附件，不自动修改 Host 或应用生成的根地址。启用后，按真实远端地址重新配置 `--public-url`，同步更新 API/Live 的来源配置并重建、发布 Web/Admin/Space/Live；APK 切换服务器即可。[FRP TCP 文档](https://gofrp.org/en/docs/features/tcp-udp/)

模板中的通道 TLS 保护 frpc 与 frps 之间的通信，浏览器访问远端 HTTP 仍是 HTTP。正式公网 HTTPS 应在域名、证书和实际拓扑确定后使用 public profile 配置，而非把内网 HTTP 配置标记为正式公网配置。[FRP 通道 TLS](https://gofrp.org/en/docs/features/common/network/network/)

## 正式公网 HTTPS

公网安全 profile 接受无端口的正式 `https://域名`，独立生成 `.env.public` 等文件，设置精确 Host/Origin、Secure Cookie、HTTPS 跳转和固定代理信任范围。参见 [公网部署指南](../../tools/lab/public-security-guide.md)。目前没有真实公网域名，因此当前采用 HTTP 内网 profile。

未来若仍以本地 50010 为 FRP 入口，可另行将该宿主端口映射到 public Caddy 的容器 **443**，让 frpc TCP `localPort=50010`、`remotePort=443` 保留客户端到 Caddy 的 TLS。证书签发流量、域名解析和 Compose 端口映射须根据最终拓扑配置。public Live 在内部网络使用正式域名别名访问 Caddy 容器 443，不能直接改成绕过入口的 `api:8000`。

普通 TCP 隧道会使 Caddy 看到隧道连接来源，多个用户可能共享同一限流来源。正式 FRP 公网接入还需明确真实客户端 IP 的可信传递；不能将 `TRUSTED_PROXY_CIDRS` 扩为 `0.0.0.0/0`。如果在公网边缘终止 HTTPS、内网转 HTTP，也须明确可信代理与协议、Host 头处理，保持正式配置的信任边界。

Caddy 的 `reverse_proxy` 支持 WebSocket Upgrade，无需再映射独立协作端口。客户端根为 HTTP 时协作为 ws，HTTPS 时为 wss。[Caddy reverse_proxy 文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
