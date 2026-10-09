/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { Meta, StoryObj } from "@storybook/react";
import { LabColorPicker } from "./lab-color-picker";
const meta: Meta<typeof LabColorPicker> = {
  title: "Lab/Color panel",
  component: LabColorPicker,
  tags: ["autodocs"],
  args: { label: "类别颜色", initialValue: "#123abc" },
};
export default meta;
type Story = StoryObj<typeof LabColorPicker>;
export const Category: Story = {};
export const Schedule: Story = {
  args: { label: "排期颜色", automatic: true, initialValue: "", defaultColor: "#abcdef" },
};
