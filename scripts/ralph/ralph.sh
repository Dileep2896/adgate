#!/usr/bin/env bash
# Ralph loop for adgate: runs Claude Code repeatedly, one story per fresh session.
# Usage: scripts/ralph/ralph.sh [max_iterations]
# Env:   RALPH_MODEL (optional, e.g. sonnet or opus), RALPH_DRY_RUN=1 to print the prompt and exit.
# Check `claude --help` if any flag below has changed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MAX=${1:-30}
PROMPT_FILE="scripts/ralph/prompt.md"
LOG_DIR=".ralph/logs"
mkdir -p "$LOG_DIR"

command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }

remaining() { jq '[.stories[] | select(.passes==false)] | length' prd.json; }

if [[ "${RALPH_DRY_RUN:-}" == "1" ]]; then cat "$PROMPT_FILE"; exit 0; fi

last_commit=$(git log -1 --format=%H 2>/dev/null || echo none)

for i in $(seq 1 "$MAX"); do
  left=$(remaining)
  if [[ "$left" -eq 0 ]]; then echo "All stories complete."; exit 0; fi
  if tail -n 5 progress.txt | grep -q "^NEEDS HUMAN:"; then
    echo "progress.txt has a NEEDS HUMAN entry in the last 5 lines. Resolve it, then rerun."; exit 2
  fi

  ts=$(date +%Y%m%d-%H%M%S)
  log="$LOG_DIR/iter-$i-$ts.log"
  echo "=== Iteration $i of $MAX ($left stories left) -> $log"

  model_flag=()
  [[ -n "${RALPH_MODEL:-}" ]] && model_flag=(--model "$RALPH_MODEL")

  # -p runs Claude Code non-interactively with the given prompt. CLAUDE.md is loaded automatically.
  # --dangerously-skip-permissions lets it edit and run commands without prompting.
  # Only run this in a repo you can reset, ideally in a container or a throwaway clone.
  claude -p "$(cat "$PROMPT_FILE")" --dangerously-skip-permissions ${model_flag[@]+"${model_flag[@]}"} 2>&1 | tee "$log" || true

  if grep -q "<promise>COMPLETE</promise>" "$log"; then echo "Loop reported completion."; exit 0; fi

  # Safety: if the iteration produced no commit, stop so a human can look.
  now=$(git log -1 --format=%H 2>/dev/null || echo none)
  if [[ "$now" == "$last_commit" ]]; then
    echo "No commit was made in iteration $i. Inspect $log and progress.txt."; exit 3
  fi
  last_commit=$now
done
echo "Reached max iterations ($MAX). $(remaining) stories left."
