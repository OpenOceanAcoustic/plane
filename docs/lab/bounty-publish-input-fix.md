# 工作项悬赏表单点击修复

## 需求与范围

在项目工作项的原生右侧总览中发布悬赏时，点击 VC 配额、任务资料、交付要求、验收标准和验收人，应保留总览与当前表单内容。取消只关闭发布弹窗，之后点击总览外部仍可关闭总览。发布继续使用原工作项和现有权限、预算校验。

## 原因与修复

`LabDialog` 通过 Radix Portal 将表单放到工作项总览的 DOM 边界之外。原生总览的 `usePeekOverviewOutsideClickDetector` 监听 document mousedown，将表单点击视为外部点击，清除当前工作项并卸载表单。

弹窗内容和遮罩现在使用 Plane 现有的 `data-prevent-outside-click` 边界标记。该标记保护弹窗交互，不禁用原生总览的外部点击检测。

## 验证

浏览器测试保留真实 `IssueView`、`LabIssueDetails`、`LabBountyPublish`、`LabDialog` 和外部点击 Hook。只替换原生编辑器、数据服务等无关依赖；显式从本 checkout 的 UI 源码构建，避免读取另一分支的共享包产物。

```bash
node node_modules/@playwright/test/cli.js test \
  --config tools/lab/e2e/playwright.config.ts \
  tools/lab/e2e/issue-details-components.spec.ts \
  --grep 'clicking bounty form fields|cancelling bounty publication'
```

修复前，两次鼠标点击复现均调用了原生总览关闭回调；预期 0 次，实际 1 次。修复后覆盖右侧和展开总览中的输入、选择、草稿保留、取消及后续正常外部关闭。既有预算不足、发布失败重试、成功升级、权限撤销和工作项删除场景继续保留。

原生详情完整回归 18 项通过；追加展开模式后，3 项鼠标交互场景通过。UI 与 Web 类型、Lint、格式及 Web 生产构建通过；规范审查与需求审查均无发现。生产构建的 44 个 HTML 资源引用完整，新资源包含弹窗两处边界标记，未包含 PR #4 的页面或接口。

## 内网更新

从已发布基线 `c3c8d035` 创建独立修复分支，在独立 checkout 构建 Web。正式静态目录先备份，发布时保留旧哈希资源、先同步完整资源，最后同目录原子替换首页；不替换代理挂载目录。个人项目与 VC 新页面仍由 PR #4 单独交付。
