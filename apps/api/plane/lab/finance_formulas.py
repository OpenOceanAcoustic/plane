# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Bounded AST arithmetic: never eval, floats, imports, attributes or user code."""

import ast
import re
from decimal import Decimal, DecimalException, ROUND_HALF_UP, localcontext

from rest_framework.exceptions import ValidationError

BUILTINS = frozenset({"E", "B", "VC", "b", "r"})
MAX_AMOUNT = Decimal("999999999999.99")
TEMPLATES = [
    {
        "name": "基础 / 职责 / VC",
        "task_expression": "E * 0.2 * VC / B",
        "member_expression": "E * (0.5 * b + 0.3 * r + 0.2 * VC / B)",
    },
    {"name": "按 VC 分配", "task_expression": "E * VC / B", "member_expression": "E * VC / B"},
    {"name": "工时单价", "task_expression": "hours * rate", "member_expression": "hours * rate * performance"},
]


def decimal_value(value, label="数值"):
    try:
        value = Decimal(str(value))
        if not value.is_finite() or abs(value) > MAX_AMOUNT:
            raise ValueError()
        return value
    except (DecimalException, ValueError, TypeError):
        raise ValidationError(f"{label}必须是有限十进制数")


def money(value, positive=False):
    value = decimal_value(value, "金额")
    if value < 0 or (positive and value <= 0) or value != value.quantize(Decimal("0.01")):
        raise ValidationError("金额须非负（本操作要求正数时须大于零），最多两位小数")
    return value.quantize(Decimal("0.01"))


def parameter_definitions(values):
    if not isinstance(values, list) or len(values) > 32:
        raise ValidationError("公式参数须为数组，最多32项")
    result, names = [], set()
    for item in values:
        if not isinstance(item, dict):
            raise ValidationError("公式参数格式错误")
        name = str(item.get("name", ""))
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,39}", name) or name in BUILTINS | {"min", "max"} or name in names:
            raise ValidationError("参数名须唯一英文标识符，不能覆盖E/B/VC/b/r/min/max")
        if (
            item.get("scope") not in ("task", "member", "stage")
            or not str(item.get("unit", "")).strip()
            or not str(item.get("source", "")).strip()
        ):
            raise ValidationError("参数须注明task/member/stage作用范围、单位和来源")
        row = {
            "name": name,
            "scope": item["scope"],
            "unit": str(item["unit"])[:80],
            "source": str(item["source"])[:255],
        }
        if "default" in item and item["default"] not in (None, ""):
            row["default"] = str(decimal_value(item["default"], name))
        result.append(row)
        names.add(name)
    return result


def parse_expression(expression, names):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 1000:
        raise ValidationError("请填写最多1000字符的公式")
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, RecursionError, ValueError):
        raise ValidationError("公式语法无效")
    nodes = list(ast.walk(tree))
    if len(nodes) > 200:
        raise ValidationError("公式过于复杂")
    for node in nodes:
        if isinstance(node, ast.Name):
            if node.id not in names | {"min", "max"}:
                raise ValidationError(f"公式包含未定义参数：{node.id}")
        elif isinstance(node, ast.Constant):
            if type(node.value) not in (int, float):
                raise ValidationError("公式仅支持数字常量")
            decimal_value(ast.get_source_segment(expression, node), "常量")
        elif isinstance(node, ast.Call):
            if (
                not isinstance(node.func, ast.Name)
                or node.func.id not in ("min", "max")
                or node.keywords
                or not 1 <= len(node.args) <= 20
            ):
                raise ValidationError("只允许min/max函数和1至20个位置参数")
        elif not isinstance(
            node,
            (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.UAdd, ast.USub, ast.Load),
        ):
            raise ValidationError("公式仅支持四则运算、括号和min/max")
    return tree


def evaluate(expression, inputs, names=None):
    allowed = set(names if names is not None else inputs)
    tree = parse_expression(expression, allowed)

    def visit(node):
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant):
            return decimal_value(ast.get_source_segment(expression, node), "常量")
        if isinstance(node, ast.Name):
            if node.id not in inputs or inputs[node.id] in (None, ""):
                raise ValidationError(f"缺少公式参数：{node.id}")
            return decimal_value(inputs[node.id], node.id)
        if isinstance(node, ast.UnaryOp):
            return -visit(node.operand) if isinstance(node.op, ast.USub) else visit(node.operand)
        if isinstance(node, ast.Call):
            values = [visit(arg) for arg in node.args]
            return min(values) if node.func.id == "min" else max(values)
        left, right = visit(node.left), visit(node.right)
        if isinstance(node.op, ast.Add):
            result = left + right
        elif isinstance(node.op, ast.Sub):
            result = left - right
        elif isinstance(node.op, ast.Mult):
            result = left * right
        else:
            if not right:
                raise ValidationError("公式除数为零")
            result = left / right
        if not result.is_finite() or abs(result) > MAX_AMOUNT:
            raise ValidationError("公式中间结果超过金额范围")
        return result

    try:
        with localcontext() as context:
            context.prec = 38
            value = visit(tree)
            if not value.is_finite() or value < 0 or value > MAX_AMOUNT:
                raise ValidationError("预计奖励必须是非负有效金额")
            return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (DecimalException, RecursionError, OverflowError):
        raise ValidationError("公式计算失败，请检查参数和运算范围")
