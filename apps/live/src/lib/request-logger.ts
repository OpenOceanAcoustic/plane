/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { RequestHandler } from "express";
import { logger } from "@plane/logger";

/** Request credentials, arbitrary URLs, query strings and bodies stay out of logs. */
export const requestLogger: RequestHandler = (request, response, next) => {
  response.once("finish", () => {
    logger.info("LIVE_HTTP_REQUEST", {
      method: request.method,
      route: typeof request.route?.path === "string" ? request.route.path : "unmatched",
      status_code: response.statusCode,
    });
  });
  next();
};
