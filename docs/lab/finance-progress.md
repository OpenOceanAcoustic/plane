# 项目奖励、真实资金与公开悬赏交付记录

实施基线为 `3794753`，保留已交付的个人规划、资源时间轴、事项详情、自定义类别、排期覆盖色和原生任务。使用说明见 [finance-guide.md](finance-guide.md)，接口契约见 [finance-api.md](finance-api.md)。

## 实现

项目负责人分别配置任务及成员阶段奖励表达式、参数与样例。服务端使用 Decimal 和受限 AST 求值；版本、原因、权威输入与参考结果保留快照。项目不记录合同或资助总额，阶段 E 与用途条目由负责人输入。预测不自动产生个人应付，公式变更不改写已核准金额。

实际到账 D 独立按 15%／10%／5%／70% 分池，升级成员部分保留历史 10%／执行 90%。负责人录入个人阶段累计最终金额和绩效依据，保留关联预测及差额；付款安排与线下支付分别记录，扣缴、实付、核销独立展示。原批次准备金责任支出／释放、冻结历史资格、公共月度职责、未来池年度编列、探索划拨、争议预留、未用结转及同项目留存拨入其他阶段均有明确业务动作。

人民币与 VC 分账，服务端按实际业务资源核验权限，以行锁和请求键保护并发及幂等。财务历史、公式、快照和审计由 PostgreSQL 触发器保护，仅允许追加更正／冲正。迁移为 `0007` 至 `0011`，没有改写原有账号、VC 或排期数据。

悬赏大厅默认开放认领卡片，保留本人待办／参与及直接详情入口。公开摘要、任务执行权限及原生项目访问分别核验；跨项目确认仅建立任务授权并自动加入本人规划。附件和特定文档版本通过受控面板明确共享、读取和撤回。大厅、规划、日历、原生看板共用彩色描边、实心星及悬赏标记，保留成员类别色和排期覆盖色；隐藏事件仍为中性忙碌。

项目与资金 React Flow 支持并行阶段、到账批次和节点办理入口，点击节点显示源记录、操作人、事实／记录日期、凭证及快照。项目归档与资金结清分别判断；原生项目生命周期审计在数据库事务内追加，旧事件仅恢复已有证据。

真实验收发现保存后打开的日历详情可能持有旧时间块。确定性组件复现先失败，再修复为开始调整时读取当前记录并等待自己的保存刷新；已经打开表单后的真实并发修改仍返回 409。测试控制 GET 完成顺序，不依赖固定延时。

## 验证

- 最终隔离 PostgreSQL 全量：**663 passed**，308.91 秒；92 条既有依赖警告。真实迁移、不可改写历史、不同项目公式、缺参／除零、权威参数、快照追溯、累计核准与支付并发、跨项目及原附件入口权限均通过。
- 原规划浏览器组件及新增排期竞态回归：**37 passed**。项目资金、公式、公开卡片、任务授权、资料版本、节点办理、公共职责及留存划拨组件：**10 passed**。
- 隔离完整服务的 **4 项真实浏览器测试**与 10 项资金组件联合执行：**14 passed，2.0 分钟**。实际 TOTP 会话验证参考 440 元、最终核准 300 元及差额 -140 元；付款 100 元扣缴 10 元，再付款 200 元，累计核销 300 元、实付 290 元、执行账户余额 1100 元。真实流程图、CSV、特定文档版本分享／撤回、自动规划及原生看板配色星标均通过，原有上传、排期、甘特、文档、图表和重启限流继续通过。
- web／admin／space／UI／shared-state／types 共 **22 项类型与 Lint 任务通过**；最终排期修复再次通过 web 类型和严格 Lint。全部变更 TypeScript 的 oxfmt 检查通过，后端 Ruff、迁移漂移及 Git 空白检查通过。
- web、admin、space、live 及共享包生产构建完成；最后 web 以单工作线程构建成功，API 镜像构建成功。未修改的固定源码 MinIO 复用既有镜像。

完整日志保存于本机 `/tmp/ooa-finance-full-final-api.log`、`/tmp/ooa-finance-real-e2e.log`、`/tmp/ooa-finance-ts-lint.log`、`/tmp/ooa-finance-web-final-build.log`、`/tmp/ooa-finance-api-final-build.log`。37 项组件与排期先红后绿的精确记录保留在工具终端，没有另外生成日志。日志不包含正式认证凭据。

## 备份与既有服务更新

2026-10-09，先停止写入服务和附件服务，保存数据库、附件及配置至 `/home/l1111y/.local/share/ooa-plane/backups/pre-finance-20261009-050602`。认证密钥单独保存于 `/home/l1111y/.local/share/ooa-plane/auth-key-backups/pre-finance-20261009-050602.totp.key`。目录 0700、文件 0600。

