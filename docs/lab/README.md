# OpenOceanAcoustic 本机与内网部署管理

基线为免费 AGPL-3.0 Community Edition v1.4.2。Fork 保留上游 LICENSE 和原生项目/看板/甘特功能；新增代码在同一许可下发布。规格见 [spec.md](spec.md)，实际完成情况和验证结果见 [progress.md](progress.md)。

原生项目页面的甘特视图在中文界面名为“时间线”（英文 Timeline），与看板等布局按钮并列。

附件服务从官方 MinIO 和 mc 固定源码提交构建，构建说明见 `tools/lab/Dockerfile.minio`；不依赖已无法拉取的上游公开镜像。原始源码和许可随固定提交保留。

## 首次准备

本机需要 Docker Engine、Compose v2，以及当前用户运行 Docker 的权限。管理员认证需由机器使用者在终端输入，不要将 sudo 密码交给开发代理。

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$(id -un)"
# 重新登录终端，或在新 shell 中执行 newgrp docker
docker info
```

Node >=22.18.0；pnpm 版本以 package.json 为准（11.3.0）。若发行版旧 Corepack 对 pnpm 的动态导入报错，应直接使用该版本 pnpm 的可执行入口，不要修改仓库锁文件或升级包管理器。构建使用 `RAYON_NUM_THREADS=1` 限制并发，Space 使用 esbuild 压缩。此上游打包器仍可能间歇性出现 native panic；本次相同配置下重试构建成功，未修改依赖版本。

```bash
pnpm install --frozen-lockfile --network-concurrency 4 --child-concurrency 1
tools/lab/lab.sh setup
tools/lab/lab.sh build       # 串行构建全部前端，再构建上游 Python 3.12 容器
tools/lab/lab.sh init        # 数据库迁移、实例配置、附件桶、静态资源
tools/lab/lab.sh start
tools/lab/lab.sh status
```

默认入口为 `http://localhost:8080`，管理后台路径 `/god-mode/`，Space 路径 `/spaces/`。Space 保留上游服务端渲染，运行独立 Node 服务；前端服务不会挂载后台认证密钥。默认 8080 只监听 127.0.0.1；配置内网地址后改为监听 0.0.0.0。API 8010、MinIO 9100 和控制台 9190 始终只监听回环；数据库、Valkey、RabbitMQ 不向宿主机暴露端口。数据位于独立 Compose 项目的持久卷。停止用 `tools/lab/lab.sh stop`，再次运行用 `start`，停止不会删除数据。`start` 同时刷新代理挂载和 Space 服务端构建，保证重建后加载最新页面。

### 配置内网入口

当前机器使用有线地址 `http://192.168.137.90:8080`。`0.0.0.0` 是监听地址，注册链接使用团队设备可访问的服务器 IP 或域名。切换地址时同步后端、Live、前端和 CORS，并保留已有数据及认证密钥：

```bash
tools/lab/lab.sh setup --public-url http://192.168.137.90:8080
RAYON_NUM_THREADS=1 pnpm --filter web build
RAYON_NUM_THREADS=1 pnpm --filter admin build
RAYON_NUM_THREADS=1 pnpm --filter space build
tools/lab/lab.sh start
```

随后 `sh backend.sh` 输出内网注册链接。已发出的有效链接可将 `localhost` 替换为 `192.168.137.90`，保留端口、路径和 `#` 后的 token。再次运行不带参数的 `setup` 会保留已配置的访问地址；显式使用 `--public-url http://localhost:8080` 才恢复回环入口。

本机首次构建已使用 DaoCloud 缓存拉取上游镜像，Alpine/PyPI 下载使用阿里云，Go 模块使用 goproxy.cn。容器下载较慢的依赖经宿主机缓存供构建使用，系统包保留签名校验，宿主机通过 HTTPS 验证远端下载。运行镜像已保存在 Docker 中，日常 `start`/`stop` 无需重新下载或依赖临时构建缓存。备份同样复用已有 Alpine 镜像，仅在本地缺失时拉取。

前端开发可使用同一后台容器：把 web/admin 的 `VITE_API_BASE_URL` 改为 `http://localhost:8010`，对应 base URL 改为 localhost:3000/3001，执行 `pnpm --filter web dev` 和 `pnpm --filter admin dev`。完成后重新 `setup` 与串行构建，再运行 `start`，恢复已配置的 8080 入口。不要同时启动第二套数据库来占用有限内存；同一次访问使用一致的主机名，确保 cookie 来源一致。

## SSH 身份管理

网页不能自建管理员或发放邀请。第一次部署后在服务器终端执行：

```bash
sh backend.sh
sh backend.sh invite --workspace openoceanacoustic --role 15
sh backend.sh list
sh backend.sh revoke --id INVITATION_UUID
sh backend.sh reset --username MEMBER_USERNAME
sh backend.sh purge
```

