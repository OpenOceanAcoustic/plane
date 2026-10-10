# Android 原生项目与任务覆盖

对照 V4 `docs/design/android-ui-prototype/manifest.json`；本表只记录 `features/core` 的真实行为及后端合同。首页、草稿、个人活动、便签、通知、工作区视图、活跃周期、工作区分析、搜索和快捷操作由根应用及 workspace 功能负责，见 `android-workspace-coverage.md`。APK、浏览器和模拟器验证由交付报告单独列明，本表不把 API 测试算作设备验证。

## 设计映射

下表的 `W` 为 `/api/workspaces/{slug}`，`P` 为 `W/projects/{project_id}`，`I` 为 `P/issues/{issue_id}`。所有查询、写入和附件均通过真实 ApiClient；加载、空白、请求错误显示实际状态，表单失败保留输入。深色配色使用主应用的 surface、ink、border 和 muted 变量。

| V4 设计 ID                                   | 移动入口与真实功能                                                                                            | 接口                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| native-projects                              | 项目查询、收藏、已归档列表、详情操作                                                                          | `GET W/projects/`，`POST/DELETE W/user-favorite-projects/`                                                       |
| native-project-create                        | 名称、标识、描述、可见性、负责人、成员；成员追加失败重试复用已创建项目                                        | `POST W/projects/`，`POST P/members/`                                                                            |
| native-project-overview                      | 项目详情、成员、统计、任务/需求/周期/模块/视图/归档/设置入口                                                  | `GET P/`，`GET P/members/`，`GET W/project-stats/`                                                               |
| native-project-list                          | 服务端搜索、分页、任务卡、创建与详情                                                                          | `GET P/issues/?name=&cursor=&per_page=100`                                                                       |
| native-project-kanban                        | 相同真实任务按状态、优先级或负责人分组；次级分组与空组                                                        | `GET P/issues/`，`PATCH P/user-properties/`                                                                      |
| native-project-gantt                         | 真实任务时间线、修改预览后提交                                                                                | `GET W/lab/projects/{project_id}/gantt/` 及该功能 preview/commit 接口                                            |
| native-project-calendar                      | 完整七列屏宽月历、月份切换、日期任务详情                                                                      | `GET P/issues/`，日期取真实 start_date/target_date                                                               |
| native-project-table                         | 每条记录纵向显示编号、状态、优先级、负责人、标签、周期、模块、估算、日期、附件/链接/子任务数量、创建/更新时间 | `GET P/issues/` 及状态、成员、标签、周期、模块、估算查询                                                         |
| native-filters                               | 状态、状态组、优先级、创建人、负责人、标签、周期、模块、开始/截止日期范围；清除筛选                           | `GET P/issues/` 对应筛选参数                                                                                     |
| native-sort-group                            | 创建时间、截止日期、优先级、名称排序；状态/优先级/负责人及次级分组                                            | `GET P/issues/?order_by=...`，`PATCH P/user-properties/`                                                         |
| native-display-properties                    | 显示属性勾选、布局、空组、子任务；显式保存，保留桌面未知属性和过滤条件                                        | `GET/PATCH P/user-properties/`                                                                                   |
| native-cycles / native-cycle-create          | 周期查询、创建/编辑、开始结束日期、收藏                                                                       | `GET/POST/PATCH P/cycles/`，`POST/DELETE P/user-favorite-cycles/`                                                |
| native-cycle-detail                          | 周期详情、任务加入移除、完成进度、剩余任务趋势、负责人/标签分布、按日期查看                                   | `GET P/cycles/{id}/`，`GET .../analytics/`，`GET/POST/DELETE .../cycle-issues/`                                  |
| native-modules / native-module-create        | 模块查询、创建/编辑、状态、日期、负责人、参与成员、收藏                                                       | `GET/POST/PATCH P/modules/`，`POST/DELETE P/user-favorite-modules/`                                              |
| native-module-detail                         | 模块详情、任务加入移除、参与成员多选、完成进度与分布                                                          | `GET P/modules/{id}/`，`GET/POST/DELETE .../issues/`，`PATCH P/modules/{id}/`                                    |
| native-views / native-view-create            | 项目视图创建、编辑、删除；显示后端可见性（访问字段为只读）                                                    | `GET/POST/PATCH/DELETE P/views/`                                                                                 |
| native-view-detail                           | 使用真实视图过滤条件、五种布局查看任务                                                                        | `GET P/views/{id}/`，`GET P/issues/`                                                                             |
| native-intake                                | 待处理、拒绝、延后、接受、重复需求列表与分页；有权限用户启用需求收集、创建需求                                | `GET/POST P/intakes/`，`GET/POST P/intake-issues/`                                                               |
| native-intake-detail                         | 富文本、优先级/负责人/标签编辑、评论；接受、拒绝、未来延后日期、搜索关联重复任务、重新待审；作者删除          | `GET/PATCH/DELETE P/intake-issues/{issue_id}/`，`I/comments/`                                                    |
| native-archives                              | 项目、任务、周期、模块归档列表与恢复；任务归档入口遵守完成/取消状态                                           | `GET P/archived-issues/`、`P/archived-cycles/`、`P/archived-modules/`；原实体 archive 接口                       |
| native-issue-detail                          | 完整任务详情、描述历史与恢复、订阅、子任务、相关任务、附件、评论、文档                                        | `GET/PATCH I/`，`P/work-items/{id}/description-versions/`，`I/subscribe/`                                        |
| native-issue-properties / native-issue-state | 状态、优先级、多负责人、多标签、日期、周期、模块、父任务、估算（编辑表单）；权限取真实项目角色                | `PATCH I/`，`P/cycles/{id}/cycle-issues/`，`P/modules/{id}/issues/`                                              |
| native-issue-create / native-issue-edit      | 富文本、属性、关联父任务、创建后加入周期/模块、继续创建；后续关联失败重试复用任务                             | `POST P/issues/`，`PATCH I/`                                                                                     |
| native-issue-activity                        | 富文本评论创建/修改/删除，评论回应添加/撤销，真实属性活动                                                     | `GET/POST/PATCH/DELETE I/comments/`，`P/comments/{id}/reactions/`，`GET I/history/?activity_type=issue-property` |
| native-issue-attachments                     | 系统文件选择、签名上传、确认、授权下载、作者/管理员删除；链接 CRUD                                            | `/api/assets/v2/workspaces/{slug}/projects/{project}/issues/{issue}/attachments/`，`I/issue-links/`              |
| native-issue-relations                       | 新建/搜索关联子任务、解除父子、关联类型选择、搜索任务、解除关系                                               | `I/sub-issues/`，`PATCH I/`，`I/issue-relation/`，`I/remove-relation/`                                           |
| native-my-tasks                              | 当前登录用户负责/创建/订阅任务与分页                                                                          | `GET W/user-issues/{session_user_id}/`                                                                           |
| native-documents / native-document-edit      | 任务详情嵌入 TaskDocuments，真实文档绑定、权限与导航；主文档协作编辑由根应用负责                              | `W/lab/projects/{project}/...` 的既有文档接口及 `W/lab/live-ticket/`                                             |

