#!/usr/bin/env bash
# Human in the loop: run a single iteration interactively so you can watch and intervene.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
claude "$(cat scripts/ralph/prompt.md)"
