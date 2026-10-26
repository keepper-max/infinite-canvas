# Progress
## Scoped production cleanup (user explicitly requested removal first)
- Backup /opt/infinite-canvas-backups/as47-20261026T052828Z; 95 tables restored and matched, 1660 objects / 4,039,884,014 bytes matched content and metadata.
- Actor snapshot extracted from restore, hash04cec9dd2f442c46a76255be9946b44f6ed28342e45e489a0c9376992c987a7b; matched live state under native-agent-start account lock before any mutation.
- Formal cancel/close services: cancelled1 awaiting-manual-review Run; archived9 previously open sessions. All10 prior sessions now closed. Retained14 Runs,24 messages and all invoices/usage. No hard delete, inference, queue submission or automatic credit release.
- Full financial/job/message comparisons unchanged. Account balance23960 and reserved12 retained. Targeted backup and admin audit kept for review; archived data remains readable rather than physically deleted.
## Implementation
- AGENT_RUN_ACTIVE / AGENT_SESSION_CLOSED release only the rejected UI outbox lock, preserve current input, and give specific explanations. Network/idempotency uncertainty is never treated as known rejection.
- Authenticated read-only active-run endpoint returns only the caller's task; inaccessible/deleted projects disclose no identifiers, disabled accounts denied.
- History switching remains available with an unknown request; cross-session re-submission blocked. Explicit navigation queries fresh authorization and saves current drafts first.
- Closed legacy pending requests are retired only after confirming the server session is closed. Archive hidden by default with explicit read-history entry.
- Pending retries display the original model/mode/budget. In-flight new input survives success/rejection/unknown response; async updates remain scoped to current project.
## Actual verification
- Real PostgreSQL + HTTP reproduced the original409 AGENT_RUN_ACTIVE, zero new Run or enqueue.
- 46 automated regression tests passed, 0 skipped. Includes genuine PostgreSQL/HTTP job and billing/receipt recovery, conversation, permissions, provider pricing and strict protocol.
- 7 Playwright checks passed, 0 page errors: typed409 with in-flight edited draft, direct old-task navigation, closed legacy pending restore, reload draft recovery, archive visibility, unknown response identity/history navigation, lost response recovery without duplicate enqueue/model call.
- Final narrow real PostgreSQL/browser rerun after preserving original pending budget and latest draft passed. No paid supplier calls.
- Test setup corrections: local PG was stopped and needed recovery; initial config lacked test storage fields. Snapshot export used incorrect sources table/model binding key and initially emitted two psql columns; fixed against actual migrations and JSON envelope before any cleanup mutation. First reload assertion ran before draft hydration; test now awaits readiness. One wrong-directory test command was rerun with the existing local runner. Errors did not pass as successful checks.
- TODO reviewed: existing manual invoice association follow-up remains; no new unrelated tasks or UI changes. Website workspace edits retained.

## Release identity
- Parallel website release already published v0.16.47 (tag4f23198). Initial hotfix commit0d63229 remains in history without amendment; this hotfix is released as v0.16.48. Existing website/version tag and its public homepage remain intact. No force push or tag replacement.
