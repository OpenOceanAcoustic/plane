# Lab 前端 Plane 化改版方案

设计图：[frontend-redesign.html](frontend-redesign.html)（单文件，直接双击用浏览器打开；支持明暗主题与窄屏）。

## 范围

共 14 个界面：设计系统总览、个人规划（综合 / 看板 / 周历）、团队排期（时间轴 / 人员分列）、任务表格、悬赏大厅、悬赏详情实体面板、资金与奖励、数据总览、我的项目与 VC、登录与邀请、移动端个人规划。

## 设计基线

- 使用 Plane 1.4.2 / Propel 的 token：`surface / layer / border / text / accent` 与 `shadow-raised-*`。
- 字体：Inter（界面）+ IBM Plex Mono（金额、编号、日期等数据）。
- 控件密度：27px 高、6px 圆角、13px 以内字号、2px 焦点环。
- 页面骨架：一个 LabShell + 共享 Scope + 可切换 View + 统一 Entity 面板 + 统一反馈层。

## 标签色

使用 Plane 的 8 个标签族（indigo、emerald、purple、orange、pink、yellow、crimson、grey）加品牌蓝，共 9 组。每组只用前景色定义，浅底与描边由 `color-mix` 从当前主题的表面生成，因此明暗模式共用同一套语义。

颜色按语义分配，不做装饰：

- 项目 / 类别：indigo、emerald、purple、orange、pink、yellow、grey。
- 状态：待做 grey、进行中 indigo、待验收 orange、完成 emerald、驳回 crimson。
- 优先级：紧急 crimson、高 orange、中 yellow、低 indigo、无 grey。
- 角色：负责人 purple、成员 blue、验收人 yellow、财务 emerald、管理员 crimson。
- 悬赏：开放 emerald、进行中 indigo、待验收 purple、返工 orange、不通过 crimson、取消 grey。
- 资金：到账 emerald、冻结 orange、可用 indigo、风险 crimson、未来 purple、历史 grey。

## 图表色

图表分类序列为 indigo / orange / pink / emerald / purple，已在亮色 `#fafafa` 与暗色 `#141515` 表面上校验相邻色的色盲区分度与对比度。状态色不复用为系列色；每张图都有图例、直接标注和明细入口。

## 落地顺序

1. 先落 `LabShell + LabScope`：项目 / 成员 / 日期 / 搜索进入 URL，所有板块共享。
2. 再落控件包：以 Propel 为基座，统一 Button、Tabs、Menu、Filter、Empty、Skeleton。
3. 再做 `LabEntityPanel`：卡片、日历事件、表格行、资金记录打开同一个实体面板。
4. 最后做视觉回归：Storybook + 亮/暗/窄屏截图 + CI 检查（禁止原生 select、旧 Button、硬编码颜色）。

本文件与 HTML 是设计提案，尚未改动现有 React 组件。