在独立临时数据库及附件卷恢复后，旧数据库记录数核对一致；新镜像增量迁移通过，**26 个附件文件**逐内容一致，**1 条加密认证凭据**用独立密钥解密验证通过。恢复只操作临时卷，随后清理，未覆盖正式卷。

正式实例 `ooa-plane-lab` 已应用 `0007` 至 `0011` 并更新至最终前后端构建。迁移前后的账号、项目、任务、认证凭据、VC、阶段、悬赏、分工、文件夹、类别、个人事项及时间块共 **12 张原有表**，数量和完整记录指纹一致。指纹证据存放在备份目录的 `legacy-before.json`／`legacy-after.json`；未在正式实例创建测试账号、悬赏或资金。

内网入口为 `http://192.168.137.90:8080`，十个服务均运行。主应用、管理后台、Space 和实例 API 返回 200，网页及抽查资源与最终构建逐字节一致。真实 Chromium 验证三个用户名／动态码入口正常且无失败资源请求；匿名财务请求返回 401。四个既有数据资金／流程读取视图通过，15 个财务模型的记录数量保持不变。Django 系统检查、迁移漂移检查及真实签名上传／下载均通过。

部署与恢复日志为 `/tmp/ooa-finance-production-backup.log`、`/tmp/ooa-finance-production-restore.log`、`/tmp/ooa-finance-production-migrate.log` 和 `/tmp/ooa-finance-production-start.log`。已保留前一版 API 镜像标签 `ooa-plane-api:pre-finance-20261009`；任何需要数据回退的恢复仍须先停止写入，使用本次匹配的完整备份及独立认证密钥。

## 2026-10-09：操作崩溃、悬赏删除与规划总览修复

内网普通 HTTP 不提供 `crypto.randomUUID()`，导致资金表单、流程节点、自定义参数和部分验收／冲正入口挂载时崩溃。普通 HTTP 确定性复现先失败，使用既有 `uuid` 依赖后通过；失败重试仍使用相同请求键。

悬赏详情新增带原因的删除接口和按钮。事务内释放未授予 VC、撤回任务授权及共享、追加删除审计；解绑原事项后可以再次发布。原生事项、个人引用、文件夹、类别、排期和已记账贡献及付款保留。删除后账本通过权威 `can_reverse` 继续提供当前负责人可办理的冲正入口。客户端丢弃已删除卡片的迟到响应，并以请求版本保护阶段余额。

规划项目工作项使用原生右侧总览，支持原属性和活动记录；个人事项及任务级跨项目参与使用对应右栏。原生可读与可编辑权限分别投影，跨项目任务不会请求整个项目的原生接口。受控详情每次打开重新核验权限，核验期间和撤权后不展示缓存执行资料。

验证结果：真实 PostgreSQL 全量 **673 passed**；规划组件 **42 passed**；资金及普通 HTTP 组件 **18 passed**；状态与缓存回归 **5 passed**。四项完整服务浏览器验证通过，其中新增原生总览／已付款悬赏删除的主流程在最终构建上单独通过（1.8 分钟），验证原生优先级写入、刷新、活动，以及删除前后现金、VC、文件夹、颜色和时间块一致。Web／shared-state 类型、严格 Lint、格式、Ruff、生产构建和迁移漂移检查通过，无新增迁移。

备份为 `/home/l1111y/.local/share/ooa-plane/backups/pre-bugfix-20261009-1120`，独立密钥为 `/home/l1111y/.local/share/ooa-plane/auth-key-backups/pre-bugfix-20261009-1120.totp.key`。隔离恢复数据库、26 个附件文件和 1 条加密凭据通过；更新前后 12 张原有表的完整指纹一致。正式服务已更新至 API 镜像 `d9fc85fd4238` 和最终 Web 构建，10 个服务运行，原资金读取及真实签名上传／下载通过。

正式匿名页面可用，构建资源逐字节一致，匿名财务返回 401。额外检查发现根页面的既有可恢复 React hydration 警告；旧、新构建对照均为 40 次 #418 和 1 次 #423，静态节点树相同，本轮没有修改认证或 hydration 入口。

本轮日志：`/tmp/lab-bugfix-api-full.log`、`/tmp/ooa-planner-native-browser-final.log`、`/tmp/lab-finance-components-ledger-complete.log`、`/tmp/lab-bugfix-store-final.log`、`/tmp/lab-bugfix-native-delete-e2e.log`、`/tmp/lab-bugfix-web-final-build.log`、`/tmp/lab-bugfix-production-backup.log`、`/tmp/lab-bugfix-production-restore.log`、`/tmp/lab-bugfix-production-browser-verified.log`。

