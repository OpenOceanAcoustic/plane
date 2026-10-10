/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { onAuthenticatePayload } from "@hocuspocus/server";
import { env } from "@/env";
import { collaborationLimits } from "./collaboration-limits";
import { AppError } from "@/lib/errors";
import { consumeMobileTicket } from "./mobile-auth";
import { CollaborationService } from "@/services/collaboration.service";
import type { CollaborationAccess } from "@/services/collaboration.service";
import { UserService } from "@/services/user.service";
import type { HocusPocusServerContext } from "@/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const allowedOrigin = () => env.PUBLIC_ORIGIN || env.WEB_BASE_URL;
export const validOrigin = (origin: unknown): boolean =>
  typeof origin === "string" && !!allowedOrigin() && origin === allowedOrigin();
// Capacitor's bundled UI has a fixed origin. It may authenticate only with a
// one-use server ticket; this origin is never trusted for cookie-based HTTP.
export const validMobileOrigin = (origin: unknown): boolean => origin === "https://localhost";
export const validSocketOrigin = (origin: unknown): boolean => validOrigin(origin) || validMobileOrigin(origin);

export async function authorizeDocument(
  session: HocusPocusServerContext,
  documentName: string
): Promise<CollaborationAccess> {
  const access = await new CollaborationService().access(
    session.cookie,
    session.workspaceSlug!,
    session.projectId!,
    documentName
  );
  if (
    !access.can_read ||
    access.user.id !== session.userId ||
    access.document.id !== documentName ||
    access.document.type !== session.documentType ||
    access.document.project_id !== session.projectId ||
    access.document.workspace_slug !== session.workspaceSlug ||
    !Number.isFinite(Date.parse(access.session_expires_at)) ||
    Date.parse(access.session_expires_at) <= Date.now() ||
    (session.credentialGeneration !== undefined && session.credentialGeneration !== access.credential_generation)
  ) {
    throw new AppError("Document access denied", { code: "DOCUMENT_ACCESS_DENIED" });
  }
  return access;
}

export const onAuthenticate = async ({
  requestHeaders,
  requestParameters,
  context,
  token,
  documentName,
  connection,
  instance,
  socketId,
}: onAuthenticatePayload) => {
  if (!validSocketOrigin(requestHeaders.origin)) throw new AppError("Origin denied");
  if (token.length > 2048) throw new AppError("Invalid authentication request");
  let identity: { id?: string; cookie?: string; ticket?: string };
  try {
    const parsed: unknown = JSON.parse(token);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid identity");
    identity = parsed as typeof identity;
  } catch {
    throw new AppError("Invalid authentication request");
  }
  const projectId = requestParameters.get("projectId");
  const workspaceSlug = requestParameters.get("workspaceSlug");
  if (
    requestParameters.get("documentType") !== "project_page" ||
    !uuid.test(documentName) ||
    !projectId ||
    !uuid.test(projectId) ||
    !workspaceSlug ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceSlug)
  )
    throw new AppError("Invalid document credentials");

  let cookie: string;
  let userId: string;
  let ticketReadOnly = false;
  if ("ticket" in identity) {
    if (typeof identity.ticket !== "string") throw new AppError("Invalid document credentials");
    const credentials = await consumeMobileTicket(identity.ticket, documentName, requestParameters);
    cookie = credentials.cookie;
    userId = credentials.user_id;
    ticketReadOnly = credentials.read_only;
  } else {
    // Admitting the native handshake does not grant the browser credential path.
    if (!validOrigin(requestHeaders.origin) || validMobileOrigin(requestHeaders.origin))
      throw new AppError("Mobile collaboration ticket required");
    const browserCookie = requestHeaders.cookie?.toString() || identity.cookie;
    if (typeof browserCookie !== "string" || !browserCookie || typeof identity.id !== "string" || !identity.id)
      throw new AppError("Invalid document credentials");
    cookie = browserCookie;
    userId = identity.id;
  }

  const session = context as HocusPocusServerContext;
  Object.assign(session, {
    cookie,
    userId,
    projectId,
    workspaceSlug,
    documentType: "project_page",
    documentName,
    origin: requestHeaders.origin,
  });
  const limits = collaborationLimits(instance);
  if (!limits.available(session.userId)) throw new AppError("Connection limit reached");
  const access = await authorizeDocument(session, documentName);
  limits.reserve(session.userId, `${socketId}:${documentName}`);
  Object.assign(session, {
    access,
    accessCheckedAt: Date.now(),
    credentialGeneration: access.credential_generation,
    expiresAt: Date.parse(access.session_expires_at),
  });
  connection.readOnly = ticketReadOnly || !access.can_write;
  // Hocuspocus replaces the context object while running onConnect hooks.
  // Return the full context so concurrent hook merges retain authorization.
  return { ...session, user: { id: access.user.id, name: access.user.display_name } };
};

/** Current-user checks remain available to authenticated HTTP endpoints. */
export const handleAuthentication = async ({ cookie, userId }: { cookie: string; userId?: string }) => {
  const user = await new UserService().currentUser(cookie);
  if (userId && user.id !== userId) throw new AppError("Authentication unsuccessful");
  return { user: { id: user.id, name: user.display_name } };
};
