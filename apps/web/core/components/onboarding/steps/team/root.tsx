/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Button } from "@plane/propel/button";
import { EOnboardingSteps } from "@plane/types";

type Props = {
  handleStepChange: (step: EOnboardingSteps, skipInvites?: boolean) => void;
};

export function InviteTeamStep({ handleStepChange }: Props) {
  return (
    <Button
      variant="primary"
      size="xl"
      className="w-full"
      onClick={() => handleStepChange(EOnboardingSteps.INVITE_MEMBERS)}
    >
      Continue
    </Button>
  );
}
