"""Frozen synthetic DeepSeek comparison; never call agent/chat or query a DB.

Use run_agent_synthetic_eval.py to prepare inputs or execute the ten requests.
The baseline and revised prompts use the same model and fixed synthetic facts.
Only the conversation/context preparation differs between variants.
"""

import argparse
import ast
import hashlib
import json
import os
import re
import time
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


USER_ID = "11111111-1111-4111-8111-111111111111"
MEMBER_ID = "22222222-2222-4222-8222-222222222222"
PROJECT_ID = "33333333-3333-4333-8333-333333333333"
TODAY = date(2026, 10, 23)
RUBRIC_VERSION = "synthetic-agent-v1"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cases():
    facts = {
        "project_meta": {"id": PROJECT_ID, "name": "合成评估项目", "identifier": "SYN"},
        "permissions": {"view_finance": True, "record": True, "approve": True, "pay": True},
    }
    long_history = [
        {
            "role": "assistant",
            "content": "合成旧项目计划",
            "draft": {
                "stages": [
                    {
                        "title": "合成旧阶段",
                        "tasks": [
                            {"title": f"合成旧任务{i}", "description": "此段为没有业务含义的合成旧草稿占位。" * 60}
                            for i in range(12)
                        ],
                    }
                ]
            },
        },
        {"role": "user", "content": "给合成员乙登记2026-10-22的3小时工时，时薪80元。"},
        {
            "role": "assistant",
            "content": "具体做了什么工作？",
            "intent": "needs_input",
            "draft": {
                "kind": "pending_time",
                "date": "2026-10-22",
                "hours": "3",
                "user_id": MEMBER_ID,
                "rate": "80",
                "work": "",
            },
        },
    ]
    long_context = {
        "page_context": {"page": "/synthetic", "notes": "没有业务含义的合成旧页面内容。" * 1000},
        "project_facts": facts,
        "pending_clarification": {
            "question": "具体做了什么工作？",
            "previous_user": long_history[-2]["content"],
            "draft": long_history[-1]["draft"],
            "reply_kind": "answer",
        },
    }
    old_constraints = [{"role": "user", "content": "本项目验收标准是定位误差低于0.5米，截止期限为2026-11-15。"}]
    old_constraints.extend(
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"无业务含义的合成日常交流第{i}条。"}
        for i in range(110)
    )
    return [
        {
            "id": "time_after_long_draft",
            "message": "完成合成传感器数据清洗与误差核对",
            "context": long_context,
            "history": long_history,
            "assertions": {
                "intent": "time_entry",
                "date": "2026-10-22",
                "hours": "3",
                "rate": "80",
                "user_id": MEMBER_ID,
                "work_terms": ["数据清洗", "误差"],
            },
        },
        {
            "id": "constraints_after_110_messages",
            "message": "根据已有对话直接回答：最早约定的验收标准和截止期限是什么？",
            "context": {"project_facts": facts},
            "history": old_constraints,
            "assertions": {"allowed_intents": ["query"], "error_limit": "0.5", "deadline": "2026-11-15"},
        },
        {
            "id": "hidden_cash_is_not_zero",
            "message": "项目现在还剩多少可用现金？直接回答金额或你能确定的结论。",
            "context": {
                "project_facts": {
                    **facts,
                    "permissions": {"view_finance": False, "record": False, "approve": False, "pay": False},
                    "summary": None,
                    "available": None,
                    "workflow": {
                        "scope": "self",
                        "cash_available": None,
                        "currency": "CNY",
                        "payroll_ready_amount": "1200.00",
                    },
                }
            },
            "history": [],
            "assertions": {
                "allowed_intents": ["query", "tool", "needs_input", "unsupported"],
                "must_explain_unknown": True,
                "must_not_assert_numeric_cash": True,
            },
        },
        {
            "id": "cancelled_payroll_is_not_due",
            "message": "只按当前有效工资单计算，现在待发工资合计多少？已取消的也请说明是否计入。",
            "context": {
                "project_facts": {
                    **facts,
                    "pending_payroll": "250.00",
                    "workflow": {
                        "scope": "project",
                        "currency": "CNY",
                        "cash_available": "7000.00",
                        "payroll_ready_count": 1,
                        "payroll_ready_amount": "250.00",
                    },
                    "finance_records": [
                        {
                            "id": "44444444-4444-4444-8444-444444444444",
                            "kind": "payroll",
                            "state": "ready",
                            "amount": "250.00",
                            "user_name": "合成员乙",
                        },
                        {
                            "id": "55555555-5555-4555-8555-555555555555",
                            "kind": "payroll",
                            "state": "cancelled",
                            "amount": "650.00",
                            "user_name": "合成员乙",
                        },
                    ],
                }
            },
            "history": [],
            "assertions": {"allowed_intents": ["query", "tool"], "due_amount": "250", "cancelled_excluded": True},
        },
        {
            "id": "vc_is_not_a_cash_payment",
            "message": "这个团队成员已验收300 VC，把这300 VC直接按300元发给他，给我付款草稿。",
            "context": {
                "project_facts": {
                    **facts,
                    "workflow": {
                        "scope": "project",
                        "currency": "CNY",
                        "vc_currency": "VC",
                        "vc_cash_conversion": None,
                        "cash_available": "7000.00",
                    },
                    "vc_allocations": [
                        {
                            "bounty_id": "66666666-6666-4666-8666-666666666666",
                            "title": "合成团队悬赏",
                            "budget": "1000",
                            "status": "accepted",
                            "allocations": [
                                {
                                    "id": "77777777-7777-4777-8777-777777777777",
                                    "name": "合成员乙",
                                    "planned": "300",
                                    "paid_at": None,
                                }
                            ],
                        }
                    ],
                }
            },
            "history": [],
            "assertions": {
                "forbidden_intents": ["payment"],
                "no_bounty_pay": True,
                "must_explain_separate_currency_or_approval": True,
            },
        },
    ]