## 2026-10-09：简化项目 VC 预算与悬赏发布

悬赏大厅仅保留发布、认领和任务详情，移除独立冻结阶段 B、WIP 管理和账本入口。发布只选择项目和工作项，填写一次资料、交付要求、验收标准、VC 配额和验收人；重大任务复核按门槛显示，其他设置折叠。工作项自动列出可发布事项。VC 预算与 VC 明细统一在“资金与奖励”，保留筛选、冲正和 CSV／JSON 导出。

当前发布来源为该项目最新 VC Stage，不要求先配置人民币 E，也不跨阶段合并或回退旧预算。服务器锁定来源、校验余额并预留额度；删除／取消只返还尚未授予的部分。真实 VC、参考公式、历史资格、现金核准和线下付款继续独立。项目 VC 预算保存支持可选 UUID 请求键，同一请求重试返回原来源，不重建预算、清空占用或提升旧来源。锁等待后重新核验当前负责人。

原生新项目第一次发布可自动从现有待做、进行中及完成状态建立映射，复用或追加独立待验收状态；已有完整或部分人工映射不被覆写。自动准备和发布同处事务，失败时回滚新增状态及审计。旧 stage_id 客户端保持原接口语义；新增 project_id 客户端由服务器确定当前预算。没有新增模型或迁移。

验证：真实迁移后的后端全量 **697 passed**（334.66 秒，92 条既有依赖警告）；新增原生状态及既有悬赏／项目预算专项 **38 passed**，其中新增状态测试 11 条，合计覆盖 708 个不同后端用例。资金与普通 HTTP 组件 **21 passed**，简化发布组件 **6 passed**。最终构建的真实主浏览器流程通过（2.1 分钟），另三个真实入口／重启限流测试通过；真实新项目及既有项目的 25→20→25、111→106→111 VC 扣减和返还均验证，超额请求返回 400，已有现金、VC、事项、状态和配色保留。

验收脚本已按实际原生接口契约采用默认待做映射和 state_id：创建后读取工作项详情作为状态基线，删除后再次读取比较，不将创建响应缺失的字段视为零或默认值。Web／types 类型、变更文件严格 Lint、格式、Ruff、Git 空白、Django 系统检查和迁移漂移检查通过；最终 Web 和 API 镜像构建通过。

部署备份：`/home/l1111y/.local/share/ooa-plane/backups/pre-simple-bounty-20261009-1252`；独立认证密钥：`/home/l1111y/.local/share/ooa-plane/auth-key-backups/pre-simple-bounty-20261009-1252.totp.key`，权限 0700／0600。独立恢复验证通过，14 个附件文件和 1 条加密认证凭据验证成功，未覆盖正式卷。更新前后原有 15 张表（含原生状态、状态映射及审计）的数量和完整记录指纹一致。

正式 `ooa-plane-lab` 已更新为 API `8ec6723aeae3` 与最终 Web 构建，10 个服务运行。原数据 4 个资金／项目读取视图及新增项目预算读取通过，相关资金、VC、状态、映射与审计数量保持不变，真实签名上传下载通过。三个匿名认证入口和实例 API 正常，匿名资金及预算均返回 401；主应用 HTML 及实际载入的 88 个静态资源与最终构建逐内容一致，没有静态请求失败。可恢复 React 提示按页面记录：主入口 #418=41／#423=1，管理后台 0／0，Space 16／1。主入口与旧记录 40／1 相差一次 #418；没有改动认证／hydration 入口，不宣称次数完全不变，也不描述为完全无控制台错误。

本轮日志：`/tmp/lab-bounty-simple-backend-final.log`、`/tmp/lab-bounty-native-flow-final.log`、`/tmp/lab-simple-bounty-all-components.log`、`/tmp/lab-simple-bounty-real-e2e-native-contract.log`、`/tmp/lab-simple-bounty-web-build-final.log`、`/tmp/lab-simple-bounty-api-build-with-flow.log`、`/tmp/lab-simple-bounty-production-backup.log`、`/tmp/lab-simple-bounty-production-restore.log`、`/tmp/lab-simple-bounty-production-smoke.log` 和 `/tmp/lab-simple-bounty-production-browser.log`。隔离后端及浏览器测试资源与临时凭据均已清理，正式实例没有创建测试账号、悬赏或资金。

## 2026-10-09：输入时金额上限、同人验收复核与悬赏图整理

