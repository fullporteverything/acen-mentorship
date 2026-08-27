# Suite 7 — agent instructions

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
