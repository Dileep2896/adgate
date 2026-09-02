You are one iteration of an autonomous build loop for the adgate repository.

Steps, in order:
1. Read CLAUDE.md, prd.json, and progress.txt. Skim docs/api.md, docs/policy.md, docs/audit.md. Read docs/BUILD_GUIDE.md only for the section relevant to the story you pick.
2. Choose exactly one story from prd.json: the lowest `priority` number where `passes` is false and every id in `dependsOn` has `passes` true. If none qualifies, print <promise>COMPLETE</promise> and stop.
3. Print the chosen story id and title.
4. Implement the story completely. Write failing tests first, then the implementation. Satisfy every line of `acceptanceCriteria`. No stubs, no placeholder TODOs.
5. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`. Fix until green. If the story needs Postgres, run `docker compose up -d postgres` first and wait for it to be healthy.
6. When green: set `passes` to true for that story in prd.json (edit the JSON precisely, keep formatting), append an entry to progress.txt using the format at the top of that file (what you built, decisions, gotchas the next iteration must know), then `git add -A && git commit -m "feat(<story id>): <story title>"`.
7. Stop. Do not begin another story.

Rules:
- If you cannot complete the story after a genuine attempt, do not mark it passed and do not commit broken code. Revert uncommitted changes with `git checkout -- . && git clean -fd`, append `NEEDS HUMAN: <story id> <reason>` to progress.txt, commit only progress.txt, and stop.
- Never edit docs/api.md, docs/policy.md, docs/audit.md, or the meaning of the schemas they describe. If a story appears to require it, treat it as NEEDS HUMAN.
- Keep the story's scope. Improvements outside it go in progress.txt under "Ideas", not in code.
- Prefer boring, explicit code over clever abstractions.
