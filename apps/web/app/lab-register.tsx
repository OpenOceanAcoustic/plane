/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { LabLogin } from "@/components/lab/login";
import { useParams } from "react-router";
export default function LabRegisterPage() {
  const { token } = useParams();
  return <LabLogin key={token} register invitationToken={token} />;
}
