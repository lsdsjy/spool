# Fork notice

This repository is a personal fork of **`spool-lab/spool`**. Upstream later renamed that
repository to **`paperboytm/spool`**, which is why GitHub shows `paperboytm/spool` as this
fork's parent.

Upstream is the source of truth. This fork carries local changes that upstream does not
ship, plus the tooling needed to build the desktop app that upstream archived. Nothing
here is a pull-request branch; it is "keep my own build working".

## Branches

| Branch                | Base                  | Purpose                                                                                                                                              |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                | upstream `main`       | The fork's development branch: upstream `main` plus every local patch (core, shared packages, and the archived desktop app's source).                  |
| `local/desktop-0.6.3` | upstream tag `v0.6.3` | Same patches, on the last base that can still be packaged. This is the branch that builds and installs `/Applications/Spool.app`.                       |

Why two branches: upstream archived `apps/app` in v0.7.0 — `pnpm-workspace.yaml` excludes
it and the package lost its scripts and packaging dependencies. v0.6.3 is the last release
that can be built, so the desktop work stays on that base while `main` tracks upstream.

The former `local/main` branch was merged into `main` and deleted; the patches are
identical.

## What this fork changes

Core and shared packages:

- **Codex subagent threads are folded into their parent Session.** Codex writes one
  rollout per spawned thread (`session_meta.source.subagent.thread_spawn`). Upstream
  indexed each one as a Session of its own, so a fan-out run appeared as a pile of
  `(no title)` rows. Children are now filtered out of the index and their turns are
  embedded under the parent with a `Codex subagent: @role · /agent/path` header, the same
  shape upstream already uses for OpenCode subagents. Bumps `CODEX_INDEX_VERSION` to
  `codex-v7-fold-subagent-threads`, so the next sync re-derives existing rows.
- **`listRecentSessionsPage` accepts a `sources` filter**, and a new
  `listSessionSourceActivity(db)` returns per-provider Session count and last activity.
- **The Codex provider label reads `Codex`, not `Codex CLI`**, because Codex Desktop,
  `codex-tui`, and `codex_exec` Sessions all land in the same source.

Desktop app (source lives on both branches; only `local/desktop-0.6.3` can build it):

- **Agents section in the sidebar.** One row per provider (`Claude Code`, `Codex`,
  `Gemini CLI`, `OpenCode`, `Pi`), ordered by most recently used, shown above Projects.
  Selecting a row opens that provider's Sessions — across all projects — in the main
  pane (`AgentView.tsx`), with cursor pagination and the owning project on each row.
- **Pi is a first-class source in the app**: label, colour (`#A55A7A` light / `#D88AAA`
  dark, from `packages/ui/src/css/tokens.css`), and a Sources row in Settings.
- Locale files (`sidebar.agents`, `sidebar.sessionCount`, `library.noSessions`) in all
  seven shipped languages.

## Building the desktop app

```bash
git switch local/desktop-0.6.3
pnpm install                      # electron and the agent SDKs are large
# If install retries forever on @openai/codex, onnxruntime-node, or
# claude-agent-sdk-darwin-arm64 (mirrors 302 to a CDN that drops the tarball):
#   printf 'registry=https://registry.npmjs.org/\n' > .npmrc && pnpm install
cd apps/app
pnpm run build:deps               # workspace packages the app bundles
pnpm run build                    # electron-vite build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run package:mac
```

The bundle lands in `apps/app/dist/mac-arm64/Spool.app`. Install it with:

```bash
osascript -e 'quit app "Spool"'
rm -rf /Applications/Spool.app
cp -R apps/app/dist/mac-arm64/Spool.app /Applications/Spool.app
xattr -dr com.apple.quarantine /Applications/Spool.app
open -a /Applications/Spool.app
```

The build is ad-hoc signed, so Gatekeeper treats it as a locally built app. The bundle
identifier stays `com.linkclaw.spool`, which keeps the app reading the same
`~/Library/Application Support/Spool` state and the same `~/.spool/spool.db` index.

Two gotchas worth remembering:

- `vp run build` can serve a stale cache hit. If a core change does not show up, rebuild
  with `cd packages/core && pnpm run clean && pnpm exec tsc`.
- The desktop app and the `spool` CLI share `~/.spool/spool.db`. Only a build that knows
  about a change should write it, so keep both branches' `packages/` in sync when a
  parser or query changes.

## Syncing with upstream

```bash
git remote add upstream https://github.com/paperboytm/spool.git   # once
git fetch upstream
git switch main
git merge upstream/main            # or rebase, main carries local commits
git push fork main
```

For the desktop branch, port the wanted upstream commits onto the v0.6.3 base:

```bash
git switch local/desktop-0.6.3
git cherry-pick <commits>
```

Expect conflicts in `packages/session-kit/src/messages.ts` around the Codex parser when
upstream touches it; this fork's hunks are all in the Codex section.
