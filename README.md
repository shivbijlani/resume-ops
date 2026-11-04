# Opportunity workspace public view

This repository serves a data-free, read-only dashboard. The eight deployment
assets are `index.html`, `dashboard.css`, `local-loader.css`, `view.js`,
`local-loader.js`, `workflow.svg`, `workflow.mmd` and `.nojekyll`. Private files
are read only after the user selects a folder. They are never uploaded or kept
in browser storage. There is no application dispatch, approval or submit API.

The phases are Discovery, Qualification, Publication, Resume build, Resume
review, Application handoff, and Application. Phase 6 has one handoff gate.
Phase 7 belongs to a **new per-role browser application session**, not the resume
builder. Application authorization does not authorize outreach, profile edits
or unrelated uploads. Tool confirmations and access barriers still apply.

The jobs table has five columns: Item / online JD, Phase, Base score, Next step,
and Resume / artifact. A distinct status appears beneath its phase, not in a
separate column. Owner and Status filters still use the full row metadata.
Search includes ownership and evidence labels even though those columns are
not shown. Supporting evidence links remain available under Journal's Job
supporting references; linked job names and verified PDF actions are unchanged.
This is a display change, not a change to ownership, provenance or gate policy.

## Private producer contract

The existing `schemaVersion: 1` shape is unchanged. `jobs`, `blockers`, local
artifacts and the optional journal remain separate. `waitingOnUser` must equal
`status === "Waiting on you"` on input. `In review` is a new status: known
pending checks or reviewers are neither a failure nor an approval.

`job.handoff` is an optional, additive **read-only receipt summary**. It contains
no policy defaults, reviewer names, receipt contents, answers or session IDs.
Every field below describes the same job, current artifact and application
scope. The private coordinator must retain and verify the actual receipts.

| Field | Accepted values | Required for a cleared display |
| --- | --- | --- |
| `scope` | `application`, `unknown` | `application` |
| `artifactSha256` | 64 hexadecimal characters | Matches the SHA-256 of the locally loaded PDF and `job.artifact.sha256` |
| `validation` | `passed`, `pending`, `failed`, `unknown` | All required exact-PDF checks `passed` |
| `independentReview` | `verified`, `pending`, `rejected`, `unknown` | **ALL configured independent reviewers actually approved this exact PDF**, with coordinator-verified receipts |
| `routeStop` | `clear`, `pending`, `stopped`, `unknown` | `clear` |
| `reservation` | `clear`, `pending`, `conflict`, `unknown` | `clear` |
| `duplicate` | `clear`, `pending`, `found`, `unknown` | `clear` |
| `authorization` | `auto-cleared`, `human-required`, `human-approved`, `unknown` | Existing private policy `auto-cleared`, or the required artifact-and-application decision is `human-approved` |
| `personalAttestation` | `complete`, `required`, `not-required`, `unknown` | Applicable answers are `complete`, or explicitly `not-required` |

`independentReview: "verified"` does not mean a reviewer was launched, a receipt
exists, or a pending/rejected result was inspected. If any required reviewer is
still running, use `pending`. For example, a candidate can remain in Resume
review with `status: "In review"` while approvals are incomplete. Do not publish
handoff clearance until the actual required approvals and other checks exist.

For **Application handoff**, the view derives the displayed status, next step
and waiting flag from this summary and the loaded PDF, never from score, the
input `Approved`/`Ready` label, visual impressions or old `humanApproval`
metadata:

| Display | Meaning |
| --- | --- |
| Auto-cleared | Exact checks and existing private policy clear the handoff without another resume approval |
| Ready | Exact checks and the required human application decision are recorded; do not ask again |
| Waiting on you | Checks are clear, but policy requires a new decision or a known personal attestation is missing |
| In review | Required checks/reviewers are explicitly pending; no handoff is cleared |
| Blocked | Artifact, scope or required evidence is absent, unknown, changed or failed |

Explicit failures and unknown check results take precedence over pending checks.
Missing or unknown authorization/attestation requirements cannot clear a
handoff. Malformed field values produce a visible load error rather than a
successful fallback. Displayed counts and filters use the projected row state;
`attention` remains accepted for schema compatibility.

In **Application**, the source's recorded execution status remains unchanged.
The view does not decide whether a submission happened. The private per-role
session must recheck the live role, route, reservation and duplicates, use only
applicable confirmed answers and the exact approved PDF, complete required
pre-submit review and tool confirmations, submit once, and verify the site's
confirmation. Missing confirmation means reconcile, not blindly resubmit.

### Migration

Old `Human review` and `Authorized action` phase labels remain loadable aliases
for Application handoff and Application. An old phase name or `Approved` label
does **not** establish application permission. Missing handoff evidence displays
Blocked in phase 6. Legacy phase-7 rows retain their historical status and show
an explicit scope-reconciliation notice; a completed record is not a new wait.
Update producers to the canonical phase names and supply receipt summaries only
when verified. Do not synthesize private policy, approvals or personal answers.

The approved upstream public generator/templates are maintained separately by
their owner. Synchronize these assets and the producer's phase/status validation
there before generating another deployment. Never copy private directories or
repository history into this repository.

## Development

```powershell
npm ci
npx playwright install chromium
npm run lint
npm run build
npm test
```

`npm run diagram` regenerates the committed `workflow.svg` from `workflow.mmd`
using `tools/mermaid.json`, then builds the same eight assets into `dist`.
`npm run build` only writes `dist`. The browser tests exercise that exact static
bundle and compare its diagram labels with the committed Pages SVG.
`npm run lint` checks JavaScript syntax; there is no application compiler.

All test records, URLs, PDF bytes and hashes are synthetic and generated
locally. Test reports contain only synthetic data. The live-folder preferences
remain `mode=live|snapshot`, `refresh=15..3600` seconds and
`view=attention|mine|blocked|all|published`. Live refresh preserves filters,
sorting and scroll, pauses for an open artifact dialog, and keeps the last
valid snapshot on failure.

GitHub Pages deploys the root of `main`. PR checks build and inspect the public
bundle but do not merge, deploy, execute applications or close issues.
