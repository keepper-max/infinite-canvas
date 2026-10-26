# Agent receipt hotfix
## Runtime files
- server/api/src/native-agent/{paid-model.ts,model.ts,stream-sink.ts,service.ts}
- server/api/src/billing-service.ts
- web/src/components/native-agent/native-agent-panel.tsx
- web/src/services/api/native-agent.ts
## Tests and browser harness
- server/api/tests/agent-receipt-hotfix{.test.ts,.integration.test.ts}
- server/api/tests/native-agent-model-jobs.integration.test.ts (local recovery must bypass supplier outage)
- server/api/scripts/agent-receipt-browser.mjs
## Documents
- CHANGELOG.md, docs/content/docs/progress/{pending-test,todo}.mdx
- docs/worklogs/agent-receipt-hotfix/{task_plan,findings,progress,delivery}.md
## Release scope
Web, API and Agent Worker must carry this patch; the ordinary Worker should use the same backend image for consistent billing helpers. No schema migration, dependency addition, MCP change, pricing/policy change, timeout increase, original document/asset/canvas change.
Build candidate from selected task files only. Exclude unrelated website edits. Preserve existing immutable artifacts and environment references, then follow the existing backup/health/drain release procedure. No live paid retry without explicit authorization.
## Safe rollback
Stop new Agent writes before replacing services; retain original runs, supplier IDs, ledger rows and reservations. Feature/config rollback must not guess free usage or replay unknown submissions. Avoid removing trace data. No DB rollback or old direct-write MCP reopening.
## Remaining limitations
The original production request has no persisted supplier identity/full response. A time-and-amount match is insufficient for automatic settlement or restoration. Ending it is a separate explicit user action and retains outstanding holds. Supplier availability and production deadline behaviour were not retested with a paid model.

## Actual release result
v0.16.46 is live at https://shoumiren.online. Code 04849e46b0700fdc7ac056db82bb7bea1b3191bc and tag pushed; detailed artifacts, backup and production verification are in progress.md. No production DB migration or paid model verification. The original uncertain task is intentionally retained for user/admin review, with explicit end-task confirmation available on the new frontend.