所有删除/归档/审批动作服从后端角色、所有权、状态及锁定规则；服务端拒绝显示原始业务错误。专用导出入口不出现在 core；数据查询、签名附件下载和文档同步保留。任务富文本与评论直接保存完整 HTML，避免丢失图片、表格、mentions 节点。

## 验证证据

2026-10-10，独立工作树 `/mnt/repo/ly/plane-android`，隔离服务 `http://127.0.0.1:18100`：

- Core 5 个公共接口合同测试通过，覆盖属性更新不覆盖描述、删除理由、富文本保留、移动属性保存保留未知桌面配置。
- 后端 42 个合同通过：账号/动态码、session 平台能力、Android 普通/管理员会话隔离、重放/失效、导出拦截、名为 export-lab 的正常查询、一次性 60 秒票据、文档 ACL/锁定/归档只读、原生需求创建及草稿归属/切项目/发布权限。
- Live 43 个测试通过；增加真实 Hocuspocus + WebSocket ticket 认证到 onLoadDocument 回归，证实异步 onConnect 后可信 context 保持，旧浏览器登录兼容；TSC 与 build 通过。
- 78 个真实 HTTP API 请求通过（独立复核测试账号、自建测试项目）。包括富文本、属性、评论/回应、链接、父子/关系、订阅、周期/模块及分析、保存视图/显示偏好、需求延后/重复/接受、归档恢复、附件上传中断后不可下载及上传确认授权下载、活动/描述历史/统计、导出 403。结果保存到 `/tmp/ooa-android-core-api-results.json`，只有路由、状态与测试实体 ID，没有凭据。
- `oxlint --max-warnings=0 apps/mobile/src/features/core` 与完整移动 TSC 通过；没有将浏览器/设备行为记为已验证。

## 重复执行

从仓库根目录执行；使用已有本地 node_modules 二进制，避免 pnpm wrapper 重复安装整个工作区。

```sh
apps/mobile/node_modules/.bin/vitest run apps/mobile/src/features/core
apps/mobile/node_modules/.bin/tsc --noEmit -p apps/mobile/tsconfig.json
node_modules/.bin/oxlint --max-warnings=0 apps/mobile/src/features/core
python3 apps/api/plane/tests/android_contract/stack.py status
python3 apps/api/plane/tests/android_contract/stack.py test
python3 apps/mobile/src/features/core/tests/real-api-contract.py /mnt/repo/ly/.android-release/test-credentials.json
```

Live 在 `apps/live` 目录执行 `node_modules/.bin/vitest run`、`node_modules/.bin/tsc --noEmit` 和 `node_modules/.bin/tsdown`。

隔离栈工具位于 `apps/api/plane/tests/android_contract/stack.py`；`up` 使用单独 Docker network、Postgres/Valkey/MinIO tmpfs、API 测试容器、HTTP、Live、Caddy，唯一宿主绑定 `127.0.0.1:18100`。支持 `status`、`test`、`restart-http`、`restart-live`、`stop`，只管理 `ooa-android-contract-*` 名称。首次 `up` 需要 Docker、已经构建的 API/MinIO 镜像（默认 `ooa-plane-api:lab`、`ooa-plane-minio:source`，可通过 `ANDROID_TEST_API_IMAGE`、`ANDROID_TEST_MINIO_IMAGE` 改名）、已有本地 JS 依赖和 Live 构建产物。首次启动自动生成独立密钥和六角色 fixture，保存到仓库外 `../.android-release` 的 0600 文件；目录 0700。工具 `status`、Python 编译检查和针对当前已运行隔离栈的幂等 `up` 已实际成功；尚未另建一套空数据库验证脚本首次启动。

私有 fixture `test-credentials.json` 含 `admin/member/guest/participant/reviewer/independent` 测试账号、工作区/项目/任务/悬赏/文档 ID、共享 anchor。浏览器管理员、模拟器成员、核心复核账号分别使用，避免动态码重放。核心脚本私有 cookie 缓存也放在 fixture 同目录。Caddy 必须同时代理 `/uploads` 和 `/uploads/*`，否则 MinIO 签名 POST 的无尾斜杠路径不能上传。`restart-live` 前先重新构建 Live，`restart-http` 仅在后端修改时使用。

生产运行服务、已发布文件与真实业务数据没有修改。当前隔离栈保留给根代理继续完成浏览器/模拟器验收。