此前账户、现金安排和悬赏配额主要在提交时检查，输入超额没有即时反馈。本轮增加共享十进制金额输入组件，以精确整数运算比较元、VC 与份额；输入超过所选来源、批次或可核准余额时立即显示字段错误并禁用保存。切换来源、年度或关联金额会同步重新计算，涵盖支出、划拨、承诺、线下付款、扣缴、风险释放／使用、争议预留、结转、阶段用途合计及成员份额。已有付款和承诺同时形成累计核准的下限；新预算、期初余额及新到账不套用已有账户余额上限。

年度未来池限额不能从前端可见的项目操作列表推算，因为指定管理员未必能查看每个来源项目。财务概览新增管理员可读的 `future_plan_limits` 工作区汇总，按工作区时区和事实年计算，排除冲正并扣除已编列额度；项目筛选仍保留正确公共额度，其他用户不获得年度源明细。悬赏新增 `claim_available`，扣除所有已批准计划配额，未批准申请不占额度，已授予贡献不重复扣减。认领及批准继续执行服务器锁和预算复核；并发拒绝后刷新额度并保留已填资料。

移除重大发布时要求发布人、验收人和复核人各不相同的身份限制，可选择同一名有效项目成员。重大任务仍保留发布复核和验收复核步骤；每步权限及记录独立，任务参与者仍不能验收自己的任务。悬赏图使用水平主线和下方结果分支，默认隐藏无关退回／取消／更正连线；点击节点或“全部流转”可以查看原关系，“当前阶段”用于定位。节点、操作和记录没有删除。

验证：悬赏相关 **67 个不同后端用例**和资金／年度上限专项 **36 个用例**均已覆盖通过，包括同一负责人贯穿重大任务发布、验收和复核、权限拒绝、预算扣减与删除返还、并发、历史支付及年度冲正恢复。资金组件 **46 passed**、发布／认领组件 **12 passed**、流程图组件 **5 passed**；最终构建上的真实浏览器验收 **1 passed（47.3 秒）**，实际验证 12.51 元超过 12.50 元时没有发送请求、更正为 3.25 元后余额 9.25 元、100.01 VC 超过 100.00 VC 时禁止发布、25 VC 重大悬赏同人发布复核，以及主流程／全部流转与真实接口返回的完整关系一致。

Web 和 UI 类型检查、types／UI 构建、变更 TypeScript 严格 Lint、格式检查、Ruff、Django 系统检查及迁移漂移检查通过，无新增迁移。Web 全范围 Lint 单工作线程执行通过（772 条既有警告、0 错误）；首次多线程执行出现工具内部 Rust panic，重跑通过。最终 Web 和 API 镜像生产构建通过。

更新前备份至 `/home/l1111y/.local/share/ooa-plane/backups/pre-live-finance-20261009-1556`，认证密钥独立保存在 `/home/l1111y/.local/share/ooa-plane/auth-key-backups/pre-live-finance-20261009-1556.totp.key`（0700／0600）。隔离恢复数据库和增量迁移、**14 个附件文件**以及 **1 条加密凭据**验证通过。正式 `ooa-plane-lab` 已更新为 API `927e2ea346a5` 和最终 Web 构建，10 个服务运行，其余 6 个服务容器身份不变；更新前后的 15 张原有表及 15 张财务表共 **30 张表**数量和完整记录指纹一致，证据在备份内 `legacy-before.json`／`legacy-after.json`。未在正式实例创建测试账号、悬赏或资金。

内网 `http://192.168.137.90:8080` 的三个匿名认证入口和实例 API 正常；匿名资金和项目 VC 预算读取返回 401。主应用 HTML、实际加载的 88 个静态资源及新增金额／流程模块与最终构建逐字节一致，无资源请求失败或新增页面错误。既有可恢复 hydration 提示仍为主入口 #418=41／#423=1，管理后台 0／0，Space 16／1。已保留旧 API 镜像 `ooa-plane-api:pre-live-finance-20261009` 和 `.temp/lab-build/pre-live-finance-20261009-155059/client-mounted`。

日志：`/tmp/lab-finance-input-limits-final.log`、`/tmp/lab-finance-input-limits-regression.log`、`/tmp/lab-bounty-role-quota-backend-final.log`、`/tmp/lab-bounty-quota-adjusted-regressions.log`、`/tmp/lab-finance-live-all-components.log`、`/tmp/lab-bounty-roles-quota-components-final.log`、`/tmp/lab-live-finance-real-e2e-final.log`、`/tmp/lab-live-finance-web-types.log`、`/tmp/lab-live-finance-web-lint-final.log`、`/tmp/lab-live-finance-web-build.log`、`/tmp/lab-live-finance-api-build.log`、`/tmp/lab-live-finance-production-backup.log`、`/tmp/lab-live-finance-production-restore.log` 和 `/tmp/lab-live-finance-production-browser.log`。

