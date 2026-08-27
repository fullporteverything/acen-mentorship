# Suite 7 — agent instructions

## Working style — do it, don't hand back instructions

Standing preference from the owner: **when you can perform an operational task
yourself, perform it.** Talk it through, agree the change, then go and make it.
Don't write up a click-path and hand it back when you could have done it.
Reserve the write-up for things you genuinely cannot reach.

What that means in practice:

- **Just do it:** anything in this repo (code, tests, builds), and anything on
  GitHub through the MCP tools — reading PRs, pushing branches, checking CI.
- **Do it, then report:** operational changes on third-party services where a
  scoped API token is present in the environment. Make the change, verify it
  independently, say what you verified. Don't re-ask permission for a settings
  change already agreed in conversation.
- **Confirm first regardless:** anything destructive, irreversible, or visible
  to members — deleting media, stripping Discord roles, force-pushing, or
  anything touching a paying member's access. "We agreed" covers the change
  discussed, not its blast radius.

### Why a task may still come back as instructions

Two hard limits. Both are fixable by the owner, neither by the agent — so name
which one is in the way instead of describing buttons and leaving it there.

1. **Network policy.** The session container reaches the outside world through
   an allowlist proxy. Package registries, Anthropic APIs and git are open;
   `api.kinescope.io`, `discord.com` and `api.vercel.com` were all refused at
   CONNECT with a 403 as of the last check. Verify the live policy with
   `curl -sS "$HTTPS_PROXY/__agentproxy/status"` before claiming a host is
   unreachable — it differs per environment. Widening it is an environment
   setting: https://code.claude.com/docs/en/claude-code-on-the-web
2. **Credentials.** Runtime secrets (`KINESCOPE_API_TOKEN`,
   `DISCORD_BOT_TOKEN`, `DATABASE_URL`, blob tokens) live on Vercel, not in the
   session container. No authenticated API call is possible here without them
   being set on the environment.

Ask for **scoped API tokens set as environment variables**. Never ask for
account passwords, and never drive a logged-in dashboard session on the
owner's behalf: tokens are revocable, auditable and narrow, a password is none
of those, and MFA makes it impractical anyway.

## Things that will bite you

- **Next.js 16.** APIs, conventions and file structure differ from older
  training data. Read the relevant guide in `node_modules/next/dist/docs/`
  before writing framework code, and heed deprecation notices.
- **Tables are self-creating.** Stores follow the `lib/table-chips-store.ts`
  pattern: a module-level boolean short-circuits `CREATE TABLE IF NOT EXISTS`
  DDL after the first call, and every exported function begins with its
  `ensure…Tables()`. There is no migration step in production — don't add one.
- **Two test files fail in any session container** (`lib/repositories/…` and
  one other) because there is no database. Pre-existing; not something you
  broke. Baseline with `git stash` before assuming otherwise.
- **`dojo:` / `dojo/` keys are load-bearing.** The site was rebranded from Dojo
  to Suite 7, but localStorage keys and blob path prefixes still use the old
  name on purpose. Renaming them orphans live member data.
- **Security controls are layered on purpose.** ScreenGuard (capture strikes),
  StudentWatermark + Kinescope's in-iframe watermark (attribution), away-blur
  and away-pause, RightClickGuard (friction). Most are deterrents, not
  protection — the real protection is Kinescope DRM plus domain restriction.
  Don't present friction as if it were protection.
- **False positives are the cardinal sin.** The owner has said so repeatedly.
  A control that punishes an innocent member is worse than one that misses a
  guilty one. Prefer pausing, flagging and alerting over striking, locking or
  revoking — and gate anything that removes access behind an explicit env flag
  that defaults to off.
