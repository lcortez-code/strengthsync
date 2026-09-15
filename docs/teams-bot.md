# Teams account linking

## Configure before enabling

The bot requires `MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD`, a valid `MICROSOFT_APP_TENANT_ID`, and the intended HTTPS `NEXTAUTH_URL`. Apply the `20260915030000_teams_verified_linking` migration and generate the matching Prisma client before using the updated integration. No deployment is performed by these instructions.

Bot Framework authenticates each activity before the application checks the Teams channel, configured tenant, Aad user identity, and personal conversation. Group and channel conversations cannot run commands that access organization data. No email-address matching or client-supplied Teams identity is accepted.

## Connect an account

1. Open a personal chat with the StrengthSync bot in the configured Teams tenant.
2. Send `/link` and open the **Link Account** button.
3. Sign in to your own StrengthSync account, review the Teams account name, and choose an organization where your membership is active.
4. Confirm that you requested the link in your own Teams chat, then select **Connect Teams account**.
5. Return to Teams and send `/help`, `/strengths @person`, `/requests`, or `/shoutout @person message`.

The link expires after ten minutes and can be accepted once. Requesting another link replaces the previous one. Link tokens travel in the browser URL fragment and are sent to the application API in a JSON body; the database stores their hashes.

Commands use exactly the organization selected during linking. They never substitute another organization when membership is suspended or removed. To change organizations, send `/link` again and make a new selection. Linking cannot replace a mapping owned by another StrengthSync account.

## Disconnect and recover

Open **Settings → Profile → Manage Teams account** to inspect or disconnect links. Disconnecting also invalidates outstanding link challenges for that Teams identity. Links created before tenant verification was introduced remain inactive until their owners relink them. Reinstalled personal chats may require relinking because the conversation binding changed.

If a link is expired, replaced, already used, or associated with another account, the screen explains the recovery step. Only the account that owns an existing mapping can disconnect it. Do not follow a link someone else requested in their Teams account.

## Local verification

- `node --test scripts/security/teams-linking.test.cjs` runs handler/helper tests with mocked external boundaries and no provider calls.
- `scripts/security/teams-linking.integration.cjs` requires the dedicated disposable loopback PostgreSQL database enforced by its guard. It verifies atomic replay protection, ownership conflicts, explicit organization selection, revocation, expiry, and unlink behavior using synthetic records cleaned up afterward.

These checks do not verify Azure registration, provider token validation end to end, or delivery in Teams. Those remain checks for an authorized provider environment.
