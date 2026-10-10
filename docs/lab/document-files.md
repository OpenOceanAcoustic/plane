# 项目与工作项文件文档

## 需求与实现

项目文档此前只能新建在线实验记录或关联已有 Page，无法提交本地文件。本次在实际原生 Pages 列表及工作项实验文档区域增加上传入口；TXT、MD 在线阅读，DOC、DOCX、XLS、XLSX 原文件下载，六种格式均可下载。

上传使用现有 react-dropzone；Markdown 使用 react-markdown 9.1.0，保留默认 URL 安全处理、不启用原始 HTML，图片不请求远端资源。升级旧版 8.0.7 是因为其 remark-rehype 10 与仓库已有 mdast-util-to-hast 13.2.1 强制版本不兼容；不降低已有强制版本。服务端使用 DRF MultipartParser、Django 文件验证及 FileResponse、既有 FileAsset/S3 存储，没有自建 Office 或 Markdown 解析器。

原始文件与 PageVersion 通过新增 DocumentFileVersion 关联；迁移 0013 只增加关联表，不修改已有 Page、账号、任务、VC 或文件。上传生成原生 Page、项目关联、版本和可选任务关联。在线正文继续使用原生编辑器；编辑正文不会替换上传原文件。文件失败时清理新增对象，不返回未完成文档。文件版本不参与原生正文版本的快速合并和旧版本裁剪；普通正文继续保留最多 20 版，原文件版本保留。

TXT、MD 预览按 UTF-8（含 BOM）解码，不能解码时显示明确错误，原文件仍可下载。允许的后缀和实例文件大小限制同时在前后端校验；Office 文件作为原始附件保存，不转换内容。

## 接口

所有路径前缀为 `/api/workspaces/{slug}/lab/`。

| 方法与路径                                                             | 行为                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| POST `projects/{project}/documents/upload/`                            | multipart `file`、`name`、`access`（0/1）、可选 `issue_id` |
| GET `projects/{project}/documents/{page}/`                             | 当前文档和可选文件元数据                                   |
| GET `projects/{project}/documents/{page}/versions/{version}/preview/`  | `{text, format, filename}`，仅 TXT／MD                     |
| GET `projects/{project}/documents/{page}/versions/{version}/download/` | 原始文件，附件响应                                         |
| GET `bounties/{bounty}/materials/{material}/preview/`                  | 当前授权下的明确共享版本                                   |
| GET `bounties/{bounty}/materials/{material}/download/`                 | 当前授权下的明确共享版本原文件                             |

文档列表、任务文档、共享材料返回可选 `file`：文件名、后缀、内容类型、大小、版本 ID、可预览标记及受控的相对读取路径。前端沿用 LabStore 的同源凭据和 CSRF，multipart 不手设边界；下载前检查 HTTP 错误，权限错误不会被保存成文件。

所有读取路径重新检查权限；项目参与者只能读取关联项目文档，私人文档仅本人读取，任务授权不赋予整个项目权限。原生和通用附件下载入口对新增文档文件使用同一权限校验，避免绕过受控端点。删除项目关联、撤销任务授权或移除共享材料后不能继续读取。响应禁止缓存并设置 nosniff。

## 验证

- LabStore 传输与规划回归：8 项通过；multipart 边界、CSRF 失败停止、原始字节下载及拒绝把错误响应保存为文件。
- 浏览器组件回归：25 项通过，含 19 项已有原生详情测试和 6 项文档测试；覆盖六种格式、实际 PagesListView 与 PageRoot 入口、私人草稿及失败重试、只读权限、TXT／MD 安全阅读、下载字节和嵌套弹窗。
- shared-state、UI 和 Web 类型检查通过；Web 检查使用本分支包源码。
- 改动前端文件严格 Lint 与格式检查通过，锁文件冻结安装通过。
- 后端定向、实验室完整回归、最终生产构建、双轴审查和备份发布结果在交付前追加。

后端契约使用 PostgreSQL、真实多部分请求及权限，另有真实 MinIO 上传、读取与失败补偿验证。浏览器使用真实组件与模拟接口；正式实例验收只读入口与已发布静态资源，不修改成员数据。
