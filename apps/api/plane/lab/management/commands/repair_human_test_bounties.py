# Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only
"""Replace unclaimed legacy placeholders with manual UI test instructions."""

import json
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import Project, ProjectMember, User
from plane.lab.auth import audit
from plane.lab.cash_bounties import bounty_description
from plane.lab.models import CashBounty


CASES = {
    "UI状态测试": [
        (
            "人工测试：悬赏列表与状态提示",
            "左侧「现金悬赏」；检查列表与状态标签。",
            "1. 打开「现金悬赏」，点击「可接单」。预期：卡片状态是「待接单」，本人有权限时显示「我要接」。\n"
            "2. 点击「我的」。预期：能找到自己领取的本次任务，并显示「进行中」和「提交成果」。\n"
            "3. 点击「全部」，查看现有其他状态的任务。预期：状态与操作相符，例如「待验收」不能再次接单，「已登记付款」不能再次付款。\n"
            "4. 没有遇到的状态记为未覆盖；不要为了测试创建、取消或付款。",
        )
    ],
    "卡片布局测试": [
        (
            "人工测试：悬赏卡片与文字布局",
            "左侧「现金悬赏」→「全部」；检查当前浏览器中的卡片文字。",
            "1. 阅读本任务卡片的标题、赏金、任务说明和验收标准。预期：文字完整可读，不互相遮挡。\n"
            "2. 向下滚动查看按钮。预期：按钮名称可读，正文不会盖住按钮。\n"
            "3. 在当前设备允许时缩窄浏览器窗口，再检查长说明是否换行、有无横向溢出；无法调整窗口时注明未覆盖。\n"
            "4. 描述异常出现在哪张卡片、哪段文字及大致窗口宽度；不需要修改页面。",
        )
    ],
    "自动点击回归": [
        (
            "人工测试：从首页打开悬赏",
            "左侧「首页」→右侧「下一步」中的现金悬赏；核对跳转目标。",
            "1. 回到「首页」，在「下一步」寻找一条现金悬赏，记下标题和赏金。\n"
            "2. 点击该条目。预期：进入「现金悬赏」，显示同一标题、赏金和任务说明。\n"
            "3. 若有「查看全部现金悬赏」，点击它。预期：恢复显示现金悬赏列表。\n"
            "4. 首页没有推荐、条目不存在或无权查看时，按实际情况反馈；不要把未能执行写成通过。",
        ),
        (
            "人工测试：悬赏筛选切换",
            "左侧「现金悬赏」；检查四个筛选按钮。",
            "1. 依次点击「可接单」「我的」「待审批」「全部」，分别记录选中按钮和列表结果。\n"
            "2. 预期：「可接单」显示待接单任务，「我的」显示自己领取或发布的任务，「待审批」显示自己有权审批的提议，「全部」显示可查看记录。\n"
            "3. 没有匹配任务时应有空列表提示；有任务时应显示对应卡片，且切换后高亮按钮与列表相符。\n"
            "4. 不点击领取、批准、驳回或付款按钮。",
        ),
        (
            "人工测试：发布表单与测试模板",
            "左侧「现金悬赏」→右上角「提议现金悬赏」或「发布现金悬赏」；只检查表单。",
            "1. 打开发布或提议表单。预期：有任务名称、入口与范围、操作步骤、固定赏金、交付要求和验收标准。\n"
            "2. 不填内容时检查最终提交按钮。预期：不能提交空任务。\n"
            "3. 点击「填入人工测试模板」。预期：填入明确的点击步骤和文字反馈要求，赏金仍由发布人填写；不要求开发页面或上传截图。\n"
            "4. 阅读内容后关闭弹窗。不要点击「发布」或「提交审批」，不要新建测试悬赏。",
        ),
        (
            "人工测试：文字反馈提交",
            "领取本任务后，在「现金悬赏」→「我的」找到本任务，点击「提交成果」。",
            "1. 将「反馈方式」改为「测试反馈」。预期：显示测试结论、已测步骤与实际结果、问题或建议。\n"
            "2. 选择「不通过」并保留问题字段为空，检查字段是否标为必填；不要提交虚构问题。\n"
            "3. 按本次真实结果选择「通过」「不通过」或「无法测试」，填写实际操作记录；不通过或无法测试时写清问题或原因。\n"
            "4. 点击「提交验收」。预期：状态变为「待验收」，卡片展示刚填写的文字反馈；如提交失败，记录提示并保留输入。",
        ),
        (
            "人工测试：验收与付款记录显示",
            "左侧「现金悬赏」→「全部」；只查看自己有权查看的历史记录。",
            "1. 查看已有「待验收」「待付款」或「已登记付款」记录；不存在的状态注明未覆盖。\n"
            "2. 有验收权限时应显示「验收成果」，有付款权限且处于待付款时应显示「登记付款」；普通接单人不能执行这些操作。\n"
            "3. 查看「已登记付款」卡片。预期：已登记付款状态明确，不再提供接单或再次付款按钮；有登记时间时能够读到。\n"
            "4. 不点击验收、付款或取消，不制造支付；仅记录实际看到的状态和按钮。",
        ),
    ],
}


