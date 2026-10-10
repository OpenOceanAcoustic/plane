/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { Request, Response } from "express";
import { z } from "zod";
import { Controller, Post } from "@plane/decorators";
import { validOrigin, handleAuthentication } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { conversionPool } from "@/lib/conversion-pool";
import { redisManager } from "@/redis";

const convertDocumentSchema = z.object({
  description_html: z
    .string()
    .min(1)
    .max(100 * 1024)
    .refine((html) => html.trim().length > 0 && html.includes("<") && html.includes(">")),
  variant: z.enum(["rich", "document"]),
});
const quota = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`;

@Controller("/convert-document")
export class DocumentController {
  @Post("/")
  async convertDocument(req: Request, res: Response) {
    if (!validOrigin(req.headers.origin)) return res.status(403).json({ message: "Origin denied" });
    if (!req.headers.cookie) return res.status(401).json({ message: "Authentication required" });
    try {
      let identity;
      try {
        identity = await handleAuthentication({ cookie: req.headers.cookie });
      } catch {
        return res.status(401).json({ message: "Authentication required" });
      }
      const redis = redisManager.getClient();
      if (!redis) throw new AppError("Conversion quota unavailable", { statusCode: 503 });
      if (Number(await redis.eval(quota, 1, `live:conversion:${identity.user.id}`)) > 10) {
        res.setHeader("Retry-After", "60");
        return res.status(429).json({ message: "Conversion limit reached" });
      }
      const input = convertDocumentSchema.parse(req.body);
      return res.status(200).json(await conversionPool.submit(input));
    } catch (error) {
      const code = error instanceof z.ZodError ? 400 : error instanceof AppError ? (error.statusCode ?? 503) : 503;
      return res.status(code).json({ message: code === 400 ? "Invalid document" : "Document conversion unavailable" });
    }
  }
}