`backend.sh` 在终端直接输出带 token 的一次性 URL，复制到浏览器即可注册并绑定 Authenticator。直接运行默认初始化首次管理员；`invite` 发成员邀请，`reset` 发原账号的重新绑定链接。脚本可从任何目录通过绝对路径运行，`sh backend.sh --help` 查看用法。

管理员初始化已有有效邀请时须先用 `revoke` 撤销，再生成新链接；管理员已完成绑定后使用 `invite` 添加成员。注册链接不写入文件。

输出的 URL 默认 24 小时有效。token 位于 URL 的 fragment（`#` 后），避免进入反向代理日志、Referer 和链接预览；浏览器只将它发送到认证 POST 接口。GET 不消耗邀请。`list` 输出 ID 和状态，不能重新取回原 token。请直接、安全地交给已确认身份的成员。

注册填写 3–64 位英文用户名（忽略大小写）、显示姓名、联系邮箱；邮箱用于联系，无需 SMTP 验证。恢复链接无需重新填写资料。扫码绑定 Authenticator 后输入六位码确认，再等待下一动态码登录。每个动态码时间步只能使用一次，管理后台和主应用也共用这一限制。动态码采用 30 秒标准 TOTP、前后一步时钟容差，依据 [PyOTP 文档](https://pyauth.github.io/pyotp/)。每账号十分钟五次登录提交，成功也计数；重复点击、切换 IP 或重启服务均不增加额度。

`reset` 立即禁用旧凭据、删除旧会话、停用该用户的 API 令牌，并通过 Redis 断开既有 Live 文档连接。重新绑定使用原用户 ID，任务、工作区角色、贡献历史保留。不要通过 `createsuperuser`、数据库明文密码、邮件或 OAuth 绕过流程；这些账号没有实验室凭据和会话标记，不能访问业务。

## 规划与团队协作

侧栏个人规划默认 A/B/C/D，事项可拖动到文件夹或状态列，也可用菜单改名、排序、删除；删除文件夹后事项未分类。引用任务保留原任务身份，状态改动同步到项目看板和甘特。个人事项默认私人，负责人只能见忙碌时间；本人可勾选公开。

项目负责人须在个人规划的“项目状态映射”选择四个不同状态。待做属于 backlog/unstarted，进行中和待验收属于 started，完成属于 completed。若上游项目没有待验收状态，请先在原生项目设置中新增。映射建立后可从任何入口维护原生状态，悬赏验收使用同一映射。

周历使用上海时间、周一开周、十五分钟步长；点击“安排时间”或事项上的日历按钮新增时间块，拖动移动，拖动底边调整结束时间，点击调整开始/结束、拆分或删除。同一事项可有多个块；时间重叠会并排显示并提示，但允许保存。排期不会改动原任务起止日期。团队排期只允许管理员/项目负责人查看，成员只能维护本人时间块；私人及无项目访问权限的内容由 API 隐藏。

负责人冻结阶段 B，再基于同项目顶层任务发布一张团队悬赏卡，明确 T、交付物、验收条件、验收人。成员申请个人分工，负责人批准，本人确认后团队开工。达到重大门槛须独立复核发布和验收；复核人与发布人、验收人不同，验收/复核人员不能认领本任务。默认每人最多两项进行中、一项重大；原生状态更新、指派、批量及 API 入口通过数据库约束检查。负责人批准例外须原因、截止时间及批准人，不能自批。

原生新建工作区立即启用 WIP 策略，初始化或运行 migrate 时会回填旧工作区的缺漏。旧数据已超额时允许逐项收尾，禁止新增或替换事项。原生任务和指派在同一事务写入；超额请求拒绝后不会残留新任务或丢失原有指派。

提交成果后独立验收。部分通过填累计 VC，再次验收只授予差额；有效探索负结果达到原约定条件可全部通过。重大验收复核完成前不记账。验收逾期进入站内待办，不自动通过。账本保存任务和人员快照；负责人更正使用冲正记录。现金承诺继续参与重大任务判断；“资金与奖励”另提供项目自定义参考预测、真实分池、负责人累计最终核准、付款安排及线下支付登记。不要将累计金额当成增量填写。

个人排期与项目账本提供 CSV/JSON 导出。项目删除后管理员可通过历史账本或数据库备份核查；账本不因用户/任务删除而删除。保留上游数据删除策略时应额外遵守实验室项目关闭后至少五年的账本保留要求，不清空 lab 记录。

项目／工作项文件上传、TXT／MD 在线阅读及 Word／Excel 下载见 [文档使用说明](enhancement-guide.md#实验记录任务关联附件与版本)。

## 测试和备份

```bash
python3 tools/lab/test_setup.py
tools/lab/lab.sh check
docker compose -f docker-compose-test.yml -f compose.lab-test.yml run --rm --build api-tests pytest --migrations plane/tests/contract/api/lab
# 发布前完整回归，务必启用真实迁移，以验证 PostgreSQL 触发器
docker compose -f docker-compose-test.yml -f compose.lab-test.yml run --rm api-tests pytest --migrations
```

上述测试栈与实际部署使用独立网络和临时数据。只对测试栈 `down -v`；禁止对运行栈执行带 `-v` 的清理命令。组件浏览器契约通过以下命令运行，使用真实组件和模拟接口；不能替代完整部署验收。

```bash
node tools/lab/test-calendar.mjs
node tools/lab/test-planning-store.mjs
pnpm --filter live test tests/extensions/lab-session-guard.test.ts
pnpm exec playwright install chromium
pnpm exec playwright test --config tools/lab/browser/playwright.config.ts
```

真实浏览器脚本位于 `tools/lab/e2e`，只允许使用独立 `ooa-plane-e2e` Compose 项目。它从临时工作目录运行 `sh backend.sh` 初始化一次性测试管理员，验证真实动态码登录、原生看板和甘特以及个人排期；测试栈必须从空卷开始，且上述端口未被运行栈占用。本机与正式实例并行验收时须使用独立端口及配置，并设置 `LAB_E2E_BASE_URL` 与测试后台的访问地址一致。脚本关闭录屏、截图、tracing 与失败页面快照，注册页导航失败也不输出带 token 的地址。CI 的 `[full-regression]` 提交执行完整后端回归、真实部署浏览器流程和隔离恢复验证。

`check` 还通过真实代理验证项目封面的签名上传和下载，写入的独立临时对象在成功或失败后都会删除；签名和凭据不输出。创建项目即使没有手动选择封面，也会上传默认封面，因此代理须同时处理 `/uploads` 和 `/uploads/*`。单独检查上传链路：

```bash
docker compose -p ooa-plane-lab -f compose.lab.yml exec -T api python - < tools/lab/test_upload.py
```

真实浏览器回归从原生项目创建按钮上传默认封面，验证项目创建及封面关联成功，再检查原生任务和实验室规划。CI 的完整部署流程也运行真实上传检查。

```bash
LAB_COMPOSE_PROJECT=ooa-plane-e2e tools/lab/lab.sh init
LAB_COMPOSE_PROJECT=ooa-plane-e2e tools/lab/lab.sh start
LAB_E2E_PROJECT=ooa-plane-e2e pnpm exec playwright test --config tools/lab/e2e/playwright.config.ts
# 仅在明确使用测试项目时清理测试卷
docker compose -p ooa-plane-e2e -f compose.lab.yml down -v
```

认证密钥保存在 `.secrets/lab-totp.key`，通过 Compose secret 挂载，独立于 Django SECRET_KEY。所有配置和密钥文件权限 0600，不进入 Git。数据库备份无法替代认证密钥备份。完整备份暂时暂停写入服务和 MinIO，结束后恢复原先运行的服务。

```bash
python3 tools/lab/backup.py backup /ABSOLUTE/BACKUP_DIRECTORY /SEPARATE/KEY_BACKUP_DIRECTORY
python3 tools/lab/backup.py restore-verify /ABSOLUTE/BACKUP_DIRECTORY /SEPARATE/KEY_BACKUP_DIRECTORY/BACKUP_NAME.totp.key
```

每次备份使用新目录。恢复验证生成独立临时 Compose 项目，检查数据库记录数、附件逐文件校验和凭据解密，之后只删除本次临时卷，绝不覆盖运行数据。建议每月备份、每季度恢复演练，将认证密钥另存到受控离线位置。真正灾难恢复时，在停机和确认目标卷后恢复 dump、附件、配置及匹配密钥，并删除恢复的旧会话；不要直接覆盖运行中的实例。当前 HTTP 内网地址用于部署验证；团队正式使用时配置 HTTPS，并将访问来源、cookie、各 base URL 同步改为正式域名。

贡献更正只追加冲正记录，不自动占用成员 WIP。需要复验时，负责人在任务卡点击“更正后重新验收”，填写原因；该动作检查 WIP，验收继续按累计差额入账，重大任务仍须第二人复核。

个人规划的并排工作台、增强卡片、筛选和团队共享说明见 [个人规划使用说明](personal-planning-guide.md)。

项目自定义奖励公式、资金分池、最终核准及悬赏公开认领说明见 [资金与悬赏使用说明](finance-guide.md)；接口契约见 [Finance API](finance-api.md)，实施与验证记录见 [交付记录](finance-progress.md)。
