# Public security hardening

## Approved delivery

Implement on `feat/public-security-hardening` from `origin/ooa/main` in an isolated worktree; submit a PR to OpenOceanAcoustic/plane, base `ooa/main`. Do not merge or replace the running laboratory deployment.

All member and administrator pages use direct HTTPS. Keep SSH invitations and existing TOTP credentials. Use local controls without third-party WAF/CAPTCHA. Existing users, attachments, and business permissions remain compatible.

## Authentication

Unknown usernames must never allocate persistent login identities. Redis atomic global/source limits precede database work and fail closed. Defaults: anonymous source 30/minute, global 120/minute; trusted traffic has a separate reserved resource budget. Real accounts retain five submissions per rolling 600 seconds. Trusted browser credentials plus TOTP use a separate durable five/600-second device quota; no successful login or Redis restart resets quotas. All channels share TOTP replay protection.

Browser registration is opt-in and defaults off. Signed random credentials are hashed in storage and bound to user, purpose, credential generation, and absolute expiry. Member browsers: maximum five, 30 days; administrator browsers: maximum two, seven days. Reuse never extends expiry; reaching a limit does not fail login or evict another device. Sign-out preserves opted-in trust; forget-browser revokes it. Rebinding revokes devices, sessions, API tokens and live connections.

Server sessions enforce purpose and absolute expiry: users 12 hours, administrators one hour. Old sessions require login. Administrator writes require authentication within ten minutes, excluding logout; reauthentication has an independent durable session quota and does not extend expiry.

## Interfaces and request integrity

Login requests add optional `remember_browser`. Errors retain `error`/`retry_after` and gain stable `code`. User/admin browser list and revoke endpoints never expose credentials. User/admin sign-out and administrator reauthentication are purpose-isolated.

Cookie-authenticated writes enforce CSRF across web, admin, space and Live. Browser clients share token fetching and refresh once only for explicit CSRF failures; never send tokens to external signed-upload origins. Live forwards each connection's CSRF cookie/token and configured public Origin.

Every live document connection, including hot cached documents, checks backend resource read/write authorization before synchronization. A read-only collaboration-access endpoint returns canonical target, current user, capabilities, credential generation, and actual stored session expiry without loading document contents. Preserve existing owner/member rules; locked/archived pages are not writable.

Permission events close affected connections after transaction commit. Authorization caching is at most two seconds; silent connections are rechecked every 15 seconds and closed at session expiry or authorization-service failure. WebSocket Origin validation is independent of CORS. Defaults: eight documents per user, 20 messages/second, maximum payload eight MiB.

## Resource controls

User read/write budgets default to 600/60 per minute. Upload signing is ten per minute and retains five MiB object limits. Document conversion requires a session, ten/user/minute, two workers, queue length 20, and a ten-second task timeout. API tokens: maximum five active per user, default expiry 30 days, maximum 90 days; existing permanent tokens receive a 30-day transition. Tokens share user budgets. Security logs are structured/redacted and avoid unbounded metric labels or per-attempt audit-table writes.

## Public deployment and recovery

A separate public profile uses immutable production images, non-root users, read-only source, resource/PID limits, and private backend services. Caddy publishes only HTTP certificate/redirect and HTTPS application entrypoints, persists certificates, rejects unrelated Host values and normalizes forwarding headers. Public settings require an exact HTTPS domain, secure host-only cookies and explicit trusted proxy addresses. Live resolves that domain to the private TLS proxy. Preserve laboratory configuration.

HSTS starts at 300 seconds, with no includeSubDomains/preload. Operations can raise it to one year after one day of successful TLS operation. Public backup/restore must record actual deployment images, profile and volume identities; restore the matching version before testing migration. Never rotate TOTP keys during migration or restore over active volumes.

## Acceptance seams

Approved seams: public HTTP login/binding and session API requests; browser HTTP writes/uploads; real Hocuspocus document connections with backend authorization; setup/Compose and isolated backup/restore. Use behavior-focused regression tests, one red/green slice at a time.

Verify unknown-name storage bounds, distributed/concurrent quota enforcement, trusted login during anonymous lockout, device revocation/expiry, purpose isolation, CSRF, administrator freshness, hot-document denial and readonly enforcement, silent expiry/revocation, origin/Host/header rejection, API/token/upload budgets, public image startup, deployment checks and backup recovery.

TOTP remains susceptible to real-time phishing; local rate limits do not promise protection from attacks exceeding server bandwidth.