本轮隔离后端与浏览器测试容器、卷及临时认证配置均已清理，正式服务保持运行。

## 分笔到账、资金配置删除及工作项删除

真实到账页面增加直接登记入口及有效到账笔数、金额和核准 D 汇总，同阶段可持续登记独立批次。到账删除通过不可变操作及反向流水处理，保留原凭证、事实日期和登记日期，不重写其他批次。期初余额单列，不计入实际到账汇总；准备金后续操作、年度编列、核准奖励、现金承诺及已用金额继续约束撤销。删除成功但刷新失败时仅重试读取，不重复写删除请求。

阶段预算（包含仅有 VC 的 Stage）和资金项目可删除、查看已删除记录及显式恢复。删除采用追加的状态操作，不删除原生项目、任务或财务历史；未完悬赏、现金余额、未结清奖励和未缴扣款阻止关闭。历史已赚 VC 不永久阻止已结清配置关闭。当前来源被删除不会回退旧 VC 预算；发布、公式、预测、资金目标及历史冲正均校验关闭状态。跨阶段冲正逐一检查原账账户，不能把钱写回已关闭的来源。流程记录显示删除及恢复，已关闭对象只提供恢复动作。

原生工作项详情、个人规划和任务表增加真正删除源任务的入口，与原生单项／批量删除共用事务。关联悬赏仅负责人可删，返还未授予 VC、撤销资料与任务授权，保留贡献、预测、核准及付款历史。原生看板缓存立即移除；后台关联清理后规划和日历隐藏源任务，原排期历史保留。退出项目的旧创建者不能删除；仍有悬赏子孙项时需先处理对应子工作项，防止后台级联跳过清理。

验证：资金定向 82 项通过，新增关闭流程与跨源冲正后 52 项定向通过，最后 3 项展示／流程验证通过（这些运行包含重复用例，不作为独立用例总数）。工作项删除及已有悬赏删除 17 项通过，后补父子保护 1 项通过。真实组件验证资金 7 项、恢复与关闭来源 3 项、最终工作项删除 4 项通过；原生发布及删除组合 7 项也通过。类型构建、Web 类型、变更文件严格 Lint、格式、Ruff、Django 检查和生产 Web／API 构建通过。复用既有增量迁移，无新 schema 迁移。

完整备份为 `/home/l1111y/.local/share/ooa-plane/backups/pre-finance-removal-20261009-233753`，认证密钥独立保存（目录 0700、文件 0600）；数据库、迁移、附件与加密凭据的隔离恢复验证通过，没有覆盖正式卷。旧静态目录保留在 `.temp/lab-build/pre-finance-removal-20261009-233753/client-mounted`，新构建保留 292 个旧哈希资源。旧 API 镜像保留为 `ooa-plane-api:pre-finance-removal-20261009-233753`。

正式服务更新为 API `fdc5c2453147` 和最终 Web 构建，10 个服务运行，其余 6 个服务容器身份不变。停写备份后至更新完成，30 张业务表的数量及完整指纹一致；没有在正式实例创建测试账号或执行到账、删除、悬赏及规划写操作。6 个正式接口在只读事务中验证新权限与删除状态字段；三个匿名入口、实例 API、资金未授权拒绝及 88 个实际加载资源通过，新功能的 7 个模块与构建字节一致。原有可恢复 hydration 提示为主入口 41／1、后台 0／0、Space 16／1，没有新增页面错误。

日志：`/tmp/lab-finance-delete-regression.log`、`/tmp/lab-finance-delete-final.log`、`/tmp/lab-finance-delete-final-increment.log`、`/tmp/lab-issue-delete-pg-final.log`、`/tmp/lab-issue-delete-parent-green.log`、`/tmp/lab-finance-receipts-components.log`、`/tmp/lab-finance-restoration-components.log`、`/tmp/lab-issue-delete-browser-final.log`、`/tmp/lab-finance-removal-web-types-final.log`、`/tmp/lab-finance-removal-web-lint-final.log`、`/tmp/lab-finance-removal-web-build-final.log`、`/tmp/lab-finance-removal-api-build.log`、`/tmp/lab-finance-removal-production-backup.log`、`/tmp/lab-finance-removal-production-restore.log`、`/tmp/lab-finance-removal-production-metadata.log`和 `/tmp/lab-finance-removal-production-browser.log`。隔离测试及恢复服务已经清理。
