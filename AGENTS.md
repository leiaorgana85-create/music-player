## Canonical source and anti-patchwork release policy (owner: 2026-11-12)

This policy applies to every Lexi app and its backend, not just this repository.

- **One code authority:** the reviewed, tested source in this app's canonical GitHub repository. Include Apps Script `appsscript.json` and every source/HTML file in version control. Never create independent production-only changes in the Apps Script editor or live Pages that are missing from GitHub.
- **No patchwork:** reconcile contradictory implementations and data contracts into one complete, coherent change; preserve previously accepted behavior and resolve all discrepancies before deployment. Prefer complete files and tests over isolated pasted fragments.
- **Two distinct release gates:** (1) source/tests on the exact commit; (2) deployed source/version and observed behavior in the real app. A passing GitHub Action or edited Apps Script file alone is not a live release.
- **Drift is a release blocker:** compare the live editor project to the approved source (file inventory and exact content/hash) before making further changes. If different, identify why and reconcile without silent overwrites or a blind copy.
- **One active production endpoint:** track the actual deployment ID and URL; coordinate frontend references and backend version together. A former endpoint can remain temporarily for verified rollback but is not a second production authority.
- **Protect user state:** never rotate credentials, clear browser storage/outbox, mutate production data with synthetic test entries, remove existing features or change app identity as part of a sync fix. Keep secrets in private project configuration, never commit them.
- **Completion proof:** record source commit, passing checks, exact deployed version/endpoint, and post-release behavior evidence. Report unverified steps explicitly; do not describe a staged or unverified change as deployed.
