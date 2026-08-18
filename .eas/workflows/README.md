# Clarity agentic workflows — "Tag an issue, get a repro"

Label a GitHub issue `repro` and agents do the rest: one reproduces the bug
on an iOS simulator and posts the evidence to the issue; on a confirmed
repro, a second one writes the fix and opens a PR. No Sentry, no external
services — the GitHub issue is the source of truth and the reporting
surface.

## The loop

```
issue labeled `repro`
        │  (.github/workflows/agent-repro-dispatch.yml — thin GH Action bridge)
        ▼
agent-repro.yml (EAS, macOS worker)
        │  headless Claude Code + Argent drives the simulator
        │  → issue comment: steps, screenshots, crash log, suspect
        │  reproduced?
        ▼
agent-triage.yml (EAS)
        │  headless Claude Code: root cause → minimal fix → tests
        ▼
PR labeled `agent-fix` (human reviews and merges)
```

## Workflows

| File | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/agent-repro-dispatch.yml` | issue labeled `repro` | Acknowledges on the issue, then dispatches `agent-repro.yml` on EAS. (EAS has no issue-label trigger today, so this bridge exists.) |
| `agent-repro.yml` | dispatch | Finds the latest `simulator`-profile build, boots a simulator on a macOS worker, and a headless Claude Code agent (driving [Argent](https://github.com/software-mansion/argent) via MCP) walks the reported path. Posts evidence to the issue: numbered steps, inline screenshots (pushed to an orphan `agent/repro-issue-<n>` branch), crash log, suspected code path, confidence. On a confirmed repro it dispatches `agent-triage.yml`. |
| `agent-triage.yml` | dispatch (by repro, or manually) | Headless Claude Code: reads the issue + repro evidence → root cause → minimal fix per `AGENTS.md` → `bun run test` (+ a regression test when the bug is in testable logic) → PR labeled `agent-fix` that `Fixes #<issue>`. |
| `pr-preview-update.yml` | PR labeled `preview-approved` | Pre-existing: scan-only PR preview publish. |

Agent prompts live in `.agents/repro-prompt.md` and `.agents/triage-prompt.md`.

## One-time setup

1. **GitHub repo secret**: `EXPO_TOKEN`
   ([robot access token](https://expo.dev/settings/access-tokens)).
2. **EAS `production` environment variables**:
   - `CLAUDE_CODE_OAUTH_TOKEN` — run `claude setup-token` locally (valid one
     year). Do NOT also set `ANTHROPIC_API_KEY` there; it takes precedence
     and bills the API instead of the subscription.
   - `GITHUB_TOKEN` — fine-grained PAT for `SchroederNathan/clarity` with
     Issues (read/write), Contents (read/write), Pull requests (read/write).
   - `EXPO_TOKEN` — same robot token; lets the repro job dispatch triage.
3. **Labels**: `gh label create repro --color 1D76DB` (the `agent-fix`
   label is created by the triage agent on first run).
4. **Seed one simulator build** (the repro workflow reuses the latest):
   `eas build --platform ios --profile simulator`
   Rebuild whenever the bug you want reproduced lands in `main`.

## Constraints worth knowing

- The simulator has no microphone, so issues that need real speech can only
  be reproduced up to the recording screen (the agent reports `partially`).
  Library, passage editor, analytics, and history are fully drivable.
- The evidence screenshots render inline in issue comments because the repo
  is public (raw.githubusercontent.com URLs). For a private repo they would
  degrade to links plus the uploaded workflow artifact.

## Running a demo take

1. Make sure the demo bug is on `main` and the seed simulator build is
   fresh (step 4 above).
2. File the issue as a user would: *"App crashes when I save a custom
   passage. I pasted my speech, tapped Save to Library, and the app died."*
3. Add the `repro` label. That is the entire human action — record from
   here.
4. Watch: the issue gets the ack comment → the EAS run appears →
   simulator evidence lands on the issue → the `agent-fix` PR opens.
5. Manual re-runs, if a take needs them:
   `eas workflow:run .eas/workflows/agent-repro.yml -F issue_number=<n>`
   (delete the `agent/repro-issue-<n>` and `agent/fix-issue-<n>` branches
   and the agent comments between takes).
