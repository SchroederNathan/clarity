# Clarity agentic workflow — "Tag an issue, get a fix"

Label a GitHub issue `repro` and one agent does the whole loop inside a
single EAS Workflows job: it reproduces the bug on an
[EAS Simulator](https://docs.expo.dev/), posts the evidence to the issue,
writes the minimal fix, verifies it on a second simulator session, and
opens a PR with before/after screenshots and links to both session videos.
A human reviews and merges.

## The loop

```
issue labeled `repro`
   │  .github/workflows/agent-repro-dispatch.yml
   │  (thin bridge — EAS has no issue-label trigger yet)
   ▼
agent-fix.yml — ONE EAS Workflows job (Linux), ONE agent
   │ 1. read the issue
   │ 2. EAS Simulator session: install latest simulator build, repro, screenshots
   │ 3. issue comment: steps + observations + ▶ session video link
   │ 4. minimal fix per AGENTS.md + `bun run test`
   │ 5. eas build --profile simulator (fix build)
   │ 6. second EAS Simulator session: verify the fix, screenshots
   ▼
PR labeled `agent-fix`
   Fixes #N · root cause · before/after screenshots
   ▶ repro video · ▶ verified-fix video
```

The agent prompt is `.agents/fix-prompt.md`. The device work uses
`eas simulator:*` + `agent-device` — plain shell commands, no MCP, no
macOS worker.

## One-time setup

1. **GitHub repo secret**: `EXPO_TOKEN`
   ([robot access token](https://expo.dev/settings/access-tokens)).
2. **EAS `production` environment variables**:
   - `CLAUDE_CODE_OAUTH_TOKEN` — `claude setup-token` (do NOT also set
     `ANTHROPIC_API_KEY`; it takes precedence and bills the API).
   - `GITHUB_TOKEN` — fine-grained PAT for `SchroederNathan/clarity`:
     Issues, Contents, Pull requests (read/write).
   - `EXPO_TOKEN` — same robot token, for simulator sessions and the
     verification build.
3. **Label**: `gh label create repro --color 1D76DB`.
4. **Seed one simulator build** (the repro installs the latest finished
   one): `eas build --platform ios --profile simulator`. Rebuild whenever
   the bug you want reproduced lands on `main`.
5. EAS Simulator must be enabled on the account
   (`npx --yes eas-cli@latest simulator:availability --json`).

## Constraints worth knowing

- The cloud simulator has no microphone: issues needing real speech get a
  partial repro (up to the recording screen) and no automated fix.
- Screenshots render inline in the PR because the repo is public
  (raw.githubusercontent.com URLs from the fix branch).
- The run takes ~25–40 minutes end to end; the fix-verification EAS build
  is most of it.

## Running a demo take

1. Demo bug is on `main` and the seed simulator build is fresh.
2. File the issue as a user would: *"App crashes when I save a custom
   passage. I pasted my speech, tapped Save to Library, and the app died."*
3. Add the `repro` label. That is the entire human action.
4. Watch: ack comment → EAS run → repro session (video on expo.dev) →
   evidence comment on the issue → fix build → verification session →
   `agent-fix` PR with screenshots and both video links.
5. Manual dispatch, when a take needs a re-run:
   `eas workflow:run .eas/workflows/agent-fix.yml -F issue_number=<n>`
   Between takes: delete the agent comments, the `agent/fix-issue-<n>`
   branch, and close the test issue.