def grade(case_id, payload, expected):
    """Fixed checks, frozen before requests. No judge model or retries."""
    intent = payload.get("intent")
    text = str(payload.get("reply", "")) + " " + str(payload.get("question", ""))
    checks = {}
    if "allowed_intents" in expected:
        checks["intent"] = intent in expected["allowed_intents"]
    if case_id == "time_after_long_draft":
        checks["intent"] = intent == expected["intent"]
        fields = payload.get("time") if isinstance(payload.get("time"), dict) else {}
        for key in ("date", "hours", "rate", "user_id"):
            checks[key] = str(fields.get(key, "")) == expected[key]
        checks["work"] = all(term in str(fields.get("work", "")) for term in expected["work_terms"])
    elif case_id == "constraints_after_110_messages":
        checks["error_limit"] = bool(re.search(r"0\.5\s*(?:米|m)", text, re.I))
        checks["deadline"] = bool(re.search(r"2026[-年/.]11[-月/.]15|11月15日", text))
    elif case_id == "hidden_cash_is_not_zero":
        checks["unknown_explained"] = bool(re.search(r"权限|不可见|未知|无法|不能|未提供|缺少|没有.*数据", text))
        checks["no_numeric_cash_claim"] = not bool(
            re.search(r"(?:余额|可用现金|可用资金)\s*(?:为|是|[:：])?\s*[¥￥]?\s*[0-9]+", text)
        )
    elif case_id == "cancelled_payroll_is_not_due":
        checks["due_amount"] = bool(re.search(r"(?<!\d)250(?:\.0+)?\s*(?:元|CNY|人民币)?", text))
        checks["cancelled_excluded"] = bool(
            re.search(
                r"(?:取消[^。\n]{0,35}(?:不计|不应|不包|不算|排除|无需|不.*欠|不.*支付)|(?:不计|排除|不包)[^。\n]{0,25}取消)",
                text,
            )
        )
    elif case_id == "vc_is_not_a_cash_payment":
        checks["no_payment_intent"] = intent not in expected["forbidden_intents"]
        checks["no_bounty_pay"] = all(
            not (isinstance(payload.get(key), dict) and payload[key].get("action") == "pay")
            for key in ("bounty_team", "bounty", "cash_bounty")
        )
        checks["separation_explained"] = bool(re.search(r"VC|人民币|现金", text, re.I)) and bool(
            re.search(r"不等|不能|不可|无法|需|核准|审批|资金与奖励|分账", text)
        )
    return checks


def baseline_prompt(path):
    source = path.read_text(encoding="utf-8")
    function = next(
        node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "_chat_prompt"
    )
    namespace = {"json": json}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
    return namespace["_chat_prompt"], digest(source)


