/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from "@storybook/react";
import { LabDialog, LabField, LabSelect, labInputClass } from "./lab-form";
const meta: Meta<typeof LabDialog> = {
  title: "Lab/Planning form",
  component: LabDialog,
  tags: ["autodocs"],
  args: { title: "安排个人事项", busy: false, onClose: () => undefined, onSubmit: async () => undefined },
};
export default meta;
type Story = StoryObj<typeof LabDialog>;
export const Planning: Story = {
  args: {
    children: (
      <LabField label="事项名称">
        <input className={labInputClass} placeholder="科研、学习或带教" />
      </LabField>
    ),
  },
};
export const ConfirmDeletion: Story = {
  args: {
    title: "删除文件夹",
    submitLabel: "删除",
    destructive: true,
    children: <p className="text-13 text-secondary">事项和排期将保留，事项回到未分类。</p>,
  },
};
export const Conflict: Story = {
  args: {
    error: "排期已被修改，请刷新后重试。",
    children: (
      <LabField label="开始">
        <input type="datetime-local" className={labInputClass} />
      </LabField>
    ),
  },
};
export const PersonFilter: Story = {
  render: () => (
    <LabSelect
      label="筛选成员"
      value="all"
      options={[
        { value: "all", label: "全部成员" },
        { value: "member", label: "实验室成员" },
      ]}
      onValueChange={() => undefined}
    />
  ),
};
