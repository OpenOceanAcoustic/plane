/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Meta, StoryObj } from "@storybook/react";
import { LabAuth } from "./lab-auth";

const meta: Meta<typeof LabAuth> = {
  title: "Lab/Authenticator",
  component: LabAuth,
  tags: ["autodocs"],
  args: { onSuccess: () => undefined, apiBase: "" },
};
export default meta;
type Story = StoryObj<typeof LabAuth>;
export const MemberLogin: Story = {};
export const AdministratorLogin: Story = { args: { admin: true } };
