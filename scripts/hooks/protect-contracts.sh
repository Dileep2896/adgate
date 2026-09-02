#!/usr/bin/env bash
# PreToolUse hook: blocks Edit/Write on the contract docs. Exit code 2 tells Claude Code to block the tool call.
# Verify the hook input shape against https://docs.claude.com/en/docs/claude-code/hooks if this stops working.
input=$(cat)
path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')
case "$path" in
  *docs/api.md|*docs/policy.md|*docs/audit.md)
    echo "Blocked: $path is a contract document. Write NEEDS HUMAN in progress.txt instead." >&2
    exit 2 ;;
esac
exit 0
