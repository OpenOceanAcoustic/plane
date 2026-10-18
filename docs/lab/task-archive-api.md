# 工作项日期归档 API

前缀：`/api/workspaces/{slug}/lab/`。需要现有登录和 CSRF。复用 `Issue.archived_at`，无需数据库迁移。

- `POST tasks/archive-preview/`：`{cutoff:"YYYY-MM-DD",project_id?:UUID}`。选择北京时间截止当天及以前实际完成的工作项，返回 `{cutoff,total,preview_token,tasks:[{id,key,title,project,completed_date}]}`。仅当前有原生归档权限的项目成员／管理员可操作，未完成悬赏、未完成、取消、草稿、已删除和已归档工作项被排除。最多 1000 项；零项返回空 token。
- `POST tasks/archive/`：`{preview_token}`。token 绑定用户、工作区、具体记录版本、截止日期及批次，签名有效期 900 秒。事务内重新检查权限和版本，变更返回 409，整批不产生写入。返回 `{archived,replayed}`；重复批次重放结果，即便之前已恢复，也不会再次归档。只更新原生归档标记及更新人／时间，不更改完成时间、状态、描述或关联记录。
- `GET task-table/?archived=1`：查询当前权限可见的归档记录，保留 `project`、`format=csv`。支持 `completed_from/completed_to` 和 `archived_from/archived_to`，均为含端点的日期范围。完成时间按北京时间转换；未提供 `archived` 时保持当前工作项列表。新增行字段 `completed_at,completed_date,archived_at,revision,can_restore_issue`；归档行 `editable:false`。响应新增 `can_archive`。日期格式或起止范围无效返回 400。
- `POST tasks/{id}/restore/`：`{expected_revision}`，值为任务表返回的 `revision`。按当前成员权限鉴权，当前版本不符返回 409；成功 `{restored:true}`，已经恢复的重试返回 `{restored:false}`。不会将已完成状态重置为待做，不恢复已删除的工作项，也不改变子项、VC 和财务记录。

归档与恢复使用现有财务／WIP 事务锁，再锁定原生工作项。逐项写入 `IssueActivity.field=archived_at` 和 `Audit` 的 `issue.archived`／`issue.restored`，整批额外写入 `issue.archive_batch`。归档详情地址继续使用 `/{slug}/projects/{project}/archives/issues/{id}`。
