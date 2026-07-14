# Issue Tracking

StrengthSync uses **bd (beads)** to track work, dependencies, and completion. Run `bd prime` for the current workflow.

## Common commands

```sh
bd ready --json
bd create "Title" --type task --priority 2 --json
bd update <id> --status in_progress --json
bd show <id> --json
bd close <id> --reason "Done" --json
```

Use Beads as the sole issue tracker. Link newly discovered work to its parent with `--deps discovered-from:<parent-id>`.

When a commit is authorized, include the corresponding `.beads/issues.jsonl` update with the code change. Remote synchronization with `bd dolt push` requires authorization.

Local database files, credentials, caches, and worktree redirect files are excluded by [.gitignore](.gitignore).
