# Scam-post guard

Sweeps the server for phishing posts from compromised or throwaway accounts,
reports them, and — once you switch it on — kicks the account and deletes the
message.

## Turn on AutoMod first

This is the **second** line of defence, not the first. Discord's built-in
AutoMod blocks a message *before anyone sees it*; this runs on a two-minute
cron, so a scam link is visible until the next sweep. AutoMod is free, native,
and instant:

**Server Settings → AutoMod** → enable **Suspicious links / spam content**
blocking and the **Mention Spam** rule (limit ~5). That alone kills most of it.

What AutoMod cannot do is judge the *account* — how old it is, how long it has
been in the server, whether it is spraying the same text across channels — or
remove it. That is what this adds.

## What it looks at

Nothing scores at all without a link or a cross-post, so ordinary chat can never
be flagged. On top of that:

| Signal | Weight |
| --- | --- |
| Same text posted in 3+ channels | 50 |
| Link impersonating Discord or Steam (incl. misspellings like `dlscord`) | 30 |
| `@everyone` together with a link | 25 |
| Link shortener or IP logger (`grabify`, `iplogger`, `bit.ly`) | 20 |
| Scam phrasing ("free nitro", "steam gift", "claim your") | 20 |
| Account less than 30 days old | 15 |
| Throwaway TLD (`.tk`, `.ml`, `.gq`) | 12 |
| Joined within the last week | 10 |
| Discord-flagged bot account | 10 |
| No roles | 5 |

**40 reports. 70 removes** (when removal is enabled).

The scam-phrase list is deliberately short, because this is a trading server.
`crypto`, `invest`, `profit`, `free`, `signals`, `USDT`, `binance`, `funded`,
`payout` are all said sincerely here every day — a stock scam word list would
fire on them hourly and get switched off within a week. Every phrase in the list
was picked because it does **not** appear in genuine trading talk.

## Who is protected

- **The administrator is exempt outright.** No combination of signals reaches
  them.
- **A member holding the access role can be reported but never removed
  automatically.** A hijacked student account is a real thing — and so is the
  alternative, a machine kicking someone who paid to be here. A human confirms
  that one in thirty seconds.
- **If the member lookup fails**, they are treated as a role holder, which caps
  the outcome at a report. A failed API call must never become a kick.
- The first sweep of a channel **reads nothing** — it records where the channel
  is and starts from there, so switching this on cannot dredge up months of old
  history and report things already dealt with.

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `CRON_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | yes | Already set. |
| `DISCORD_GUARD_REPORT_CHANNEL_ID` | recommended | Where reports go. Falls back to the payout review channel. |
| `DISCORD_REQUIRED_ROLE_ID` | already set | The access role — the thing that protects paying members from removal. |
| `DISCORD_GUARD_AUTOKICK` | no | `true` lets it kick and delete. **Defaults to off.** |

Bot needs **Kick Members** and **Manage Messages** for removal to work; reporting
needs only **View Channel** + **Read Message History**.

## Watch it before you arm it

```
curl "https://<site>/api/discord/guard/sweep?key=$CRON_SECRET&dry=1"
```

`dry=1` assesses and reports back to you without posting, kicking, deleting, or
moving the cursors. Leave `DISCORD_GUARD_AUTOKICK` off for a week and read the
reports. If it never flags a real member in that time, arm it.
