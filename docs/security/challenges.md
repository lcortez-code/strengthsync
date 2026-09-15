# Challenge validation and reward integrity

Strengths Bingo supports the existing 5-by-5 interface. Challenge creation accepts only supported typed rules: grid size 5, one theme per square, and a row/column, diagonal, or full-board win condition. Other challenge types accept only their bounded integer rule fields. Rules are validated again before generating progress from stored data, so legacy or externally modified rule JSON cannot trigger unbounded loops. Existing unsupported boards receive a clear error asking an administrator to create a new challenge.

Bingo square requests use integer coordinates from 0 through 4 and bounded request bodies. Persisted boards must contain exactly five rows of five bounded cells before iteration or mutation. Row/column, diagonal, and full-board win conditions are applied distinctly.

A match requires an ACTIVE member of the same organization and a strength the caller is allowed to view. Ordinary members can match another member's top five; managers, admins, and owners can match the top ten already available under full-profile access. A player still cannot mark themselves. Missing, foreign, inactive, and hidden matches receive the same generic denial. Challenge detail omits other participants' stored boards, which could otherwise expose matching identities from a manager's top-ten checks. Leaderboard participants are restricted to current ACTIVE organization members.

A PostgreSQL row lock serializes updates to each participant's board. Reading progress, marking a square, calculating score, setting first completion, and awarding 50 points occur in one transaction. A conditional `completedAt IS NULL` transition is the sole authority to grant the reward. Repeated or parallel requests cannot repeat it; failure to award points rolls back the board and completion together. Additional completed squares retain the original completion timestamp. Badge processing follows a committed first completion and cannot turn a successful square update into a retryable API failure.

## Local evidence

- `scripts/security/challenges.test.cjs` loads the actual TypeScript handlers with service boundaries replaced. It covers invalid incoming/stored rules, board and coordinate bounds, role-specific rank visibility, generic denials, completion replay, win conditions, and peer-board omission.
- `scripts/security/challenges.integration.cjs` is restricted to disposable loopback PostgreSQL port 55487/database `strengthsync_security`. Real handler/database tests verify thirty simultaneous winning requests yield one success and 50 points, distinct concurrent squares both persist, peer rank-six checks fail while manager checks pass, and a point-write failure rolls the transaction back. Tests create and remove only synthetic fixtures; badge transport is disabled.

These changes are local implementation and validation. They do not establish deployed behavior.
