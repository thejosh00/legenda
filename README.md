<p align="center">
  <img src="assets/logo.svg" alt="legenda" width="96" height="96">
</p>

# legenda

*Legenda*: Latin for "things that ought to be read".

A personal "what should I watch or read next" list for videos, papers and internal design
docs. You add things, mark them watched or read with a reaction, or dismiss them with a reason.
The app polls the YouTube channels, authors and arXiv categories you follow. Once a day an AI
curator (a Claude Code skill, run by [otto](https://github.com/thejosh00/otto)) adds a handful
of new finds, each with a reason, and learns from how you reacted to earlier ones.

The app contains no AI. It stores items, dedupes them, enforces the curator's limits and
records who did what. The judgement lives in the skill.

## Install

Needs [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun link            # puts `legenda` on your PATH (~/.bun/bin)
```

## Quick start

```bash
legenda serve                                   # the server and web app, on 127.0.0.1:7778
legenda token you                               # a token for you (in another terminal)
legenda login --url http://127.0.0.1:7778 --token <it>
legenda add https://www.youtube.com/watch?v=…   # add something
legenda list
```

Open `http://localhost:7778` and sign in with the same `you` token.

The server listens on this machine only (`127.0.0.1`) and answers only to `localhost`,
`127.0.0.1` and `[::1]`; any other `Host`, and any write whose `Origin` is not one of
those, gets a 403. That keeps web pages (DNS rebinding) and other devices out. To use it
from a phone, open it to the network and name the host the phone will use:

```bash
legenda settings set listen_host 0.0.0.0
legenda settings set allowed_hosts your-mac.local    # comma-separated; an IP works too
```

Restart the server for `listen_host`; `allowed_hosts` applies at once. Then, once, open
`http://your-mac.local:7778/?token=<it>` on the phone; the token is traded for a cookie and
removed from the address bar.

The data directory and its backups are `0700`, and the database, its `-wal`/`-shm`, the
backups and `client.json` are `0600`; `legenda serve` tightens any it finds looser.

To keep it running in the background (macOS), and to take a daily backup into
`$LEGENDA_DIR/backups`:

```bash
legenda service install            # [--port N] [--host H]
legenda service status | logs | restart | stop | uninstall
```

## Instances

One codebase, run as independent instances. A typical setup is a **personal** one (YouTube
and papers) and a **work** one (papers and your organisation's docs). Instances share nothing.
Each is a data directory, `LEGENDA_DIR` (default `~/.legenda`), holding its database, its
`client.json` and its backups:

```bash
# personal
legenda settings set enabled_sources youtube,papers

# work, on its own port and directory, on this machine only (the default)
export LEGENDA_DIR=~/.legenda-work
legenda serve --port 7779 &
legenda token you && legenda login --url http://127.0.0.1:7779 --token <it>
legenda settings set enabled_sources papers,docs
legenda settings set docs_label Confluence
legenda settings set docs_base_url https://example.atlassian.net/wiki
legenda settings set docs_query_hint CQL
legenda settings set docs_reauth_hint 'run "<your sandbox> auth" in a terminal'
LEGENDA_DIR=~/.legenda-work legenda service install --port 7779
```

A source that is not enabled is hidden everywhere: in the UI, the CLI and the curator's
context. Nothing organisation-specific lives in this repo. The docs system's name, base URL,
query syntax and how to re-authenticate are all instance settings.

## Sources

| Source | Fetched by | Follow | Notes |
|---|---|---|---|
| **YouTube** | the app | channels (URL, `@handle`, `UC…` id, or any video of theirs) | Polled hourly, no key needed. A `youtube_api_key` makes polling more reliable and adds search and durations. See [YouTube with an API key](#youtube-with-an-api-key). |
| **Papers** | the app | Semantic Scholar authors, arXiv categories (`cs.DC`), saved queries | Semantic Scholar plus arXiv, polled daily. Any arXiv id, DOI or S2 link names the same paper. Categories and queries are screened by the curator by default. `semantic_scholar_api_key` is optional. |
| **Docs** | the agent | collections, tags, authors, queries | legenda never talks to the docs system and holds no credentials for it. The curator reads it with its own read-only tools and stores metadata and a 2–3 line summary, never page bodies. |

Screened follows don't put new items straight on the list. The curator judges each one
against the follow's note (for example "only RFCs and design docs, not meeting notes").

`legenda settings` lists every setting. Keys are stored but never shown.

### YouTube with an API key

Without a key, channels are polled from YouTube's public feed. The feed is unreliable: it
often answers 404 or 500 for channels that exist, sometimes for hours at a time. legenda
retries each poll a few times. If every try fails, the follow records the error, and the next
hourly poll catches up on anything among the channel's 15 newest uploads, so new videos
arrive late rather than being missed.

With a key (`legenda settings set youtube_api_key …`), legenda polls through the Data API
instead:

- **Polling doesn't use the feed.** Each poll lists the channel's newest uploads from the
  API. If the API fails (quota spent, key revoked), that poll falls back to the feed.
- **Shorts are caught reliably.** Each poll also reads the channel's Shorts playlist, so
  Shorts longer than a minute are skipped too (`skip_shorts`).
- **New videos get durations,** and search becomes available to the curator.

Each channel costs 2 units per poll, about 48 a day, plus 1 unit for each poll that finds new
videos. `youtube_daily_units` caps the spend. The default of 3000 (Google's free limit is
10,000 a day) covers roughly 50 channels.

Following a channel never needs the feed: legenda reads the channel's page, with or without a
key.

## The list, by hand

```bash
legenda list [--source …] [--state queue|done|dismissed|all] [--origin follow|agent|you]
legenda done <item> --reaction loved|liked|meh|disliked|abandoned [--note …]
legenda dismiss <item> --reason too_long [--note …] [--block]
legenda restore <item>
legenda feedback <item> more|less|comment [--note …]
legenda follow youtube @somechannel [--note …] [--screened]
legenda follow papers cs.DC --note "systems, not theory"
legenda follows | unfollow <id> | block <follow-or-item> | unblock <id>
legenda interest add "distributed consensus" --strength core|curious|avoid [--source papers]
legenda profile [--history] | legenda profile edit
legenda runs                     # what the curator did, and why
legenda poll [--follow <id>]     # check follows now
```

An `<item>` can be its id, a unique prefix of it, or its URL. Every command takes `--json`.

Your reactions and dismiss reasons are what the curator learns from. Each is one tap in the
web app. The reasons offered depend on the source: `too_deep` for papers, `clickbait` for
videos, and so on.

## Working with AI agents

The curator is just another actor with its own token. The server enforces its limits:

- **Attributed.** Every write records its actor (`agent:curator`), and every suggestion
  records the run that made it.
- **Capped.** `daily_suggestion_cap` (5), optional per-source caps
  `daily_suggestion_cap.<source>`, `daily_follow_intake_cap` (25) and
  `max_per_creator_per_run` (2).
- **Idempotent.** Adding something already known returns `"existing": true` and changes
  nothing. A dismissed item is never resurrected, and a retried run can't flood the list.
- **Refused what is yours.** An agent token can't mark things done, dismiss, restore, give
  feedback, follow, block, change interests or settings, or issue tokens. Those exit `2`.

`legenda agents` prints the contract for this instance: setup, commands, examples, JSON
shapes, exit codes and limits. It is generated from the code and the instance's settings, and
an end-to-end test runs every example in it against a real server.

### The JSON contract

With `--json`, success and failure both arrive as JSON on stdout, and stderr stays empty:

```json
{"ok": false, "error": "today's suggestion cap is reached (5 of 5, daily_suggestion_cap)", "code": 1}
```

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | failed: a cap, a blocked creator, a missing reason or summary, an upstream error |
| 2 | bad command or usage, or not allowed for this actor |
| 3 | not found |
| 4 | server unreachable or busy |

Item fields are snake_case and always present, with unset ones as `null`. Every CLI command is
one HTTP endpoint under `/api/`, with a Bearer token.

### The curator skill

The skill is at `skills/legenda-curate/SKILL.md`. Install it for Claude Code:

```bash
ln -s "$PWD/skills/legenda-curate" ~/.claude/skills/legenda-curate
```

Give the curator a token and a client directory of its own. `legenda login` keeps one token
in `$LEGENDA_DIR/client.json`, so logging the curator in where you logged in would replace your
token with its token, and your own commands would run as the curator. The CLI is only an HTTP
client, so a directory holding nothing but the curator's `client.json` is enough. The
database stays with the server.

```bash
legenda token agent:curator
LEGENDA_DIR=~/.legenda-curator legenda login --url http://127.0.0.1:7778 --token <it>
```

`legenda token` writes to the instance's database directly, so run it with the instance's own
`LEGENDA_DIR`, never the curator's. `login` only talks to the server.

Your own commands keep using `~/.legenda`. The curator's commands use `~/.legenda-curator`
because of how it is launched (below), not because the model has to remember a variable on
each command. If it forgot one, it would act as you without anything saying so. Don't export
`LEGENDA_DIR` or `LEGENDA_TOKEN` in your shell profile: Claude Code's shell loads that profile,
so the value there would override the launcher's.

Try a run by hand first: start `LEGENDA_DIR=~/.legenda-curator claude` and ask it to "run the
legenda curator". Then check the Curator page.

## Running it daily under otto

otto runs every wake through a launcher, so a launcher is where the curator gets its client
directory. Add one to `~/.otto/config.json`. Use an absolute path, because `~` isn't expanded
there:

```json
{
  "launchers": [
    { "name": "legenda-curator", "command": "env LEGENDA_DIR=/Users/you/.legenda-curator claude" }
  ]
}
```

```bash
otto run --skill legenda-curate --launcher legenda-curator \
  --goal "Once a day, find new things I'd want to watch or read, add them to legenda, and learn from my feedback" \
  --perpetual --period 1d --policy maxTicksWithoutProgress=0
```

- `--launcher legenda-curator`: every wake runs as `agent:curator`, whoever starts it.
  `otto wake <id> --dry-run` prints the command, so you can check that the variable is set.
  A run keeps its launcher by name, so to move an existing run onto it, start the run again.
- `--perpetual`: there is no "done". Retire it with `otto stop`.
- `maxTicksWithoutProgress=0`: a day with nothing worth suggesting is normal, not a stall.
- The period is anchored on when a wake starts, so start the run at the time of day you want
  the list to update, or shift it once with `otto state arm-timer <id> --at <iso>`.

### Only when the list runs low

To skip the day's run when you already have plenty to get through, put a check script in
front of it. `skills/legenda-curate/check.sh` counts what is in the queue and wakes the curator
only when there are fewer than `LEGENDA_QUEUE_MAX` items (default 20):

```bash
otto check <run> --script "$PWD/skills/legenda-curate/check.sh" --wake-after 7
```

- **The queue is everything waiting** in the enabled sources: follow intake, the curator's
  suggestions and what you added yourself.
- **The period still sets how often it looks.** With `--period 1d` the check runs once a day.
  A shorter period refills the list sooner after you clear it, but the daily caps still apply.
- **`--wake-after 7` is the safety net.** The curator also learns from your reactions, so after
  a week of skipped days it runs anyway. otto's default of 24 is 24 days at a daily period.
- **A stopped server doesn't wake it**, and a broken script or `legenda` failing does (otto
  fails open). `otto check <run>` shows the last result, e.g. `27 in the queue, at least 20`.
- **The script reads with your login** in `~/.legenda`. Any token can list the queue, and
  otto runs check scripts itself, not through the run's launcher.
- **To change the threshold**, or for a non-default instance, edit a copy of the script:
  change the `20` on its `max=` line, and add `export LEGENDA_DIR=~/.legenda-work` if needed.
  Then set the copy with `otto check` again. otto keeps its own copy of the script.

### A docs instance, under a sandboxed launcher

The curator reads your docs through tools its environment provides, usually an MCP server
inside a sandbox that handles its own sign-in. Give the work curator its own client directory,
as above:

```bash
LEGENDA_DIR=~/.legenda-work legenda token agent:curator
LEGENDA_DIR=~/.legenda-work-curator legenda login --url http://127.0.0.1:7779 --token <it>
```

Then define a launcher in `~/.otto/config.json` that sets that directory in front of your
sandbox, and run the curator under it:

```json
{ "name": "legenda-work-curator", "command": "env LEGENDA_DIR=/Users/you/.legenda-work-curator <your sandbox command> -- claude", "grantFlag": "…" }
```

```bash
otto run --skill legenda-curate --launcher legenda-work-curator \
  --goal "…" --perpetual --period 1d --policy maxTicksWithoutProgress=0
```

Setting `LEGENDA_DIR` in front of `otto run` wouldn't do it. Later wakes are started by otto's
background reviver, which doesn't have your shell's environment. If your sandbox doesn't pass
the parent environment through, set the variable with the sandbox's own option instead.

The sandbox must allow the curator to:

- reach the legenda server (for example `127.0.0.1:7779`),
- read `~/.legenda-work-curator/client.json`,
- see the skill in `~/.claude/skills/legenda-curate`, or the wake can't load it,
- use the docs system's read-only tools.

The YouTube and paper APIs are called by the legenda server, outside the sandbox, so they need
no allowance.

**When the docs sign-in expires**, the curator doesn't retry and doesn't try to
re-authenticate. It skips the docs steps, finishes the other sources, and records the run as
`needs_auth`. The Curator page then shows your `docs_reauth_hint`. The curator also opens an
otto gate asking you to renew the sign-in: *"The Confluence connection has expired. To fix
it: … Then answer Done."* Answering the gate starts the next wake, which tries again.

## Development

```bash
bun run dev          # serve with hot reload
bun run test         # typecheck + the whole suite
bun run build        # a single binary in dist/
```

Layout: `src/core/` is pure (no fs, db, clock, randomness or React). `src/sources/` has one
adapter per source behind the `Source` interface. Then `src/db/`, `src/server/`,
`src/commands/` (a thin CLI client: flags → one HTTP call), `src/web/` (React, bundled by Bun
from `index.html`), `src/local/` (launchd) and `skills/`.

Tests never touch the network. Every adapter takes an injected `Fetcher`, and tests answer
from fixtures (`tests/helpers/fakeWeb.ts`). A preload points `LEGENDA_DIR` at a temporary
directory and sets a non-UTC time zone, so "today" is tested as the local day it is.
