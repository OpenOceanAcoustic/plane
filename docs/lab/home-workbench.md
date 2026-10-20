# 项目优先首页工作台

首页从通用组件列表改为以项目为最小单元的工作台，沿用「资金与奖励」页的命令栏、指标卡、双栏面板和快捷入口语言。

## 首屏

- 顶部命令栏：问候、日期时间、参与项目/进行中/想法数量，以及「新建工作项」「新建项目」「写想法」。
- 五项指标：参与项目、进行中工作项、已完成、我的想法、收藏项目。
- 「我的项目」项目卡片：项目图标、名称、编号、简介、工作项完成进度、成员头像。
- 每张卡片底部三个带图标和独立配色的动作：**规划**（靛蓝，打开项目规划）、**资金**（翠绿）、**质量**（粉色），右侧另有打开工作项的箭头。
- 右侧「项目进度」：整体完成度环、已完成/进行中数量、最近想法、八个常用入口（我的工作、全部项目、想法便签、资金与奖励、项目与质量、项目规划、悬赏大厅、数据总览）。
- 项目卡片优先显示收藏项目，最多显示 6 个；无项目时提供新建项目或浏览项目入口。
- 下方保留原有快速链接、最近访问和便签组件，改为双栏布局，便签占满整行。

## 文件

- `apps/web/core/components/home/home-workbench.tsx`（新增）
- `apps/web/core/components/home/home-workbench.css`（新增）
- `apps/web/core/components/home/root.tsx`
- `apps/web/core/components/home/home-dashboard-widgets.tsx`
- `apps/web/core/components/lab/calendar.tsx`（团队排期读取 `project_id` 查询参数）

## 验证

- `oxlint`：改动文件 0 警告 0 错误。
- `tsc --noEmit`：改动文件通过；仅剩仓库原有 `comments/context.tsx` 的 `lifecycle` 类型错误。
- `react-router build` 生产构建通过，产物包含「项目工作台」「lab-home-project-card」。
- 组件浏览器检查：1440px 下五项指标一行、项目卡片两列；390px 下指标两列、项目卡片单列，无横向溢出；三个命令按钮回调正常。
- 项目卡片底部「规划 / 资金 / 质量」三个动作使用不同图标与配色；「规划」链接带 `project_id`，打开项目规划页。

## 部署

在已部署资金/质量改版的仓库上运行同一个安装器即可增量应用：

```bash
curl -fsSL "https://gist.githubusercontent.com/Perry44001/6a5b0a64dfa303a048674ecce28b73a1/raw/deploy-home-workbench.py?$(date +%s)" \
  -o /tmp/deploy-home-workbench.py
sudo python3 /tmp/deploy-home-workbench.py
```

安装器会识别之前的改版提交，只覆盖本次受控文件，构建后追加一个本地提交。