def revised_content(row, case):
    title, target, steps = case
    deliverable = (
        "完成后在本任务点击「提交成果」，选择「测试反馈」，用文字提交结论、已测步骤与实际结果。"
        "发现问题时写明复现步骤、预期结果和实际结果；无法执行的步骤说明原因。"
        "无需开发页面、编写代码或上传截图。"
    )
    criteria = (
        "按上述步骤实际测试并提供可核对的文字记录；发现产品缺陷同样属于有效交付，"
        "不会因为测试结论为「不通过」就否定测试工作。未覆盖项须注明原因，由验收人核对。"
        "仅填写「1」「测完了」或没有实际操作记录不符合要求；修复后的复测可另发任务。"
    )
    return {
        "title": title,
        "deliverable": bounty_description(
            {
                "target": f"/{row.workspace.slug}/lab/cash；{target}",
                "steps": steps,
                "deliverable": deliverable,
                "criteria": criteria,
            }
        ),
        "criteria": criteria,
    }


class Command(BaseCommand):
    help = "Preview or repair only a publisher's open, unclaimed legacy UI test placeholders."

    def add_arguments(self, parser):
        parser.add_argument("--project", type=UUID, required=True)
        parser.add_argument("--actor", type=UUID, required=True)
        parser.add_argument("--expected-count", type=int)
        parser.add_argument("--apply", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        project = Project.objects.select_related("workspace").filter(id=options["project"]).first()
        actor = User.objects.filter(id=options["actor"], is_active=True).first()
        if (
            not project
            or not actor
            or not ProjectMember.objects.filter(project=project, member=actor, is_active=True, role__gte=15).exists()
        ):
            raise CommandError("Actor must be an active member of the specified project")
        candidates = (
            CashBounty.objects.select_related("workspace")
            .filter(
                project=project,
                publisher=actor,
                status="open",
                claimed_by__isnull=True,
                claimed_at__isnull=True,
                submitted_at__isnull=True,
                accepted_at__isnull=True,
                paid_at__isnull=True,
                payment_operation__isnull=True,
                evidence="",
                title__in=CASES,
                deliverable__in=("一个可用页面", "交付一个可用页面"),
            )
            .order_by("created_at", "id")
        )
        rows = list(candidates.select_for_update(of=("self",)) if options["apply"] else candidates)
        if options["expected_count"] is not None and len(rows) != options["expected_count"]:
            raise CommandError(
                f"Expected {options['expected_count']} unchanged placeholders, found {len(rows)}; no changes made"
            )
        used = {title: 0 for title in CASES}
        plan = []
        for row in rows:
            cases = CASES[row.title]
            index = used[row.title]
            if index >= len(cases):
                raise CommandError("Unexpected duplicate placeholders; preview and repair the scope before applying")
            used[row.title] += 1
            before = {key: getattr(row, key) for key in ("title", "deliverable", "criteria")}
            after = revised_content(row, cases[index])
            plan.append({"id": str(row.id), "amount": str(row.amount), "before": before, "after": after})
            if options["apply"]:
                for key, value in after.items():
                    setattr(row, key, value)
                row.save(update_fields=list(after))
                audit("cash_bounty.instructions_repaired", row, actor, project.workspace, before=before, after=after)
        self.stdout.write(
            json.dumps({"applied": options["apply"], "count": len(plan), "changes": plan}, ensure_ascii=False, indent=2)
        )
