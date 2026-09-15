# Account setup and authentication protection

## Account ownership

New accounts require email ownership before sign-in. Self-registration and invite-code registration create an account, send a one-hour setup link, and direct the user to **Verify your email**. The recipient chooses a fresh password through the link. This replaces the password supplied during registration so someone who preregistered another person's address cannot retain access after the recipient verifies it.

Administrator and bulk-created accounts have no initial password and a PENDING membership. Their setup email includes a signed invitation bound to the user, organization, membership, role, version, and expiry. The recipient must explicitly accept on the setup page. Verification, credential replacement, and invitation acceptance happen in one transaction. Changed, expired, canceled, or previously accepted invitations cannot activate membership. The admin UI offers resend/cancel controls and returns no password.

An email setup token is random, stored only as a SHA-256 hash, expires after an hour, and is consumed once. Verification replaces the password and clears outstanding reset links. Password-reset links independently prove email ownership: successful reset marks the address verified, clears setup tokens, and replaces the password. Reset never accepts an organization invitation. A pending recipient who uses reset first can ask the administrator to resend their invitation, then sign in and explicitly accept it.

Email delivery must be configured before creating a new account or invitation. If delivery fails after persistence, the account remains unable to sign in; the response reports failed delivery, and the public **Verify your email** page or admin resend action can retry. No link, password, provider error, or fallback credential is returned in the API or application logs. Setup/reset issuance has a five-minute per-account cooldown as well as the durable quotas below.

### Existing accounts and migration

Apply `20260915010000_auth_protection` before serving the updated application. It adds `emailVerificationRequired=false` to pre-migration users, then makes the database default `true` for subsequent users. It does **not** set existing `emailVerified` flags to true. Existing legitimate users can continue signing in without a forced lockout; new accounts cannot bypass verification by omitting the marker. Existing unverifiable setup tokens are cleared.

Legacy users may verify through the public setup page or a password reset. That proves ownership and replaces their credential; existing sessions become invalid. This compatibility policy is not evidence that a legacy address belongs to its current account holder. Existing sessions also remain bound to the current password hash and refreshed ACTIVE membership and role.

## Durable abuse controls

Authentication counters live in PostgreSQL `auth_rate_limits`. Atomic conditional upserts use database time and cap each counter before credential comparison, hashing, account creation, or email delivery. Independent application instances share the allowance. Missing signing configuration, invalid trusted proxy input, and database errors fail closed; an in-memory fallback is not used.

Keys are HMAC-SHA-256 values derived from the signing secret, action, and normalized identity. Plain email addresses, IP addresses, and tokens are not stored in the limiter table. The app deletes at most 256 expired rows with `SKIP LOCKED` before each protected operation; inactive expired rows are cleared when protected traffic resumes. Rotating `NEXTAUTH_SECRET` invalidates sessions and changes counter keys, so plan rotation as an operational event.

| Limit | Allowance |
| --- | --- |
| Per public/action source | 100 attempts / 15 minutes |
| Per action across the application | 1,000 attempts / 15 minutes |
| Sign-in per normalized account | 10 attempts / 15 minutes |
| Registration, join, reset token, verification token, resend account, and member actions per identity | 5 attempts / 15 minutes |
| Account email per purpose and recipient | 3 attempts / 15 minutes |
| Account email per organization | 100 attempts / 15 minutes |
| Account email across the application | 500 attempts / hour |

Every attempted operation consumes allowance, including failed passwords and delivery failures. Purpose and source limits apply in addition to recipient limits. Limits are deliberately conservative; tune them against measured legitimate traffic before a large rollout. A 429 response includes a retry delay. New passwords are 8 characters minimum and at most 72 UTF-8 bytes, avoiding bcrypt truncation. Legacy sign-in allows bounded longer inputs for compatibility with existing passwords. Authentication request bodies, including chunked NextAuth credential posts, are limited to 16 KiB before parsing. Form fields have separate length limits.

### Explicit reverse-proxy contract

The default ignores `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, and other caller-supplied network headers. NextAuth does not supply an authenticated socket address, so all requests share the default source bucket; per-account and global controls still apply.

Set `STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER` only after the deployment operator establishes **all** of the following:

1. The application is reachable exclusively through the intended proxy; direct access and alternate proxy paths are blocked.
2. That proxy removes the selected header from incoming requests and overwrites it with the observed client address.
3. It sends one plain IP address, without ports, lists, or other text. Use a dedicated lowercase name such as `x-strengthsync-client-ip`.
4. This behavior is verified in the actual deployed path, including failed/missing-header requests.

The configured header must be a single valid IPv4 or IPv6 address. Missing/invalid values fail closed. `forwarded` and `x-forwarded-for` cannot be configured as the trusted header. IPv6 identities are canonicalized and grouped by /64 to limit trivial address rotation. Merely setting the environment variable does not establish proxy trust. No production proxy contract was verified during local implementation.

## Verification and release checks

- `node --test scripts/security/auth-protection.test.cjs scripts/security/accounts.test.cjs scripts/security/session.test.cjs` exercises actual handlers/helpers with explicit service boundaries.
- `scripts/security/auth-protection.integration.cjs` rejects every database except disposable loopback PostgreSQL on port 55487 named `strengthsync_security`; it creates and removes only synthetic records. It covers concurrent admission, multiple Prisma clients, expiry, legacy/default flags, verification replay and races, recipient binding, cancellation, and complete registration/admin setup handler flows. Email transport is captured locally.
- HTTP fixtures representing legacy users must explicitly set `emailVerificationRequired:false`. New-account tests should insert a hashed synthetic token and expiry, then call `/api/auth/verify-email` with `token`, a recipient-chosen `password`, and, for invitations, the signed `invitation` plus `acceptInvitation:true`. Never add production email bypass flags.
- Before release, verify email delivery, the deployed HTTPS account URL, production database migration, source-IP contract if enabled, and legitimate-rate capacity. These are deployment checks; local tests do not establish them.
