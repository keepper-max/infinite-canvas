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

## Production delivery
- Runtime v0.16.48, immutable code/tag958d26a5f562a69dbffa66d4c57510c726d27566. Main and tag pushed. Initial code0d63229 retained without rewrite; published website v0.16.47/tag4f23198 preserved.
- API and Web built from git archive. Archive SHA2561f395fdd8bd035747498036db0294413019699c872b1bd324d3f0e421f12cac4.
- API/normal Worker/Agent Worker image sha256:7f1dd03f319bb31a75c04514f51bc4440270516cfd5bf4b8a72712007009de79; Web image sha256:efb83c4f15522f273633f082b5f38eb5e90192d57922c1c1254bda51d23d8048.
- Candidate ran on Linux Node22.23.3. Frozen LF migration replay no-op in restored PostgreSQL; production49 records unchanged. No new migrations or dependencies.
- Formal maintenance policy and queue pause restored after API, normal Worker, Agent Worker and Web became healthy. Policy version28; defaults, model selection and all budgets unchanged. Original before images and compose retained.
- 9 production browser/API checks passed,0 page errors: independent website SHA, backend/model/limits, no account unfinished Run, archived history retained, fresh session free of false conflict, composer enabled without submit, archives hidden by default, explicit archive navigation with draft intact, anonymous discovery denied.
- Public homepage hash remains04f70aa9247547fdb3cd1791e08cd5f5682521f4e1e0e184d25a786cbf95eef0. No public nginx/site update or homepage replacement by this hotfix.
- Retained14 tasks,24 messages,all10 old sessions closed (9 newly archived),0 unfinished tasks. Original cancelled task still spent1/reserved12; no ledger/job/message mutations or credit release. No paid model calls.
- Protected canvas29 nodes/27 edges/revision7 and hashfd63cd2a088d380860adcb261d3fd7403b7b00a175f3a67cce45a9baad47eccd unchanged. Queue healthy, DB lock waits0, import service active.
- Release record /opt/infinite-canvas-releases/session48-958d26a5f562/deployment-final.json and current/runtime-release48.json. Read-only acceptance session revoked. Isolated restore containers stopped/data retained; own local Vite and PG stopped cleanly after tests.
- Remaining follow-up: original supplier charge still requires exact administrator association; archive does not manufacture a response, claim refund, remove12-point hold or automatically rerun anything. User must explicitly send a fresh request after reviewing retained draft.
