# Android 实验室功能与接口覆盖

所有下列路径均相对于 `/api/workspaces/{slug}/lab/`，通过安卓 `ApiClient` 原生传输执行。正式应用读取实际业务接口；浏览器验收使用与生产入口隔离的确定性测试数据，未读取已部署服务数据。所有资金、规划、贡献与统计记录均按记录纵向排列，无横向宽表；月历与图表适应 360/412px 屏宽。

## 个人规划、团队排期、任务字段

| V4 场景／安卓入口                  | 行为与实际接口                                                                                | 权限与错误行为                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 个人规划看板、列表、文件夹筛选     | `GET planner/`；以待做／进行中／待验收／完成分组，并显示本周投入、最近时间块、分类、任务编号  | 只使用当前用户可见规划；项目任务点击 `onOpenIssue(projectId, issueId)`；受限悬赏点击其受限详情     |
| 新建、整理个人事项                 | `POST items/`；`PATCH items/{id}/`：标题、说明、分类、文件夹、公开与状态                      | 引用任务标题由服务器维护；`can_edit_issue=false` 或悬赏任务不直接修改项目状态                      |
| 引用项目任务                       | `GET tasks/?q=...&project_id=...`；`POST items/` 传 `issue_id`                                | 只呈现服务器允许读取的任务；重复引用错误保留表单                                                   |
| 文件夹管理                         | `POST folders/`；`PATCH/DELETE folders/{id}/`；`PUT folders/` 传完整有序 `ids`                | 个人资源权限由服务端检查；删除确认后执行；上移按真实完整列表排序                                   |
| 分类管理                           | `POST categories/`；`PATCH/DELETE categories/{id}/`                                           | 分类名、颜色使用实际接口；后端没有分类排序接口，界面不展示排序按钮                                 |
| 项目状态映射                       | `PUT flows/{projectId}/`：四种个人状态映射到现有项目状态                                      | 只展示负责人项目；映射校验错误不关闭表单                                                           |
| 个人／团队日程、月历、周历、时间轴 | `GET calendar/?start=...&end=...&team=0/1`；成员与项目过滤                                    | 团队入口遵守 `planner.team_access`；隐私事项显示服务器返回的忙碌状态；周历按选中日期所在自然周过滤 |
| 新建时间块                         | `POST calendar/`：个人事项、上海时区 ISO 时间、颜色                                           | 十五分钟步长；结束须晚于开始；重叠提示来自服务器                                                   |
| 调整、拆分、删除时间块             | `PATCH/DELETE calendar/{id}/`，始终携带打开编辑时的 `expected_revision`；拆分携带 `split_at`  | 只显示 `editable=true` 的操作；冲突保留当前表单，刷新权威排期，重新打开可读取新版本                |
| 项目甘特与日期联动确认             | `GET projects/{id}/gantt/`；`POST .../preview/`；用户确认后 `POST .../commit/` 传服务器 token | 日期调整与依赖编辑仅负责人；显示所有受影响任务的旧／新日期；预览或提交失败保留状态                 |
| 甘特前后依赖                       | `POST/DELETE projects/{id}/gantt/dependencies/`                                               | 非负责人可查看依赖；环与权限由服务器拒绝                                                           |
| 任务记录纵向表                     | `GET task-table/?project=...`，筛选与任务详情                                                 | `editable` 控制填写字段；保留现有项目任务主身份                                                    |
| 工作区字段定义、停用               | `GET/POST field-definitions/`；`PATCH field-definitions/{id}/`                                | `can_manage` 控制定义管理；字段类型创建后固定，停用保留历史                                        |
| 项目字段启用                       | `GET/PUT projects/{id}/fields/`，传完整启用 `ids`                                             | 项目 `can_manage` 控制启用；成员选项来自服务器                                                     |
| 任务字段填写                       | `PATCH tasks/{issueId}/field-values/`，`values` 按字段 ID 发送                                | 支持文本、数字、单选、多选、日期、成员、布尔、网址；仅发送已启用且未停用字段                       |

## 悬赏、验收、资料

