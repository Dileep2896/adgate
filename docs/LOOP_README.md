# Running the build loop

## Files the loop uses

- `prd.json`: 40 stories with dependencies and acceptance criteria. The loop marks `passes: true` as it goes.
- `progress.txt`: the only memory between iterations besides git. Read the last few entries before intervening.
- `scripts/ralph/prompt.md`: the per iteration prompt passed to `claude -p`.
- `scripts/ralph/ralph.sh`: the loop. `ralph-once.sh` runs one interactive iteration.
- `CLAUDE.md`: loaded automatically by every Claude Code session.
- `.claude/settings.json`: permission allowlist plus a PreToolUse hook that blocks edits to the contract docs.
- `docs/BUILD_GUIDE.md`: the long form design. Stories reference it; the loop reads only the relevant section.

## First run

```bash
git init && git add -A && git commit -m "chore: adgate starter kit"
git checkout -b ralph/adgate-mvp
pnpm install || true          # S01 will finish the workspace setup
docker compose up -d postgres
cp .env.example .env
scripts/ralph/ralph-once.sh   # watch S01 happen interactively
```

Then switch to the loop:

```bash
scripts/ralph/ralph.sh 10     # ten iterations at a time; review between batches
```

## When to step in

- The loop exits with "NEEDS HUMAN": read the last entry in progress.txt, fix or clarify the story in prd.json, delete the NEEDS HUMAN line, rerun.
- An iteration made no commit: open the log in .ralph/logs, usually a test that could not pass or a missing env var.
- A story passed but the code is wrong: revert the commit, tighten the acceptance criteria, set passes back to false, rerun.

## Review cadence that works

After S05, S08, S15, S18, S25, S35: stop the loop and read the code yourself. Those are the stories where a wrong turn is expensive. Spawn a reviewer in an interactive session:

```
Spawn a reviewer subagent. Read the diffs for the last three commits, check them against CLAUDE.md non-negotiables and docs/api.md, and list concrete problems with file and line references. No praise.
```

## Safety

`ralph.sh` runs Claude Code with `--dangerously-skip-permissions`. Run it in a clone you can throw away or inside a container. Never point it at a repo with credentials in the working tree.
