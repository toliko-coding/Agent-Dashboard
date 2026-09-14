# Controlling & Spawning Agents

## Controlling running agents

Agents spawned from the dashboard get the `dashboard-channel` MCP server automatically. When a channel is active, a green **CH** badge appears in the agent table. Open the agent modal to send follow-up messages, send `/btw` interrupts, and view replies.

For agents started **manually** outside the dashboard, inject the channel binary yourself:

```bash
claude --mcp-config '{"mcpServers":{"dashboard-channel":{"command":"/path/to/bin/dashboard-channel"}}}'
```

Use the built-in `agent-dashboard live` command, which loads the channel MCP automatically and selects the best transport (tmux if available, pty broker otherwise):

```bash
agent-dashboard live
agent-dashboard live --resume <session-id>
agent-dashboard live --yolo   # adds --dangerously-skip-permissions
```

## Spawning new agents

Click **"+ New Agent"** in the header to open the New Agent dialog.

| Field | Required | Description |
|---|---|---|
| Working folder | Yes | The folder Claude runs in — any local folder: a repository checkout, a worktree, or a plain folder. No Project and no GitHub remote are needed. As you type, the dialog shows what the folder resolves to: its repository, branch and whether it is the main checkout or a worktree, or that it is a plain folder with no repository. Known folders (project folders and allowed working folders) can be picked from the list below the field. |
| Project | No | Organisation only; **None** is a valid choice and sends no project. Choosing a project suggests its default folder when no folder is chosen yet, and never changes a folder you already chose or the repository the folder resolves to. A project's other folders are added to the agent (`--add-dir`) only when the agent works in one of that project's own folders. |
| Spawner | No | Claude default, or the project's default spawner when a project is chosen |
| Prompt | Yes | What the agent should do |
| System prompt | No | Custom system instructions |
| Permissions | No | Claude's permission mode. The two modes that skip every prompt need a second click to confirm. |

Spawned agents run **detached** — they survive dashboard restarts and appear in the roster once Claude has started its session.

### Where agents may start

The dashboard starts new agents only inside folders you have allowed: the folders of any Project, and the working folders you allow from the dialog with **Allow this folder for agents**. Working folders are stored in the `spawn.workingFolders` setting and can be listed and removed with `GET` and `DELETE /api/agents/working-folders`. While no project folder and no working folder exists, only the sensitive-directory block applies; `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config` and `~/.claude` can never be used, and cannot be allowed.

Allowing a folder is the dashboard's own permission to start an agent there. It is not Claude Code's trust.

### Claude's folder trust question

The first time Claude Code starts in a folder it has not trusted, it asks *"Quick safety check: Is this a project you created or one you trust?"* before its session begins — so the agent is not yet in the roster, and no hook reports it. The dashboard reads that question from the agent's terminal and shows it, with the exact folder, in the New Agent dialog; if you close the dialog, it stays in **Needs you** as a blocking item until you answer. **Trust this folder** lets Claude continue; **Don't trust — stop the agent** answers Claude's own *No, exit*, and the agent stops.

Whether an agent is waiting at this question is determined by the server on every scan, not by the browser that started it: **Needs you** shows it after a reload, in every open tab, and again after the dashboard server restarts (the waiting Claude process keeps running). Only the first answer is delivered; another answer to the same question is refused.

The dashboard never answers the question for you, never writes Claude's trust settings, and never passes a flag that skips the question. An answer is delivered only while the question is on screen and names the folder the agent is working in.

### When the dashboard runs inside Claude Code

If you start the dashboard server from a terminal inside Claude Code, its environment carries Claude Code's `CLAUDE_CODE_CHILD_SESSION` marker. Agents the dashboard starts do not inherit that marker — they are top-level sessions, not children of the Claude session the server happened to be launched from — so they save transcripts and appear in the roster as usual.

### Naming an agent

New Agent has two optional fields, **Name** and **Icon**, for who the agent is: for example "Resume Editor" with the Documents icon. They work with Project set to None.

