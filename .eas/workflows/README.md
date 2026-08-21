# Clarity agentic workflows — TestFlight feedback in, verified fix PR out

Two entry points, one fix loop:

- **TestFlight autofix** (`testflight-autofix.yml`): a tester submits
  crash or screenshot feedback and one EAS Workflows run carries it all
  the way to a PR — triage the feedback into a GitHub issue, reproduce it
  on an [EAS Simulator](https://docs.expo.dev/), fix, verify on a second
  simulator session, open a PR with screenshots and both session videos.
- **Manual** ("tag an issue, get a fix"): label any GitHub issue `repro`
  and the same fix loop runs via agent-fix.yml.

A human reviews and merges; agents never merge.

## The loop

```
TestFlight tester submits crash/screenshot feedback
   │  testflight-autofix.yml — fired by the App Store Connect
   │  beta_feedback event. testflight-sweep.yml — the same job on a
   │  daily 13:00 UTC cron (and `eas workflow:run` for manual/testing);
   │  split files because EAS rejects ${{ app_store_connect.* }} env
   │  on non-ASC triggers
   │
   │  step 1 — triage agent (.agents/triage-prompt.md):
   │    fetch via `eas testflight:feedback`, dedupe by the
   │    TestFlight-Feedback-IDs footer, cluster + score, file at
   │    most ONE issue labeled `testflight`, write the issue number
   │    to TRIAGE_ISSUE_NUMBER (speech-dependent reports get
   │    `needs-human` and stop — the simulator has no microphone)
   │
   │  step 2 — fix agent (.agents/fix-prompt.md), same run:
   ▼
fix loop (also reachable via: human labels an issue `repro`
   │        → .github/workflows/agent-repro-dispatch.yml
   │        → agent-fix.yml)
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

The device work uses `eas simulator:*` + `agent-device` — plain shell
commands, no MCP, no macOS worker.

The autofix design follows brentvatne/euxy (crash-triage.yml +
feedback-triage.yml): the `beta_feedback` trigger with its
`${{ app_store_connect.* }}` context, and `eas testflight:feedback` for
the content (the ASC API key comes from the EAS credentials service, so
no ASC secrets live in this repo). The autofix issue is labeled
`testflight`, NOT `repro` — `repro` would fire the GitHub bridge and
dispatch a duplicate fix run.

Autofix one-time setup, on top of the setup below:

1. **No new secrets.** The existing `production` env vars cover it:
   `GITHUB_TOKEN` (issue writes), `EXPO_TOKEN` (eas-cli + the stored ASC
   key), `CLAUDE_CODE_OAUTH_TOKEN`.
2. **ASC event trigger**: connect App Store Connect in the EAS dashboard
   project settings, or the `beta_feedback` trigger never fires. The
   daily cron still sweeps screenshot feedback without it, but crashes
   are only fetchable by submission id from the event context.
3. Crons only run from the default branch, so the workflow must be on
   `main`.
4. Manual run: `eas workflow:run .eas/workflows/testflight-sweep.yml`
   (the autofix file only accepts the ASC event trigger).

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
