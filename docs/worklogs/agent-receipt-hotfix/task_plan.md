# Plan — implementation and isolated review complete
- [x] Save supplier identity on response headers; record safe checkpoint timestamps/failure stage/code. Diagnostics do not turn a successful result into a failure.
- [x] Coalesce text only while persistence is busy; drain in success/failure paths. No new timers, retry, context or concurrency limits.
- [x] Query original supplier ledger through the authenticated reconcile API; show loading, disable duplicate clicks, provide clear results and network recovery. Prefer local durable recovery over supplier network.
- [x] Add explicit confirmation to end a manual-review task without releasing uncertain reservations, deleting history or restarting inference.
- [x] Isolated PostgreSQL + HTTP supplier, regression tests, browser clicks, and second review complete.
- [x] User explicitly approved commit/push/deploy; v0.16.46 is live. Production readonly browser checks passed; paid provider tests were not run.
