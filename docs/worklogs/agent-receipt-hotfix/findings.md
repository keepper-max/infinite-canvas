# Findings
- Unknown second round aborted at existing 60-second whole-round deadline. Pricing/ledger preflight shares the deadline. Exact transport stage was not persisted.
- First round emitted 216 events with one awaited transaction per delta. Receipt identity persisted only on successful protocol completion.
- Reconcile checks existing local artifacts; it does not query supplier. Supplier billed entry without exact persisted request identity must not be matched by time/amount.
- Existing unrelated website and shared progress changes must be preserved. No migration or limit changes planned.
