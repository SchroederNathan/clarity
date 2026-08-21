#!/usr/bin/env bash
# The TestFlight fix queue, serialized by a lock. Two subcommands, one per
# workflow job, so the queue shows as separate nodes in the EAS workflow
# graph (testflight-autofix.yml / testflight-sweep.yml):
#
#   claim — acquire the lock and claim the oldest `testflight-queued`
#           issue. Emits `set-output issue_number <n>` (empty when the
#           queue is empty or another run holds the lock). Holds the lock
#           on success; the fix job releases it.
#   fix   — run the fix agent (.agents/fix-prompt.md) on $ISSUE_NUMBER.
#           On agent failure: label `needs-human`, comment, continue.
#           Always releases the lock, then dispatches a sweep run if the
#           queue still has work (the chain).
#
# The lock is the git ref refs/heads/agent-fix-lock, created atomically
# via the GitHub API (422 if it exists). Its commit's committer date is
# its creation time; locks older than STALE_HOURS are stolen — that is
# the recovery path when a fix job's VM dies while holding it.
#
# Env: GITHUB_TOKEN (req). fix also needs CLAUDE_CODE_OAUTH_TOKEN (via
# claude), EXPO_TOKEN (chain dispatch), ISSUE_NUMBER, and node_modules
# installed. WORKFLOW_URL is optional, for the lock message and comments.
# Expects `gh`, `node`, `npx` on PATH; `claude` for fix.
set -euo pipefail

REPO="SchroederNathan/clarity"
LOCK_REF="agent-fix-lock"
STALE_HOURS=3
export GH_TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN is required}"

api() { gh api "$@"; }

ensure_labels() {
  gh label create testflight-queued --repo "$REPO" --color 1D76DB --description "TestFlight report waiting for the fix agent" 2>/dev/null || true
  gh label create testflight --repo "$REPO" --color 0E8A16 --description "TestFlight report claimed by the fix agent" 2>/dev/null || true
  gh label create needs-human --repo "$REPO" --color D93F0B --description "Automation could not handle this" 2>/dev/null || true
}

lock_age_hours() { # $1 = lock commit sha
  local created
  created=$(api "repos/$REPO/git/commits/$1" --jq .committer.date)
  node -e 'console.log(Math.floor((Date.now() - Date.parse(process.argv[1])) / 3600000))' "$created"
}

make_lock_commit() {
  local head_sha tree_sha
  head_sha=$(api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
  tree_sha=$(api "repos/$REPO/git/commits/$head_sha" --jq .tree.sha)
  api "repos/$REPO/git/commits" \
    -f message="agent-fix lock: ${WORKFLOW_URL:-manual run}" \
    -f tree="$tree_sha" -f "parents[]=$head_sha" --jq .sha
}

acquire_lock() {
  local lock_sha cur age
  lock_sha=$(make_lock_commit)
  if api "repos/$REPO/git/refs" -f ref="refs/heads/$LOCK_REF" -f sha="$lock_sha" >/dev/null 2>&1; then
    return 0
  fi
  cur=$(api "repos/$REPO/git/ref/heads/$LOCK_REF" --jq .object.sha 2>/dev/null) || return 1
  age=$(lock_age_hours "$cur")
  if [ "$age" -ge "$STALE_HOURS" ]; then
    echo "▸ Stealing stale lock (${age}h old)"
    api -X DELETE "repos/$REPO/git/refs/heads/$LOCK_REF" >/dev/null 2>&1 || true
    api "repos/$REPO/git/refs" -f ref="refs/heads/$LOCK_REF" -f sha="$lock_sha" >/dev/null 2>&1 && return 0
  fi
  return 1
}

release_lock() {
  api -X DELETE "repos/$REPO/git/refs/heads/$LOCK_REF" >/dev/null 2>&1 || true
}

oldest_queued() {
  gh issue list --repo "$REPO" --label testflight-queued --state open \
    --json number --jq '[.[].number] | min // empty'
}

cmd_claim() {
  ensure_labels
  if [ -z "$(oldest_queued)" ]; then
    echo "▸ Queue is empty; nothing to claim."
    set-output issue_number ""
    return 0
  fi
  if ! acquire_lock; then
    echo "▸ Another run holds the fix lock. It chain-drains the queue; nothing to do."
    set-output issue_number ""
    return 0
  fi
  local issue
  issue="$(oldest_queued)"
  if [ -z "$issue" ]; then # drained between the check and the lock
    release_lock
    set-output issue_number ""
    return 0
  fi
  echo "▸ Claimed issue #$issue from the queue (lock held for the fix job)"
  gh issue edit "$issue" --repo "$REPO" --add-label testflight --remove-label testflight-queued
  set-output issue_number "$issue"
}

cmd_fix() {
  : "${ISSUE_NUMBER:?ISSUE_NUMBER is required for fix}"
  trap release_lock EXIT
  if ! claude -p "$(cat .agents/fix-prompt.md)" \
    --dangerously-skip-permissions \
    --max-turns 120 \
    --output-format json; then
    echo "▸ Fix agent failed on #$ISSUE_NUMBER; flagging for a human"
    gh issue comment "$ISSUE_NUMBER" --repo "$REPO" \
      --body "Automated fix run failed (${WORKFLOW_URL:-see workflow logs}). Leaving this for a human. — clarity fix agent" || true
    gh issue edit "$ISSUE_NUMBER" --repo "$REPO" --add-label needs-human || true
  fi
  release_lock
  trap - EXIT
  if [ -n "$(oldest_queued)" ]; then
    echo "▸ Queue still has work; chaining a sweep run"
    npx --yes eas-cli@latest workflow:run .eas/workflows/testflight-sweep.yml --non-interactive || \
      echo "▸ Chain dispatch failed; the cron sweep will pick the queue up"
  fi
  echo "▸ Drain complete"
}

case "${1:-}" in
  claim) cmd_claim ;;
  fix) cmd_fix ;;
  *) echo "usage: $0 claim|fix" >&2; exit 1 ;;
esac
