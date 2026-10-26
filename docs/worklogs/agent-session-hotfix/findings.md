# Findings
- New session e6838deb... has no Runs; older session 9069e917... has the account's only unfinished Run965f6085... awaiting manual review, spent1/reserved12.
- Generic HTTP409 UI text masks AGENT_RUN_ACTIVE. submit retains pending even for deterministic rejection; history selection blocks on pending, producing an empty-session trap.
- Existing service cancel preserves billing/history/holds; close marks closed_at but does not delete. Default UI currently shows closed sessions and may restore closed local session IDs.
- User explicitly asked to remove all prior Agent tasks first. Scope is this account's Agent history, not other users, projects, generated assets or ledger records. Use reversible archive, not hard delete.
