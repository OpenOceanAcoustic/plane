# 实验室平台底座选型

核实日期：2026-10-08。本文是方案研究，未实施迁移、停用旧服务或修改业务代码、配置、用户数据。

## 判断

当前没有核实到一个免费成品能完整覆盖实验室现有规则。产品已有看板、甘特或日历，不代表具备跨项目个人计划时间块、私人事项服务端隐藏、SSH 单次邀请与 TOTP-only 登录、并发预算/WIP、悬赏 VC 冲正账本等能力。

**用户已确认：继续基于当前 Plane Community Edition Fork 新增功能。** 保留现有 Django/DRF、PostgreSQL、React、用户与会话、项目权限及统一任务身份。实验室领域功能继续集中在 `plane.lab` 与现有前端 lab 组件，复用已完成的认证、规划、预算/WIP、验收、账本与测试；日历、甘特或其他交互确有需要时，再按模块引入下述开源组件。

选择现有底座的依据是已具备项目管理基础与实验室实现，且完成部署、业务测试、浏览器测试和备份恢复。独立重建还需要重新适配模型、身份、权限和数据，当前收益不足以抵消这部分工作。后续新增优先考虑 GitHub 提交/PR 关联、通用自定义字段与甘特依赖管理；具体需求和验收标准在各项实施前明确。

