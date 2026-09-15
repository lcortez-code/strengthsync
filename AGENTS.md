# Repository guidance

## Issue tracking

- This repository uses `bd` (Beads). When `.beads/` is present, run `bd prime` before issue-tracking work.
- Use `bd ready --json` to find unblocked work, `bd update <id> --status in_progress --json` to claim it, and `bd close <id> --reason "Done" --json` when complete.
- Record newly discovered work with `bd create ... --deps discovered-from:<parent-id> --json`.
- Do not duplicate Beads issues in a second tracking system.
- If the user authorizes a commit, include the corresponding `.beads/issues.jsonl` update with the code change.
- Commit, push, and remote synchronization require explicit authorization.

## Documentation

- Keep durable documentation near the code it describes.
- Create temporary planning notes only when they help the current task; keep them out of the repository root.
