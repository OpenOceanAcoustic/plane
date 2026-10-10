# Android 工作区功能覆盖

此表记录 `apps/mobile/src/features/workspace/index.tsx` 的真实 HTTP/界面边界。功能数据由部署后端读取，测试固定响应仅位于 `tests/harness.tsx`，不进入应用入口。

| 入口 / V4 屏幕                               | 实际读取                                                                                                                                                                                                             | 表单和实际动作                                                                                                   | 权限与状态                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `widgets` / 首页组件设置底部面板             | `GET /api/workspaces/{slug}/home-preferences/`                                                                                                                                                                       | 显隐、上移、下移、自定义顺序：`PATCH .../home-preferences/{key}/`，字段 `is_enabled` / `sort_order`              | 当前账号的工作区偏好；提交中禁用按钮；失败保留原状态并显示错误；每次成功重新读取                                             |
| `drafts` / 我的草稿列表、编辑与发布面板      | `GET .../draft-issues/`，`GET .../draft-issues/{id}/`；项目、状态、成员、标签、周期、模块、父任务搜索                                                                                                                | `POST .../draft-issues/`，`PATCH/DELETE .../draft-issues/{id}/`；`POST .../draft-to-issue/{id}/`                 | 仅当前用户草稿；工作区角色 5+ 创建，15+ 发布；发布前读取最新草稿并提交任务字段；项目为空禁止发布；异步属性加载完成前禁止保存 |
| `activity` / 我的活动                        | `GET .../user-activity/{sessionUserId}/?project=&cursor=&per_page=30`                                                                                                                                                | 项目筛选、上一页/下一页；打开真实任务详情                                                                        | 服务端按当前用户项目访问权过滤；分页保留筛选；无导出操作                                                                     |
| `workspace-views` / 工作区视图、纵向任务详情 | `GET .../views/`、`GET .../views/{id}/`、`GET .../issues/?project=&state_group=&priority=&assignees=&cursor=`                                                                                                        | `POST .../views/`、`PATCH/DELETE .../views/{id}/`；项目/状态组/优先级/负责人多选；未编辑的原有筛选保留           | 角色 5+ 创建；仅拥有者编辑且非锁定；管理员或拥有者删除；结果由服务端项目/访客权限过滤                                        |
| `active-cycles` / 活跃周期、完成进度与任务   | `GET .../cycles/`；`GET .../projects/{project}/cycles/{id}/cycle-issues/`                                                                                                                                            | 当前活跃周期筛选，任务分页，打开任务，跳转项目周期管理                                                           | 周期只包含服务端可访问项目；周期任务接口为角色 15+；访客显示周期进度；当前时间落在周期区间，或服务器状态为 active/current    |
| `workspace-analytics` / 工作区分析、任务分析 | `GET .../advance-analytics/?tab=overview/work-items`；`GET .../advance-analytics-stats/?type=work-items`；`GET .../advance-analytics-charts/?type=projects/work-items/custom-work-items`；授权明细 `GET .../issues/` | 项目、日期范围、统计维度、分组；总计、内容分布、月度趋势、自定义分布、项目纵向明细；图表选择按维度和日期读取任务 | 角色 15+；图表数据来自服务器；明细保留 `created_at` 及维度筛选；项目累计明细依服务器累计返回值明确标注；无 CSV/图片/配置导出 |
| `commands` / 快捷操作、链接编辑面板          | `GET .../quick-links/`                                                                                                                                                                                               | `POST .../quick-links/`，`PATCH/DELETE .../quick-links/{id}/`；项目/草稿/排期/悬赏/文档/通知/搜索导航            | 链接归当前账号；仅完整 HTTP(S) 链接；后端验证地址；导航回调进入实际应用页面                                                  |

## 当前后端兼容性

- `/home-preferences/` 当前实际组件键为 `quick_links`、`recents`、`my_stickies`；序列化器仅接受 `is_enabled`、`sort_order`。旧 dashboard 类型定义的八类统计组件不属于此接口，没有呈现无法保存的筛选选项。
- Web `CycleService` 内的 `/active-cycles/` 在当前 API 路由中不存在。移动端使用已实现的 `/cycles/` 并筛选当前活跃记录。
- 工作区视图任务接口为 `/issues/`；保存视图的 `filters` 转换成真实 query。没有构造不存在的 `/views/{id}/issues/`。
- 视图 `access` / `is_locked` 为后端只读字段，移动端显示状态，未提供写入会被忽略的操作。
- 任务分析当前后端按任务数量聚合，支持维度和分组；未显示后端未实现的其他计量方式。

## 验证

公共 HTTP 边界测试（测试先于实现，并确认缺少业务模块时红）：

```sh
apps/mobile/node_modules/.bin/vitest run apps/mobile/src/features/workspace/business.test.ts --config apps/mobile/vite.config.ts
```

覆盖：草稿发布先读取最新状态且不透传审计字段、视图筛选和游标共存、周期日期边界。

真实组件/固定 HTTP 响应的浏览器合同测试：

```sh
WORKSPACE_BROWSER_URL=http://127.0.0.1:4321/src/features/workspace/tests/harness.html node apps/mobile/src/features/workspace/tests/browser-contract.mjs
```

覆盖：首页显隐/顺序持久化、草稿完整编辑与发布、视图筛选和翻页、活动筛选和翻页、活跃周期任务导航、分析维度和日期明细、链接新增与命令导航、360px 屏宽。

这些是代码与界面合同验证，不能代替隔离真实后端或 Android 模拟器业务验收；后者由统一验收记录列明。

真实后端（包括草稿项目分配、访客自己草稿和视图 CRUD）及实际 React/HTTP 证据见 [android-business-validation.md](./android-business-validation.md)。
