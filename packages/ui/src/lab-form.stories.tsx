/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import type { Meta, StoryObj } from "@storybook/react";
import { LabDialog, LabField, labInputClass } from "./lab-form";
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