- **Storage.** They are saved in the `agent_profile` table, keyed by the Claude session id the dashboard pins with `--session-id` when it starts the agent (or the id it resumes). The agent stream attaches them on every scan as `displayName` and `category`, so they survive browser reloads, dashboard restarts and rescans.
- **Unsupported spawners.** A custom-adapter spawner cannot pin a session id. For those, the start response says `"profile": "unsupported"` and the dialog tells you the name was not kept.
- **No effect on access.** A name or icon never changes which folders are allowed, which flags the agent is started with, or anything else it can do.
- **Without them.** An agent without a name shows its Claude Code session title, or its provider and short session id. An agent without an icon shows the neutral General icon.
- **Editing later.** The edit button on an agent card or in the agent workspace opens **Edit agent**, with the same Name and Icon fields. Saving sends `PUT /api/agents/{pid}/profile` with `displayName` and `category`: unknown categories are refused, and clearing both removes the profile. Any session can be edited, including one the dashboard only observes. The change applies immediately on every surface and changes nothing else; the working folder is never renamed.

### New projectless workspaces

In New Agent, **Workspace → New projectless workspace** creates a plain folder for the agent: `<projectless agents folder>/<folder name>`. The projectless agents folder defaults to `~/Documents/AI-Agents` and can be changed in Settings → Agent folders (`agents.projectlessRoot`).

