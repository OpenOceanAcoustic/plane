# Android 业务验证证据

验证时间：2026-10-10。验证代码来自当前 Android 工作树。下面严格区分模拟 HTTP 响应、真实 HTTP 服务和 Android 设备验证。

| 类型                     | 结果        | 数据和运行环境                                                                                                                                                                                           | 实际设备                                     |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Lab 界面/HTTP 合同       | 16 场景通过 | `lab/tests/harness.tsx` 固定响应；真实 React 组件；覆盖 public 资金账户类型、精确金额重试键、排期版本、悬赏角色与验收额度、甘特先预览后提交、字段、文档关联、图表明细、贡献游标、深色、返回键、360/412px | 桌面 Chromium headless                       |
| Workspace 界面/HTTP 合同 | 10 场景通过 | `workspace/tests/harness.tsx` 固定响应；真实 React 组件；首页显隐排序、异步草稿属性与富文本、发布、视图筛选分页、活动分页、活跃周期、分析明细、链接保存、导航和 360px                                    | 桌面 Chromium headless                       |
| 真实后端业务闭环         | 24 场景通过 | `lab/tests/http-contract.py`；`127.0.0.1:18100` 隔离 HTTP、PostgreSQL、Redis；专用 `android-business-*` 工作区，四角色独立会话；无模拟请求                                                               | 宿主 Python HTTP 客户端；并非 Android 模拟器 |
| 真实 React / 真实后端    | 5 场景通过  | `lab/tests/real-browser.mjs` / `live-harness.tsx`；真实 ApiClient / HTTP；未拦截请求；排期创建刷新、公共资金精确余额、实验模板文档、草稿富文本和项目保存、360px 无运行时错误或横向溢出                   | 桌面 Chromium headless，360 × 800            |
| 公共业务边界 TDD         | 5 测试通过  | Lab 2、Workspace 3；先红再绿；排期版本/时区、贡献游标、草稿最新状态与关系/审计字段、视图筛选分页、周期边界                                                                                               | Vitest / Node                                |

## 24 项真实后端闭环

1. 负责人、成员验收人、访客、无项目成员资格的悬赏参与者四种真实 Android 会话；平台和导出能力符合会话。
2. Android 直接请求规划专用导出返回 403。
3. Android 直接请求财务 CSV 返回 403。
4. 访客请求团队排期返回 403。
5. 受限悬赏参与者请求原生项目任务列表返回 403。
6. 旧排期 revision 提交返回 409。
7. 个人事项与时间块实际创建、更新、查询同步，版本递增；测试事项随后清理。
8. 相同财务 request_key 返回同一笔操作。
9. 同一 request_key 改金额返回 400。
10. 财务金额按十进制保留精确 `10.25`。
11. 非公共资金管理员录入公共余额返回 403。
12. 资金追加冲正且重复冲正不重复变动余额。
13. 文档与任务绑定从双方接口均可读取。
14. 访客写文档关联被权限拒绝（不可读任务返回 404，避免泄漏任务存在性）。
15. 解除文档关联后立即同步。
16. 无项目草稿可以指定项目、负责人并发布，描述及关系保留。
17. 访客可编辑和删除自己的草稿。
18. 工作区保存视图实际创建、修改和删除。
19. 悬赏参与者未本人确认时，团队开工返回 400。
20. 悬赏参与者自验收返回 403。
21. 受限参与者完整申请、批准、本人确认、开工、交付、验收；重复验收后总 VC 仍为 `20.00`。
22. 受限参与者可通过专用悬赏资料端点读取材料。
23. 实际 Web 会话可以读取 Android 会话创建的任务。
24. Web 会话修改任务后，Android 会话立即读取到更新。

## 真实界面验证发现并修复的问题

- 项目标签实际路径为 `issue-labels/`；草稿原错误路径返回 404 并禁用保存。已按真实路由修正，固定响应同步纠正。
- 财务提交原将所有值 `public` 忽略，丢失公共账户类型。已只忽略 `project_id` 的公共资金哨兵值；新增固定合同回归，真实公共余额表单成功提交。
- 异步状态/周期选项替换会使未受控 select 丢失原 ID。草稿改为受控值，并在项目切换时清空旧属性；合同确认原值保留。
- 富文本组件 utility storage 缺失由根实现修复；真实草稿渲染和输入通过。
- 草稿后端项目更换与 creator 权限由后端实现修复；真实 HTTP 确认未选项目草稿后续指定项目可发布，访客可修改自己的草稿。

## 重跑入口

私有凭据和测试会话仅保存在 Git 外的测试目录，脚本不输出动态码、密钥或 Cookie。

```sh
apps/mobile/node_modules/.bin/vitest run apps/mobile/src/features/lab/business.test.ts apps/mobile/src/features/workspace/business.test.ts --config apps/mobile/vite.config.ts
LAB_BROWSER_URL=http://127.0.0.1:4321/src/features/lab/tests/harness.html node apps/mobile/src/features/lab/tests/browser-contract.mjs
WORKSPACE_BROWSER_URL=http://127.0.0.1:4321/src/features/workspace/tests/harness.html node apps/mobile/src/features/workspace/tests/browser-contract.mjs
ANDROID_PRIVATE_TEST_DIR=/path/to/private-test-fixtures python3 apps/mobile/src/features/lab/tests/http-contract.py
ANDROID_PRIVATE_TEST_DIR=/path/to/private-test-fixtures BUSINESS_LIVE_BROWSER_URL=http://127.0.0.1:4321/src/features/lab/tests/live-harness.html node apps/mobile/src/features/lab/tests/real-browser.mjs
```

实际 Android 模拟器、原生传输、安装、签名 APK 与附件传输结果由统一发布验收记录提供；本页不将桌面浏览器检查描述为模拟器验收。
