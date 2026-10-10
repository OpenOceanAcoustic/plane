/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { AppError } from "@/lib/errors";
import { UserService } from "@/services/user.service";

/** Capabilities come from the persisted backend session, never client headers. */
export const authorizeDataExport = async (cookie: string): Promise<void> => {
  const session = await new UserService().currentSession(cookie);
  if (session.capabilities?.data_export !== true) {
    throw new AppError("手机端不支持数据导出", { statusCode: 403, code: "mobile_export_disabled" });
  }
};