| V4 场景／安卓入口                  | 行为与实际接口                                                                                               | 权限与错误行为                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 悬赏大厅全部／可认领／我参与、待办 | `GET bounties/`；`GET inbox/`；项目与文本筛选                                                                | 公共、任务与项目访问级别以服务端返回为准                                                                                                       |
| 发布悬赏底部表单                   | `GET bounties/budgets/`；`GET tasks/?publishable=1&project_id=...`；`POST bounties/`                         | 负责人入口；沿用成熟发布规则，包括 VC 配额、剩余额度、交付物、标准、验收人、重大事项独立复核人、现金与人日触发条件；错误后刷新配额             |
| 悬赏详情、分工、验收历史           | `GET bounties/{id}/detail/`                                                                                  | 不通过原任务接口扩大受限参与者可见资料；只有项目级访问显示通用任务详情入口                                                                     |
| 全流程动作                         | `GET bounties/{id}/workflow/`；按返回 `actions` 执行 `POST bounties/{id}/{action}/`                          | `enabled` 与 `reason` 决定能否操作；覆盖 claim、approve、confirm、start、submit、accept、publication-review、acceptance-review、cancel、reopen |
| 认领、分工核准、本人确认           | 认领发送本人交付物与十进制 `planned`；核准沿用服务器 action 的 `allocation_id`                               | 额度使用整数定点数校验；限额与 WIP 仍由服务器检查                                                                                              |
| 交付、验收、独立复核               | 交付发送成果 evidence；验收发送结果、每位参与者累计 targets 与处理意见                                       | 验收 request_key 在同一个打开的表单跨失败重试保持；全通过与有效负结果须达到计划，部分通过不能低于已授予，不得超出总预算                        |
| 贡献冲正                           | workflow 返回 reverse 时调用 `POST ledger/{ledger_id}/reverse/`                                              | 服务器权限、原账本 ID 和稳定 request_key；保留原始记录                                                                                         |
| 公开摘要编辑                       | `POST bounties/{id}/public-summary/`                                                                         | 仅负责人；摘要、公开交付物、标准、公开开关、更新原因                                                                                           |
| 悬赏删除确认                       | `DELETE bounties/{id}/detail/`                                                                               | `can_delete` 控制入口；成功后刷新大厅、待办与规划                                                                                              |
| 执行资料、冻结文档版本、附件       | `GET bounties/{id}/materials/`；负责人 `?sources=1`；`POST materials/`；`GET/DELETE materials/{materialId}/` | 只使用受限资料端点；版本内容经过 HTML 清理；附件使用原生授权下载；`can_manage_materials` 控制共享与撤回                                        |
| WIP 例外列表与批准                 | `GET/POST wip-exceptions/`                                                                                   | 团队权限控制批准入口；禁止本人批准；明确到期时间、活跃／重大上限、原因；服务器再次校验                                                         |

## 资金、奖励、统计与个人 VC

| V4 场景／安卓入口                    | 行为与实际接口                                                                                                                                                        | 权限与错误行为                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 分池资金总览与全部纵向记录           | `GET finance/overview/?project_id=...`；公开汇总、账户、预算、到账、预测、核准、支付安排、实际支付、公共职责、操作及分录                                              | 项目／公共管理员权限取自服务器；金额保持原始十进制字符串                                                                        |
| 冻结阶段预算                         | `POST finance/stage/`；用途、成员基础／职责份额、VC、升级历史资格与来源                                                                                               | 复用现有完整资金表单与定点金额校验，预算用途和总份额规则保持                                                                    |
| 设置项目 VC 预算                     | `POST stages/`                                                                                                                                                        | 只展示负责的有效项目；预算与阶段名                                                                                              |
| 到账、期初、划拨、实际支出           | `POST finance/receipt/`、`opening/`、`transfer/`、`expense/`                                                                                                          | 可管理账户和阶段来自实际总览；可用额、成本、可分配额均以定点数校验                                                              |
| 最终／历史奖励核准与支付             | `POST finance/settlement/`、`history-settlement/`、`commit/`、`cancel-commit/`、`payment/`                                                                            | 区分核准、安排、线下支付；不可将预测直接当最终奖励；付款保留应付、扣缴、凭证与事实时间                                          |
| 风险、未来池、争议、结转、阶段拨付   | `POST finance/tax-remit/`、`risk-release/`、`risk-use/`、`future-plan/`、`exploration-allocation/`、`dispute/`、`resolve-dispute/`、`carryover/`、`stage-allocation/` | 原批次风险余额、同阶段账户、未来年度限额与已核准预留规则复用成熟表单；公共动作只向公共管理员显示                                |
| 公共职责奖励与支付                   | `POST finance/public-duty/`、`public-commit/`、`public-cancel-commit/`、`public-payment/`；指定管理员 `manager/`                                                      | 公共管理员处理，管理员指定遵守 can_designate_manager；成员与可批准对象来自服务器                                                |
| 冲正、到账／预算／资金项目删除与恢复 | `POST finance/reverse/`、`receipt-delete/`、`stage-delete/`、`project-delete/`、`stage-restore/`、`project-restore/`                                                  | `can_manage/can_delete/can_restore/delete_reason` 控制操作；删除成功、刷新失败保留已执行状态，避免重复删除                      |
| 全部资金修改重试                     | 每个打开表单生成一个 UUID request_key                                                                                                                                 | 同一次表单网络失败后重试复用相同 key；金额输入始终发送字符串；允许稳定重复提交由服务端幂等化                                    |
| 预计奖励公式版本、模板、参数、试算   | `GET/POST finance/formulas/{projectId}/`；`POST finance/preview/{projectId}/`                                                                                         | 只向负责人显示配置；支持任务／成员表达式、自定义参数、历史版本及原因                                                            |
| 参考预测                             | `POST finance/forecast/`                                                                                                                                              | 支持任务／成员及预算／到账口径，沿用当前公式和自定义参数                                                                        |
| 资金生命周期                         | `GET finance/workflow/?project_id=...`                                                                                                                                | 逐节点展示实际流程、可办事项、历史和计算快照；动作使用上述同一完整资金表单                                                      |
| 项目贡献账本                         | `GET ledger/?project_id=...`；`POST ledger/{id}/reverse/`                                                                                                             | can_reverse 决定冲正入口；保留参与者、任务快照、授予与更正原因                                                                  |
| 全部数据总览图表                     | `GET analytics/?start=...&end=...&project_id=...&user_id=...&team=...`                                                                                                | project/schedule/vc 三域；完整渲染服务器返回的 donut/bar/line/stack/heatmap，数据记录可展开纵向查看；can_view_team 控制团队选择 |
| 图表点击明细                         | `GET analytics/drilldown/?...&chart=...&key=...`                                                                                                                      | 保留当前过滤条件；服务端明细权限；实际任务／项目记录跳转回主应用                                                                |
| 我的项目与 VC 汇总                   | `GET me/contributions/`                                                                                                                                               | 显示项目、悬赏与历史参与、有效／获得／冲正；只有 can_open_project 显示打开项目                                                  |
| 贡献月历、日期／项目过滤、记录分页   | `GET me/contributions/calendar/?month=...&project_id=...`；`GET me/contributions/entries/?month=...&project_id=...&day=...&cursor=...`                                | 全屏宽月历；按项目／日查看授予与冲正，分页保留原过滤并去重；打开任务／悬赏遵守 can*open*\*                                      |

