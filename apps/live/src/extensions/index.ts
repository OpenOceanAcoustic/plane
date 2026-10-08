/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Database } from "./database";
import { ForceCloseHandler } from "./force-close-handler";
import { LabSessionGuard } from "./lab-session-guard";
import { Logger } from "./logger";
import { Redis } from "./redis";
import { TitleSyncExtension } from "./title-sync";

export const getExtensions = () => [
  new Logger(),
  new Database(),
  new Redis(),
  new LabSessionGuard(),
  new TitleSyncExtension(),
  new ForceCloseHandler(), // Must be after Redis to receive broadcasts
];
