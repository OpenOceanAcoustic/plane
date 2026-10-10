# Android API contract (version 1)

The API and Live service must both be upgraded before installing the mobile client. The mobile additions themselves do not change the schema. The unified security/document/mobile release also applies `0013_trusted_browsers`, `0014_api_token_expiry` and the empty `0015_merge_document_files_security` migration while retaining the published `0013_document_file_versions` migration. They use the existing Django sessions, TOTP credentials, project/page permissions and Redis database 0. Keep API and Live on the same Redis instance and database.

## Server connection and authentication

`GET /api/instances/` includes `mobile_api_version: 1`, including inactive instances and previously cached instance responses. The Android client must reject servers that do not advertise version 1.

Fetch CSRF with `GET /auth/get-csrf-token/`, preserve the CSRF cookie, and send `X-CSRFToken` on mutations. The native HTTP transport must preserve every `Set-Cookie` header, including the rotated CSRF cookie after authentication.

`POST /auth/lab/mobile/sign-in/` and `POST /auth/lab/mobile/admin/sign-in/` accept JSON `{ "username": "name", "code": "123456" }`. Both return `{ "username": "name", "client_platform": "android", "capabilities": { "data_export": false } }`. The server sets the Android tag; request fields and headers cannot change it. The ordinary route issues `session-id`; the admin route issues independent `admin-session-id` and requires an active instance administrator. These cookie names can be changed in server settings.

Existing enrollment and confirmation routes work unchanged. Account-level durable rate limits, replay prevention and SSH recovery apply to both mobile and browser logins. A rebind invalidates both ordinary and administrator sessions.

Mobile sessions retain the security profile's separate user/admin purposes and absolute expiry. Older sessions without these security fields must sign in again after upgrade. Administrator writes require a dynamic-code verification within the configured freshness window (ten minutes by default); `POST /auth/lab/admin/reauthenticate/` accepts `{ "code": "123456" }` with the administrator session and CSRF token. It refreshes administrative verification without extending the session's absolute deadline. A fresh mobile administrator sign-in also refreshes verification.

`GET /api/lab/session/` returns `{ "user": { "id": "UUID", "username": "name", "display_name": "Name", "email": "name@example.org" }, "client_platform": "android", "capabilities": { "data_export": false }, "mobile_api_version": 1 }`. Use `?admin=true` to query the independent administrator cookie. All other queries use the ordinary cookie. The response is never cached. Existing browser sessions return `client_platform: "web"` and `data_export: true`.

Ordinary logout remains `POST /auth/sign-out/`; administrator logout remains `POST /api/instances/admins/sign-out/`. Switching servers also clears the client's cookie jar and business caches.

## Collaboration

`POST /api/workspaces/{slug}/lab/live-ticket/` accepts `{ "project_id": "UUID", "page_id": "UUID" }` with the ordinary authenticated session. It returns HTTP 201 and `{ "ticket": "opaque", "expires_in": 60, "document_name": "PAGE_UUID", "document_type": "project_page", "read_only": false }`. Missing or revoked workspace/project membership and inaccessible private pages are denied before issuing a ticket. Guests without access to all project features cannot obtain a document ticket.

Configure Hocuspocus with `name: page_id`, `token: JSON.stringify({ ticket })`, and `parameters: { workspaceSlug: slug, projectId: project_id, documentType: "project_page" }`. Obtain a fresh ticket for every websocket authentication/reconnection. Tickets expire in 60 seconds and are consumed atomically once; reuse, expiry, a wrong document or a wrong project/workspace/type are denied. The server retains the session cookie in Redis and websocket context; it never returns that cookie to JavaScript. Member/guest access, locked pages and archived pages determine Hocuspocus read-only mode. Session recovery is checked again after ticket consumption and before subsequent websocket messages, and existing recovery broadcasts still disconnect established subscriptions.

Existing browser tokens and Cookie-header authentication remain compatible at the configured canonical Origin. The bundled Android UI's fixed `https://localhost` Origin may pass WebSocket admission only with a valid one-use ticket; cookie/id authentication from that Origin is rejected. Both paths retain handshake/frame/user budgets, current document ACL, persisted session expiry and credential generation checks. Live HTTP CORS and cookie-based conversion retain the canonical Origin requirement.

## Export capability

Android sessions receive HTTP 403 `{ "error": "手机端不支持数据导出", "code": "mobile_export_disabled" }` for dedicated API export routes (including issue-export history, planning JSON/CSV, analytics and activity exports) and CSV/PDF/XLS/XLSX/PNG/SVG requests. Workspace slugs that happen to contain `export` remain valid for normal queries. Live PDF export verifies the persisted API session capability before fetching document content, and returns HTTP 403 for mobile sessions. It fails closed if authentication or capabilities cannot be verified.

Ordinary JSON queries, Yjs description/binary synchronization, attachment upload/confirmation/download and browser exports continue to work. The capability limits dedicated exports; ordinary authorized data still reaches the app for display and editing.