- **Folder name.** It is the agent name reduced to ASCII letters, digits, `_`, `.` and `-`, so "Resume Editor" becomes `Resume-Editor`. Path separators, `..`, hidden names and Windows device names cannot get through.
- **Location.** The folder must end up directly inside the projectless agents folder after symlinks are resolved.
- **Existing folders.** An existing folder is never reused; the dialog asks for another name.
- **One request.** The folder is created by the request that starts the agent (`POST /api/agents/spawn` with `"projectless": true` and a name; the client sends no `cwd`). The server records that it created the folder and added its allowed-folder entry, which Delete relies on. If the agent fails to start, the entry is removed again and the folder too when still empty.
- **Permissions.** Exactly the new folder is added to the allowed working folders, never the projectless agents folder itself. Sensitive locations (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.claude`) and your home folder itself are refused. Claude Code's own folder trust question is still asked and answered only by you, in the dialog or in Needs you.
- **Changing the location.** Changing the projectless agents folder moves nothing that already exists.

API: `GET`/`PUT /api/agents/projectless`, `POST /api/agents/projectless/preview`, and `POST /api/agents/spawn` with `"projectless": true`.

### Stopping and deleting an agent

Stop and Delete are on the card and in the workspace of an agent **the dashboard started**, and both ask for confirmation first.

- **Ownership.** When the dashboard launches an agent it records the Claude session id it pinned or resumed together with the process id it launched (`managed_agent` table). Only an agent matching both is `dashboardOwned` and can be stopped or deleted; a spawn without a session id (a custom adapter) is owned only while this server run tracks it. Nothing else creates ownership: not being in the scan, being a Claude process, sharing a working folder, the provider, a channel or a live terminal, or the session id alone (a dashboard session later resumed in a terminal is a different process).
- **External sessions.** A session started in a terminal, VS Code or any other application shows **Observe only** and "External session — stop it from the terminal or application that started it." Stop and Delete answer `403` with `"external": true`; no signal is sent and nothing is removed. Its name and icon, which are the dashboard's own data, can still be edited or cleared (`PUT` or `DELETE /api/agents/{pid}/profile`), which never touches the process.
- **Pipeline agents** answer `403` with `"managedBy": "pipeline"`: stop or cancel the task instead.

- **Stop** (`POST /api/agents/{pid}/stop`) ends the running Claude process with SIGTERM, then SIGKILL if it has not exited after five seconds. The session can be resumed later.
- **Delete** (`DELETE /api/agents/{pid}`) removes the agent from Agent Dashboard: its finished card, the dashboard's channel discovery files for it, its saved name and icon, and its ownership record. A running agent is deleted only with `?stop=true`, which the confirmation sends after telling you it will be stopped. Without it, the request fails with `409` and nothing changes.
- **Projectless workspace permission.** When the dashboard created a new projectless workspace for the agent, Delete also removes the one allowed-folder entry it added — only when no other dashboard agent's record uses that folder and the entry is still on the list (`"allowedFolderRemoved"` in the response). Folders are compared by resolved path, never by name; no other entry is changed. Claude Code's own trust record in `~/.claude.json` belongs to Claude and is left as it is.
- **What is never deleted.** Neither action touches the working folder, the repository, Git, a Dashboard Project or the Claude session history.
- **Which agents.** Both work only on a PID the dashboard's current scan knows as an agent. Claude Code's internal processes and sessions on another machine are refused.

### Bringing a session under dashboard control

An agent the dashboard started before ownership was recorded has no `managed_agent` row. Its channel and pty discovery files do not prove that the dashboard launched it, because `agent-dashboard live` writes the same files. Such an agent is therefore external, and so is any other session the dashboard did not launch. None of them is ever claimed automatically.

**Resume under Dashboard** in the agent workspace turns such a session into one the dashboard manages. It never takes over the existing process: the dashboard resumes the same conversation (`--resume`) as a new process it launches, and records that new process as owned. `GET /api/agents/{pid}/control` says whether this is possible. The workspace asks it when it opens and when the agent's state changes, never on a timer. `POST /api/agents/{pid}/resume-under-dashboard` does it after the confirmation.

- **Finished session.** It is resumed; no process is touched.
- **Running session.** Resume is offered only when the process's parent is this server binary's headless pty broker (`<server binary> pty-host`, checked with `ps`) and the session is live-injectable. The dashboard types `/exit` into it, waits up to 20 seconds for it to end, then resumes. If it does not end, the answer is `504` and nothing else changes. No signal is ever sent.
- **Refused.** A running session in a terminal, VS Code or `agent-dashboard live` gets `403` with `"external": true`: stop it where it runs, then resume it here. Owned agents get `409`; pipeline agents get `403`.
- **What carries over.** The resumed agent keeps its transcript, name and icon (keyed by session id). It runs in the same folder with the default permission mode; the original model, system prompt and permission mode are not carried over. It does not count as a projectless workspace the dashboard created, so Delete never removes an allowed-folder entry for it.

## Slash commands

Typing `/` in the prompt input opens a menu with two kinds of command.

**Dashboard commands** are executed by the dashboard itself against its own API — the agent never
sees them:

| Command | Arguments | Needs a linked task |
| --- | --- | --- |
| `/spawn` | `<slug> <description>` | no |
| `/grant` | `<toolName>` | yes |
| `/cancel` | — | yes |
| `/retry` | — | yes |
| `/promote` | — | yes |
| `/help` | — | no |

**Session commands** are everything the connected Claude session itself knows — its built-ins, your
`~/.claude/commands`, project commands, plugin commands, and every installed skill (each skill is
typeable as `/<name>`). They are discovered per session via `GET /api/slash-commands` and forwarded
to the agent verbatim, so what works is whatever that session supports.

Claude's own built-in commands are the one group the dashboard cannot discover — the CLI exposes no
machine-readable listing, so they are curated per version (`CuratedBuiltinsVersion`). When a session
reports a different version, the menu says so on every `/` query — including one that matches no
command at all, which is the case the note exists for: a command missing from the list may still
work if you type it in full. Re-curating means checking both directions — the CLI binary ships a "Recently
changed surfaces" document naming removed and renamed commands, while additions have to come from
the release notes.

Each entry shows its argument template next to the name, read from the command file's
`argument-hint:` frontmatter — `/branch-review` displays `[base-branch] [--apply-fixes]`, for
example. Commands without that key show no template; built-ins never carry one, since they have no
file on disk to read it from.

That template is file content, and the file may belong to an installed plugin rather than to you, so
it is sanitised server-side before it reaches the API: a value that is not valid UTF-8 is dropped,
control characters and Unicode bidi overrides are stripped, and the hint is capped at 120
characters. The menu clips it to 60 characters for display and shows the full value on hover. Treat
a hint as what the command's author suggests you type, not as advice from the dashboard.

## Permissions

Stage agents run with an allow-list derived from `task_permissions` rows. Grants flow through a single validated path (`bulkGrantPermissions`) checked against an allow-list and a dangerous-bash block-list. Permission templates provide quick presets: `feature_implementation`, `research_only`, `test_only`, `review_only`.

Spawned agents request anything missing via the channel's `request_permission` MCP tool — prefer the bulk form so the user grants everything as one batch decision. The full self-service flow is documented in [`.agent-context/permissions.md`](../../.agent-context/permissions.md).

### Answering a permission prompt from the dashboard

By default a session that needs approval stops and asks in its own terminal, and
the dashboard can only watch. The **permission bridge** moves that decision into
the dashboard for any session — including ones you started by hand — by
registering two Claude Code hooks:

```bash
agent-dashboard hooks install
```

That writes the hook script to `~/.claude/dashboard-hooks/` (mode `0700`,
extracted from the binary — nothing needs to stay in a checkout) and registers a
`PreToolUse` and a `Notification` entry in `~/.claude/settings.json` (or
`$CLAUDE_CONFIG_DIR/settings.json`). Existing hooks are kept; re-running the
command rewrites the script and repairs the registered path if the binary moved.
Settings are read when a session starts, so restart anything already running.
`agent-dashboard hooks uninstall` removes the entries that point at that script
and leaves every other hook alone.

`docs/hooks-setup.md` describes registering hooks by hand for the notification
receiver — that is a separate mechanism. `hooks install` manages only the two
entries it wrote — the ones running the script out of `~/.claude/dashboard-hooks/`
— and preserves whatever else is in the file. An entry running your own copy of
the same script from somewhere else is left alone: install refuses rather than
replacing it, and uninstall names it on stderr rather than deleting it.

**Then arm the sessions you want intercepted.** Nothing is held by default: the
`PreToolUse` hook fires *before* Claude Code decides whether to prompt at all, so
holding every call would stall every session on the machine. Click the lock on an
agent's card, or **Intercept next** on a card whose prompt already reached its
terminal. Arming lasts 30 minutes per session.

With it installed:

- Claude Code calls the hook **before** it draws its own prompt. The dashboard
  holds that call open for 25 seconds and shows **Allow** / **Deny** on the
  agent's card in the needs-you band.
- Answering there releases the run immediately. The terminal never prompts.
- If nobody answers in time, the hold lapses and the session falls back to
  asking in its terminal exactly as it does without the bridge — the card then
  reads **Answer in terminal** for up to 15 minutes, which is how long someone
  who stepped away is given before the dashboard stops claiming a prompt is on
  screen.
- The standing rule for future runs is offered beside that only when the bridge
  can name the call the prompt is about, which it can when it held that call.
  The terminal notice fires once when a prompt opens and never when it is
  answered, and the trail's own pending tool call is reconstructed separately —
  so without a name, the rule would be written for whichever tool the trail
  happens to show, not the one on screen.

**Your own deny rules stay the floor.** A hook answering "allow" short-circuits
Claude Code's permission evaluation entirely, deny rules included — so the bridge
checks them first. When a held call is covered by a `permissions.deny` entry in
your user or project `settings.json`, the card shows the rule instead of an
**Allow** button and only **Deny** is offered. The server refuses an allow for
such a call regardless of what the client sends. A rule shape the bridge cannot
parse is treated as a match: it declines to offer rather than release something
it did not understand.

**The bridge is off under `DASHBOARD_AUTH=none`.** That mode drops JWT, leaving
loopback and an `Origin` header any non-browser process sets for itself — so
"a human decided" would reduce to "any local process decided", while a hook
allow short-circuits Claude Code's own evaluation. The arm and respond endpoints
are not mounted at all in that mode. Nothing is held, sessions prompt in their
terminals as they do without the bridge, and the dashboard still reports that
one is waiting there.

The lapse is the important property: the hook answers "no decision", never
"allow". A dashboard that is stopped, slow, or unreachable, a missing secret, a
machine without `curl` — every one of those paths degrades to the behaviour you
have today. Nothing is approved because something failed.

The hook authenticates with the secret in `~/.claude/dashboard-hooks-secret`
(mode `0600`, generated on first boot). It is deliberately not written into
`settings.json`, which is a file people share and check in.

Why hooks rather than ACP or the MCP endpoint: both of those are established
when a session **starts**, so they cannot reach a session that is already
running or one launched outside the dashboard. Hooks are ambient configuration —
a file, not a handshake — which is what makes a foreign terminal session
reachable at all.