## 实验文档关联与公共交互

| V4 场景／安卓入口            | 行为与实际接口                                                                         | 权限与错误行为                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 项目实验文档、搜索与新建模板 | `GET/POST projects/{id}/documents/`                                                    | can_edit 控制新建；私人／项目访问与实验模板由后端实现；调用 onOpenDocument(projectId,pageId) 打开主协作编辑器 |
| 文档关联任务、解除关联       | `GET/POST/DELETE documents/{pageId}/tasks/`；`GET tasks/`                              | 可编辑且未冻结、未归档时显示关联管理；只允许同项目任务                                                        |
| 任务详情内实验文档           | 导出 TaskDocuments：`GET tasks/{issueId}/documents/`；同项目文档选择与新建、关联、解除 | 同一文档接口；主应用可将其嵌入任务详情                                                                        |
| 底部面板、错误与系统返回     | 公共 LabDialog：提交期间防重复点击、错误保留表单；Android mobileBack 关闭当前顶层面板  | 控制焦点、Esc 与 Tab；提交时保持面板；层叠面板一次只关闭最上层                                                |
| 移动端导出限制               | 界面没有 CSV/JSON/PNG/PDF/配置/文档导出按钮；所有请求经过 ApiClient                    | 服务端 Android 会话出口限制由后端任务实现；附件下载和正常数据查询保留                                         |

## 验证入口

- 单元行为：`apps/mobile/node_modules/.bin/vitest run src/features/lab/business.test.ts --root apps/mobile`。
- 浏览器 UI/API 边界：启动 `apps/mobile` Vite；`LAB_BROWSER_URL=http://127.0.0.1:4321/src/features/lab/tests/harness.html node apps/mobile/src/features/lab/tests/browser-contract.mjs`。涵盖实际表单请求体、排期版本、支付重试 key、字段修改、悬赏认领、图表明细、文档关联、VC 过滤分页、验收额度与重试、甘特确认、只读资金权限、系统返回及 360/412px 记录布局。
- 测试页面仅由浏览器验收使用，不被正式入口导入，不进入 APK 发布 bundle。
- 实机／模拟器与隔离真实后端的最终集成验收由 APK 发布任务执行；本页不将 fixture 测试视为真实后端或 Android 设备验收。

真实后端与实际 React/HTTP 证据见 [android-business-validation.md](./android-business-validation.md)。
