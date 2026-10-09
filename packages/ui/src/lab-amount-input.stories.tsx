/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { LabAmountInput } from "./lab-amount-input";
import { LabField } from "./lab-form";

const meta: Meta<typeof LabAmountInput> = {
  title: "Lab/Amount input",
  component: LabAmountInput,
  tags: ["autodocs"],
  args: { value: "0.31", limit: "0.30", unit: "元", "aria-label": "支付金额（元）", onValueChange: () => undefined },
};
export default meta;
type Story = StoryObj<typeof LabAmountInput>;
function EditableAmount(args: ComponentProps<typeof LabAmountInput>) {
  const [value, setValue] = useState(args.value);
  return (
    <LabField label={args["aria-label"] ?? "金额"}>
      <LabAmountInput {...args} value={value} onValueChange={setValue} />
    </LabField>
  );
}
export const ExceedingCashBalance: Story = { render: (args) => <EditableAmount {...args} /> };
export const BountyQuota: Story = {
  args: { value: "20", limit: "25", unit: "VC", "aria-label": "VC配额" },
  render: (args) => <EditableAmount {...args} />,
};