基线继续使用已验证的 v1.4.2；上游安全修复与版本升级须回归认证、权限、原生任务 WIP、实验室预算/VC 及部署流程。社区版允许自行修改和扩展，但官方商业版是独立的闭源代码库；新增能力由本项目自行实现，不能把移除升级入口视为获得商业模块。[官方版本说明](https://developers.plane.so/self-hosting/editions-and-versions)

其他候选仅用于记录备选与排除依据：Frappe Framework 的可安装业务 app 底座有长期扩展价值，但要迁移到不同的模型/身份体系；Vikunja 可较快提供轻量项目管理成品，但不兼容已有前后端栈。OpenProject 的甘特和 GitHub 集成较成熟，但原生 Team planner / Resource management 属于付费功能，且技术栈迁移成本较大。本轮不启动这些成品的迁移。

“免费”指所核实开源版本按其许可证可自行部署使用，不包括服务器运维成本，也不承诺厂商未来新增功能继续免费。复用或修改 Plane 来源代码仍须保留适用的 AGPL 条件，不能因移出原目录便将其改为 MIT。

## 当前开发基线

已有实现与验收记录见 [README](README.md) 和 [progress](progress.md)。后续新增建立在这些已经完成的能力之上：

- 原任务 ID 共用、跨项目 ABCD 个人目录；独立计划时间块，不改变任务的开始/截止日期；上海时区周历，15 分钟拖拉、伸缩与拆分。
- 私人事项权限过滤；管理员仅看到允许展示的忙碌信息；服务端实施预算与 WIP 并发约束。
- SSH 运维入口生成单次邀请；注册、会话、Authenticator TOTP-only 登录及限流。
- 悬赏验收、VC 累计差额、撤销/冲正账本、审计与导出。

目前 `lab/models.py` 外键引用 Plane 的 Workspace、Issue、Project，权限代码引用其成员/权限模型，身份代码依赖其用户与会话。继续开发时沿用这些关系，并集中维护与原生入口的集成。独立 Django/DRF + PostgreSQL + React 应用仅作为未来备选：只有具体模块的维护或功能限制证明需要拆分时，再明确身份、权限、接口与数据迁移；当前 lab app 不能脱离这些依赖直接独立运行。

## 成品与框架候选

| 候选                        | 已核实的免费能力与技术栈                                                                                                           | 对本项目的主要缺口                                                                                                             | 迁移判断                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Vikunja                     | AGPL-3.0-or-later；Go API、Vue 前端；项目/子项目、看板、甘特、任务关系、REST、webhooks、项目共享权限；可在自己服务器 Docker 部署   | 当前周/日 Planner 提案仍未合并；后端插件实验性且没有前端插件；原生 TOTP 仍搭配密码；Pro 审计/时间追踪不能计入免费核心          | 成品启动快，但现有 Django 规则需要独立服务对接或重写到 Go，React UI 无法直接嵌入 Vue；双身份/双权限是额外成本                          |
| Frappe Framework 自定义 app | MIT；Python/JavaScript；可安装 app、DocType、权限 hooks、自动 REST、Desk 的 Kanban/Calendar/Gantt；框架支持 MariaDB/PostgreSQL     | 框架不是开箱即用项目管理产品；未核实有完整依赖排程/免费资源周历；SSH 单次邀请/TOTP-only、个人隐私、VC/WIP 等需要开发           | Python 领域逻辑较易迁移，但 Django ORM/DRF/会话不是 Frappe app；需迁移为 DocType、hooks 和新身份/权限，React 可另做前端但仍需 API 适配 |
| OpenProject Community       | GPL-3.0；Ruby on Rails、PostgreSQL，Angular 与 Rails/Hotwire 前端；项目管理、基础看板、甘特/APIv3、自托管 Docker、基础 GitHub 集成 | Team planner 属于 Basic Enterprise，Resource management 属于 Premium；实验室特殊流程仍需插件/自建；未核实 TOTP-only 邀请身份链 | 项目管理最完整，但 Python→Ruby、React→Angular/Rails 与领域数据迁移较重；不适合作为免费原生人员排期方案                                 |

### Vikunja：免费核心够做任务管理，个人排期仍是扩展

[官方仓库](https://github.com/go-vikunja/vikunja)与[功能页](https://vikunja.io/features/)确认开源核心、四种任务视图、层级子项目、团队共享与任务关系。[Gantt 文档](https://vikunja.io/help/views/)描述使用任务开始/结束日期，以及由任务关系显示的依赖箭头；这不足以承诺完整工作日排程、关键路径或资源平衡。

[Planner PR #2957](https://github.com/go-vikunja/vikunja/pull/2957)在核实日仍是 Open，不能作为已发布的周历能力。其方案用任务日期呈现跨项目日/周时间安排，也不能直接等同现有“一任务多计划块、可拆分、与 deadline 分离”的模型。

[插件文档](https://vikunja.io/docs/plugins/)明确后端插件为 experimental，支持 Go 扩展路由、事件与迁移，当前没有前端插件支持。它提供扩展点，但不能理解成安装一个插件就能挂载 React ABCD 页面。

[权限文档](https://vikunja.io/docs/permissions/)描述项目级 readonly/readwrite/admin 共享权限；私人事项标题/备注在 API、查询、导出中的隐藏仍需自己的服务端校验。[REST 文档](https://vikunja.io/docs/api-documentation/)和[webhooks 文档](https://vikunja.io/docs/webhooks/)可作为集成基础，后者支持带 secret 的 HMAC-SHA256 签名。尚未核实免费核心有现成的 GitHub 提交/PR 关联界面。

[2FA 文档](https://vikunja.io/help/two-factor-authentication/)的本地登录流程使用账号、密码加 TOTP，不符合现有 TOTP-only 规则。[Pro 页面](https://vikunja.io/pro/)将管理面板、审计日志与时间追踪列为订阅功能；不能把这些写成免费核心交付。

[官方 Docker 指南](https://vikunja.io/docs/docker-walkthrough/)提供本地应用与数据库部署，应用服务可同时提供 API 与前端。无须采购云服务；实际迁移仍要明确任务 ID、用户映射和独立规则的事务边界。

### Frappe：真正的 app 扩展底座，但不是直接兼容 Django

[Frappe Framework 仓库](https://github.com/frappe/frappe)是 MIT 的 Python/JavaScript 框架；[ERPNext 仓库](https://github.com/frappe/erpnext)是另一个 GPL-3.0 ERP 产品。两者须区分：只安装 Framework，不等于获得 ERPNext 中的 Projects/Tasks 业务；自定义平台需要自己建立相应 DocType 与流程，或有意识地安装 ERPNext 并接受其领域与许可证。

[Apps 文档](https://docs.frappe.io/framework/user/en/basics/apps)和[Hooks 文档](https://docs.frappe.io/framework/user/en/python-api/hooks)提供可安装 app、页面/资源、文档事件与权限定制。[Desk 文档](https://docs.frappe.io/framework/user/en/desk)提供基于 DocType 元数据的 Kanban、Calendar 与 Gantt。它们适合作为业务界面起点，不能直接证明已有人员排期、依赖自动重排、15 分钟拆分、隐私过滤或预算约束。

[REST 文档](https://docs.frappe.io/framework/user/en/api/rest)支持自动 CRUD 与 API key/secret，请求关联用户并检查其角色。权限设计仍需覆盖自定义查询；Hooks 文档特别说明 `permission_query_conditions` 作用于 `get_list` 而非 `get_all`，因此不能只配置一个查询 hook 就认定所有服务端出口都安全。

[PostgreSQL 文档](https://docs.frappe.io/framework/user/en/guides/database-settings/postgres-database-setup)说明 Framework 可创建 PostgreSQL 站点；这不代表 Plane 的表能直接复用，也不保证每个第三方 app 或 ERPNext 功能都兼容。需针对选定稳定版本验证数据库与 app 支持。

[官方 frappe_docker](https://github.com/frappe/frappe_docker)支持 Framework、ERPNext 与自定义 app 的容器开发/生产部署。其 `pwd.yml` 是不能安装自定义 app 的一次性演示，正式自定义平台应使用包含所选 app 的镜像与生产部署流程。

SSH 单次邀请、TOTP-only 的完整身份链和现成 GitHub 提交/PR 界面，本轮没有核实为 Framework 免费原生能力。可用 app 接口自行实现，但应视作开发范围。选择 Frappe 的理由是长期业务扩展机制，而非已有 Django app 可直接安装。

### OpenProject：甘特与项目协作较强，免费人员排期有边界

[官方仓库](https://github.com/opf/openproject)、[应用架构](https://www.openproject.org/docs/development/application-architecture/)、[甘特文档](https://www.openproject.org/docs/user-guide/gantt-chart/)确认成熟项目管理和依赖/计划能力。[Enterprise 功能表](https://www.openproject.org/docs/enterprise-guide/)明确 Team planner 为 Basic Enterprise add-on，Resource management 为 Premium；二者不能计入本项目的免费原生排期能力。

[APIv3](https://www.openproject.org/docs/api/)可供外部集成；[GitHub 集成](https://www.openproject.org/integrations/github/)支持把提交与 PR 关联到工作项并展示状态。[插件开发文档](https://www.openproject.org/docs/development/create-omniauth-plugin/)提供 Rails 插件机制，不能理解为可直接安装现有 React/Django 模块。

[Community Docker 部署](https://www.openproject.org/docs/installation-and-operations/installation/docker/)可以落在自己的服务器。若仅希望外接一套成熟项目管理系统，它值得验证；若希望完全替代当前实验室后端并维持特别的个人规划体验，迁移代价和免费功能缺口较大。

## 可按需引入的开源组件与实际能力边界

以下组件可局部用于现有 React 应用；采用前须验证与 Plane 样式和依赖的兼容性。后端权限、事务、日历冲突和数据模型仍由现有服务负责。

| 用途                             | 建议组件                                                                                                                                                                                          | 已核实能力/许可证边界                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 人员日/周历、未来仪器资源排期    | [FullCalendar](https://fullcalendar.io/license)                                                                                                                                                   | Standard MIT，可配置 TimeGrid 的 slot/snap 与拖拉/伸缩；[Premium Timeline](https://fullcalendar.io/docs/timeline-view)按资源行显示横向时间轴。Scheduler/Resource Timeline 在前后端均完全满足其 AGPLv3 条件时可免费按 AGPLv3 使用，不能一概称为必需付费；大学身份也不自动代表符合其非商业免费条件                                                 |
| 全 MIT 的人员分列日/周历备选     | [react-big-calendar](https://github.com/bigcalendar/react-big-calendar)                                                                                                                           | 官方 [Calendar 源码](https://github.com/bigcalendar/react-big-calendar/blob/master/src/Calendar.js?plain=1)有 resources/accessors 和可配置 step；[DnD addon](https://github.com/bigcalendar/react-big-calendar/blob/master/src/addons/dragAndDrop/withDragAndDrop.js?plain=1)有 drop/resize 回调。未确认原生具备“人员按行、时间横向”的资源时间轴 |
| 项目甘特                         | [Frappe Gantt](https://github.com/frappe/gantt)                                                                                                                                                   | MIT；依赖箭头、时间视图与 `move_dependencies` 基础关联日期移动；不等于完整工作日/关键路径/资源优化引擎，也与 Frappe Framework app 无关                                                                                                                                                                                                           |
| ABCD 目录/看板拖排               | [dnd-kit](https://github.com/clauderic/dnd-kit)                                                                                                                                                   | MIT 拖拉工具；目录层级、跨板规则、排序持久化和权限由平台实现，非成品看板                                                                                                                                                                                                                                                                         |
| 列表、统一界面、编辑、未来流程图 | [TanStack Table](https://github.com/TanStack/table)、[shadcn/ui](https://github.com/shadcn-ui/ui)、[Tiptap](https://github.com/ueberdosis/tiptap)、[React Flow](https://github.com/xyflow/xyflow) | 各自核心 MIT；Tiptap 付费扩展/云协作不计入免费能力；React Flow 是图编辑/展示，不是后端审批执行引擎                                                                                                                                                                                                                                               |

数据边界继续沿用当前同一项目任务身份、个人计划块引用任务或私人事项且与 deadline 分离的设计。未来仪器资源排期可在具体需求明确后扩展。GitHub 接入建议采用独立关联记录与幂等事件处理，所有任务变更仍经过验收、VC 入账和 WIP 约束；GitHub 关联与仪器排期属于待开发功能。

## 新增功能与升级需要验证的事项

1. 选定具体组件与稳定版本，做小范围原型，验证上海时区、跨日、15 分钟拖拉、拆分、多人资源视图和现有体验。插件或 PR 的存在不能代替发布版本的实际验收。
2. 沿用现有用户、权限与任务身份，明确新增模块的接口边界。保留既有业务测试，在隔离环境验证新增功能与上游升级不会破坏现有数据和约束。
3. 验证每种 API、查询、日历事件、批量接口、导出与审计的私人事项可见性；不能靠前端隐藏。确认预算/WIP/VC 的事务与并发约束仍在服务端。
4. 验证 GitHub webhook 签名、重放/重试、安装或 token 的权限与撤销、仓库可见性，以及任务关联规则。Frappe/Vikunja 的通用 API/webhooks 不等于已交付原生 GitHub 产品集成。
5. 验证新增页面与接口继续受 TOTP-only 和 SSH 邀请身份链保护；主应用、管理员和 Space 的原有认证入口仍不可绕过该规则。

Taiga/Redmine 本轮不展开：已核实的三类候选和自主组合足以回答当前决策，尚无证据表明另一个成品可以减少这些领域规则与现有代码的迁移工作。
