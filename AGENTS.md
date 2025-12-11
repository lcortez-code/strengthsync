# Repository guidance

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd dolt push` - Push beads to remote

For full workflow details: `bd prime`

- Use `bd update <id> --status in_progress --json` to claim work.
- Record newly discovered work with `bd create ... --deps discovered-from:<parent-id> --json`.
- Do not duplicate Beads issues in a second tracking system.
- If the user authorizes a commit, include the corresponding `.beads/issues.jsonl` update with the code change.
- Commit, push, and remote synchronization require explicit authorization.

## Documentation

- Keep durable documentation near the code it describes.
- Create temporary planning notes only when they help the current task; keep them out of the repository root.
