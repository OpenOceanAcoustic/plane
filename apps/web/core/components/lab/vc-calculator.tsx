/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import { LabAmountInput, LabDialog, LabField, labDecimalText, labDecimalUnits } from "@plane/ui";

export function VCCalculator({ onClose }: { onClose: () => void }) {
  const [pool, setPool] = useState("1000");
  const [total, setTotal] = useState("100");
  const [contribution, setContribution] = useState("10");
  const poolUnits = labDecimalUnits(pool);
  const totalUnits = labDecimalUnits(total);
  const contributionUnits = labDecimalUnits(contribution);
  const poolError = poolUnits === null ? "请输入有效的奖励池金额" : poolUnits < 0n ? "奖励池金额不能为负数" : "";
  const totalError = totalUnits === null ? "请输入有效的阶段总 VC" : totalUnits <= 0n ? "阶段总 VC 必须大于 0" : "";
  const contributionError =
    contributionUnits === null
      ? "请输入有效的本次 VC"
      : contributionUnits < 0n
        ? "本次 VC 不能为负数"
        : totalUnits !== null && contributionUnits > totalUnits
          ? "本次 VC 不能超过阶段总 VC"
          : "";
  const valid =
    !poolError &&
    !totalError &&
    !contributionError &&
    poolUnits !== null &&
    totalUnits !== null &&
    totalUnits > 0n &&
    contributionUnits !== null;
  const amount = valid ? labDecimalText((poolUnits * contributionUnits + totalUnits / 2n) / totalUnits) : null;
  const rate = valid ? labDecimalText((poolUnits * 10000n + totalUnits / 2n) / totalUnits, 4) : null;
  return (
    <LabDialog title="VC 计算示例" busy={false} onClose={onClose}>
      <p className="rounded-lg bg-layer-2 p-3 text-14">示例奖励 = VC 奖励池 × 本次 VC ÷ 阶段总 VC</p>
      <LabField label="示例 VC 奖励池（元）">
        <LabAmountInput
          aria-label="示例 VC 奖励池（元）"
          value={pool}
          onValueChange={setPool}
          error={poolError}
          required
        />
      </LabField>
      <LabField label="示例阶段总 VC">
        <LabAmountInput
          aria-label="示例阶段总 VC"
          value={total}
          onValueChange={setTotal}
          unit="VC"
          error={totalError}
          required
        />
      </LabField>
      <LabField label="示例本次 VC">
        <LabAmountInput
          aria-label="示例本次 VC"
          value={contribution}
          onValueChange={setContribution}
          unit="VC"
          error={contributionError}
          required
        />
      </LabField>
      {amount !== null && (
        <output aria-label="VC 示例计算结果" className="space-y-2 rounded-lg border border-subtle p-4 text-14">
          <div>示例奖励：¥{amount}</div>
          <div>示例比例：1 VC ≈ ¥{rate}</div>
        </output>
      )}
    </LabDialog>
  );
}
