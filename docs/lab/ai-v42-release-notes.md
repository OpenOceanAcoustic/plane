# AI 项目参谋长 v42 交付说明

## 范围

在不自动部署生产、所有写入人工确认的前提下，交付 AI 项目参谋长累积版本。

## 功能

| 功能 | 状态 | 写入 |
|---|---|---|
| 统一 AI 助手/会话持久化 | 完成 | 仅消息/草稿 |
| 工时草稿 | 完成 | 表单确认 |
| 项目工作项发布 | 完成 | 人工确认 |
| 项目拆解/阶段计划 | 完成 | 人工确认 |
| 每日/每周执行简报 | 完成 | 只读 |
| 迭代复盘 | 完成 | 建议可转任务/评审 |
| 质量反馈 | 完成 | 只读 |
| 团队负载建议 | 完成 | 只读 |
| 项目知识库检索 | 完成 | 只读 |
| 财务 Copilot | 完成 | 只读 |
| 会议纪要转任务 | 完成 | 逐条确认 |
| 三结合评审 | 完成 | 人工三方确认 |
| 定时提醒/脚本 | 完成 | 只读提醒 |
| 特殊卡片持久化 | 完成 | 仅会话 |
| AI 健康检查 | 完成 | 只读 |

## 接口

- `/lab/agent/health/`
- `/lab/agent/chat/`
- `/lab/agent/messages/`
- `/lab/agent/threads/`
- `/lab/agent/project-issue/`
- `/lab/agent/project-plan/`
- `/lab/agent/brief/`
- `/lab/agent/retro/`
- `/lab/agent/quality/`
- `/lab/agent/team/`
- `/lab/agent/knowledge/`
- `/lab/agent/finance/`
- `/lab/agent/meeting/`
- `/lab/agent/proposals/`
- `/lab/agent/reminders/`

## 迁移

- `0028_agent_thread_message`
- `0029_agentreminder`
- `0030_agentproposal`

## 安装

```bash
curl -fL http://127.0.0.1:8099/deploy-v42.py -o /tmp/deploy-v42.py
sudo python3 /tmp/deploy-v42.py
```

## 验证

- 后端编译通过
- 前端构建通过
- `oxlint` 0 警告
- `tsc` 仅仓库原有 comments 错误
- 迁移 0028/0029/0030 最小 Django 验证
- 静态路由审计脚本：`tools/lab/audit-ai-routes.py`

## 已知边界

- 知识库为关键词检索，不是向量语义检索。
- 会议纪要会发送到 DeepSeek，不应粘贴密钥/身份证等敏感信息。
- 定时提醒需要 cron/systemd 运行 `lab_ai_reminders`。
- 不做自动付款、审批、授权、调人、绩效评分。
- 生产真实账号、通知、DeepSeek 调用需要部署后走查。