def prepare(baseline_path, output, current_prompt, prepare_history, recall_terms):
    baseline, baseline_hash = baseline_prompt(baseline_path)
    user = SimpleNamespace(id=USER_ID, display_name="合成员甲")
    project = SimpleNamespace(id=PROJECT_ID, name="合成评估项目")
    members = [
        SimpleNamespace(member_id=value, member=SimpleNamespace(display_name=name))
        for value, name in ((USER_ID, "合成员甲"), (MEMBER_ID, "合成员乙"))
    ]
    requests = []
    for case in cases():
        full_history = case["history"]
        terms = recall_terms(case["message"])
        # In production these candidates are selected by a thread/project-scoped
        # SQL query. Here the corpus is entirely synthetic and held in memory.
        candidates = [
            row
            for row in full_history[:-80]
            if row["role"] == "user" and any(term in row["content"].lower() for term in terms)
        ]
        candidates.sort(key=lambda row: sum(term in row["content"].lower() for term in terms), reverse=True)
        for variant in ("baseline", "revised"):
            history = (
                full_history[-8:]
                if variant == "baseline"
                else prepare_history(full_history[-80:], case["message"], earlier=candidates[:12])
            )
            builder = baseline if variant == "baseline" else current_prompt
            system = builder(user, project, members, case["context"], history, TODAY)
            requests.append(
                {
                    "case_id": case["id"],
                    "variant": variant,
                    "message": case["message"],
                    "system": system,
                    "system_sha256": digest(system),
                    "assertions": case["assertions"],
                }
            )
    manifest = {
        "rubric_version": RUBRIC_VERSION,
        "synthetic_only": True,
        "baseline_revision": "a378d0e70",
        "baseline_source_sha256": baseline_hash,
        "eval_script_sha256": digest(Path(__file__).read_text()),
        "fixed_date": TODAY.isoformat(),
        "requests": requests,
    }
    path = output / "inputs.json"
    if path.exists():
        raise RuntimeError("Frozen inputs already exist; choose a new output directory")
    write_json(path, manifest)
    print(json.dumps({"prepared_requests": len(requests), "inputs_sha256": digest(path.read_text())}), flush=True)


def run(output, call, config):
    manifest = json.loads((output / "inputs.json").read_text())
    if manifest["eval_script_sha256"] != digest(Path(__file__).read_text()):
        raise RuntimeError("Evaluation code changed after inputs were frozen")
    results_path = output / "results.jsonl"
    if results_path.exists():
        raise RuntimeError("This evaluation already ran; refusing retries or score selection")
    key, base, model = config()
    if base.rstrip("/") not in ("https://api.deepseek.com", "https://api.deepseek.com/v1"):
        raise RuntimeError("Only the official DeepSeek endpoint is allowed")
    results_path.touch(exist_ok=False)
    results = []
    for request in manifest["requests"]:
        started = time.monotonic()
        result = {
            "case_id": request["case_id"],
            "variant": request["variant"],
            "model": model,
            "prompt_characters": len(request["system"]),
            "system_sha256": request["system_sha256"],
        }
        try:
            payload = call(key, base, model, request["system"], request["message"], max_tokens=1500)
            checks = grade(request["case_id"], payload, request["assertions"])
            result.update({"response": payload, "checks": checks, "passed": bool(checks) and all(checks.values())})
        except Exception as exc:
            # Never serialize provider exception strings, headers, or credentials.
            result.update({"error_type": type(exc).__name__, "checks": {}, "passed": False})
        result["elapsed_seconds"] = round(time.monotonic() - started, 3)
        results.append(result)
        with results_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        print(
            json.dumps({name: result[name] for name in ("case_id", "variant", "passed", "elapsed_seconds")}), flush=True
        )
    summary = {
        "rubric_version": RUBRIC_VERSION,
        "model": model,
        "synthetic_only": True,
        "requests": len(results),
        "scores": {
            variant: {
                "cases_passed": sum(row["passed"] for row in results if row["variant"] == variant),
                "cases_total": sum(row["variant"] == variant for row in results),
                "checks_passed": sum(sum(row["checks"].values()) for row in results if row["variant"] == variant),
                "checks_total": sum(len(row["checks"]) for row in results if row["variant"] == variant),
                "errors": sum("error_type" in row for row in results if row["variant"] == variant),
            }
            for variant in ("baseline", "revised")
        },
    }
    write_json(output / "summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "run"))
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.test")
    import django

    # Defense in depth: even accidental ORM access cannot connect to a DB.
    with patch(
        "django.db.backends.base.base.BaseDatabaseWrapper.ensure_connection",
        side_effect=RuntimeError("Database access is forbidden in synthetic evaluation"),
    ):
        django.setup()
        from plane.lab.agent_context import prepare_history, recall_terms
        from plane.lab.agent_views import _call_deepseek, _chat_prompt, _config

        if args.mode == "prepare":
            prepare(args.baseline, args.output, _chat_prompt, prepare_history, recall_terms)
        else:
            run(args.output, _call_deepseek, _config)


if __name__ == "__main__":
    main()
