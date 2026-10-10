/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EOnboardingSteps } from "@plane/types";
import { useUser } from "@/hooks/store/user";
import { WorkspaceCreateStep } from "./";

type Props = {
  handleStepChange: (step: EOnboardingSteps, skipInvites?: boolean) => void;
};

export const WorkspaceSetupStep = observer(function WorkspaceSetupStep({ handleStepChange }: Props) {
  const { data: user } = useUser();
  return (
    <WorkspaceCreateStep user={user} onComplete={() => handleStepChange(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN)} />
  );
});
