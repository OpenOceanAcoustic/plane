# AI 项目参谋长部署走查清单

版本：v43（累积包，不含自动部署）

## 部署前

- [ ] 备份数据库
- [ ] 确认 `apps/api/.env` 有 `LLM_PROVIDER=deepseek`、`LLM_API_KEY`
- [ ] 确认 API 与 web 镜像可重启
- [ ] 记录当前提交，便于回滚

## 部署

```bash
curl -fL http://127.0.0.1:8099/deploy-v43.py -o /tmp/deploy-v43.py
sudo python3 /tmp/deploy-v43.py
```

安装器会检查、迁移、构建、重启 API、发布 web。

## 健康检查

```bash
curl -sS -H "Cookie: ..." \
  https://plane.oceanacoustic.top/api/workspaces/<slug>/lab/agent/health/
```

应返回：

```json
{"ok": true, "llm": true, "cache": true, "version": "v43"}
```

## 迁移

- [ ] `lab.0028_agent_thread_message`
- [ ] `lab.0029_agentreminder`
- [ ] `lab.0030_agentproposal`

## 角色走查

| 角色 | 检查 |
|---|---|
| 负责人 | 工作项发布、计划导入、负责人确认、财务概览 |
| 成员 | 工时、工作项、复盘、质量、团队、知识库、提案 |
| 技术/财务 | 质量、技术确认、工资/入账表单 |
| 无财务权限成员 | 财务接口返回无权限，不泄露金额 |

## 关键流程

- [ ] 工时：AI 只填表单，人工保存
- [ ] 工作项：草稿后点确认，项目规划出现任务
- [ ] 项目计划：草稿后点导入，阶段/子任务出现
- [ ] 执行简报：只读，不改任务
- [ ] 复盘：建议可变成任务或提交评审
- [ ] 质量：只读缺失/失效/待审
- [ ] 团队：只读负载，不自动调人
- [ ] 知识库：只返回可访问文档和原文链接
- [ ] 财务：预算/实际/异常，不自动付款
- [ ] 会议：任务逐条发布，不自动建
- [ ] 三结合评审：三方齐全才通过
- [ ] 提醒：点保存后，cron 运行后出现「项目提醒」会话

## 定时提醒

```cron
*/10 * * * * root /mnt/repo/kanban/plane/tools/lab/run-ai-reminders.sh
```

- [ ] 手动运行 `manage.py lab_ai_reminders`
- [ ] 确认生成「项目提醒 · 项目名」会话
- [ ] 确认没有自动付款/审批/改任务

## 回滚

- [ ] 记录安装器提交
- [ ] 代码回滚到部署前提交
- [ ] 迁移 0030/0029/0028 默认不回滚；确认数据保留
- [ ] 重启 API/web

## 已知边界

- 知识库是关键词检索，不是向量语义检索。
- 会议纪要会发送到 DeepSeek；不要粘贴密钥/身份证等敏感信息。
- 项目 Issue 直建接口不额外触发外部通知，通知仍由任务页面/后续集成负责。
- 提醒脚本需要 cron/systemd 才会定时运行。
- 所有金额、审批、权限、人员调整仍由人确认。
