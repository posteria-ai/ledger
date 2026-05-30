# Posteria Ledger Development Rules

## Operating Principles

- Treat `docs/contract/v0.1.md` as the source of truth for public behavior,
  record shape, configuration semantics, and conformance expectations.
- Keep Ledger as the identity-function open subset of Posteria: record the
  boundary event, return `allow`, and do not mutate payloads.
- Do not hide uncertainty. State assumptions, ambiguities, and tradeoffs before
  implementation when scope or contract behavior is unclear.
- Keep changes surgical. Every changed line should trace to the issue, contract,
  contributing guidance, or explicit user request.
- Prefer the simplest implementation that satisfies the contract. Do not add
  speculative abstractions, options, dependencies, or adjacent cleanup.
- Match existing code style and repository structure.
- Use deterministic checks to anchor agent work: contract text, conformance
  tests, diffs, CI, and `codex review`.
- Use `rg`/`rg --files` first for repository search.
- If the contract, README, contributing guide, issue requirements, or user
  instructions conflict, stop and resolve the conflict before coding.

## Scope Guardrails

- Ledger MUST NOT evaluate policy, constitutions, mandates, or rules.
- Ledger MUST NOT block, refuse, redact, rewrite, or otherwise modify calls.
- Ledger MUST NOT mint, sign, attest, or anchor VDC records in v0.1.
- Ledger MUST NOT open network sockets or transmit audit content at runtime
  in v0.1, including when telemetry is enabled.
- Ledger MUST NOT consume the audit stream within Ledger itself.
- Ledger MUST preserve the reserved `posteria_*` field set and the
  `x-<orgslug>-*` namespace convention from the v0.1 contract.
- Runtime, record-shape, configuration, telemetry, and dependency changes are
  contract-level changes. Check `docs/contract/v0.1.md` and update public docs
  when externally observable behavior changes.

## Work Modes

- Plan-only work may read/search files, inspect git state, and draft a plan or
  proposed patch. Do not edit files, commit, push, or open PRs.
- Implementation work should start from a clear issue or explicit user request.
  For anything larger than a typo or one-line fix, confirm scope against the
  contract and `CONTRIBUTING.md` before editing.
- Review work uses code-review posture: findings first, ordered by severity,
  with file/line references and concrete risk.

## Issue, Branch, and Scope

- One concern per PR.
- Open an issue before substantial implementation work unless the user has
  explicitly scoped the change in-session.
- Branch names should follow `fix/<short-slug>`, `feat/<short-slug>`, or
  `docs/<short-slug>`.
- Never commit directly to `main`.
- Use `git add <specific files>` only. Never use `git add .`.
- Do not revert or overwrite unrelated user changes.

## Implementation Loop

1. Read the issue or user request, applicable contract sections, nearby docs or
   code, and existing tests.
2. Define success criteria and the smallest safe verification path.
3. For behavior changes, add or update meaningful conformance or regression
   tests, including negative/edge cases where contract boundaries matter.
4. Implement the minimum scoped change.
5. Remove only orphaned imports, variables, helpers, or docs created by your
   change.
6. Update README, contract, conformance docs, or contributing guidance when
   behavior or public artifacts change.
7. Run targeted checks first, then broaden when risk or shared behavior
   warrants it.
8. Self-review with `git diff main..HEAD` before PR creation.

## Verification Discipline

- Use the narrowest relevant command, then broaden when contract/runtime risk
  warrants it.
- For documentation-only changes, inspect the rendered diff and any affected
  links or references.
- For runtime or conformance-suite changes, run the relevant conformance tests
  once they exist under `test/conformance/`.
- For broad or noisy suites, capture full output in a temporary log and report
  only the exit code, relevant failure excerpts, and final summary.
- If a relevant check cannot be run, document why and describe the residual
  risk.

## Required Pre-PR Review

Before opening any pull request, Codex must run:

```sh
codex review --base main
```

The review must happen after implementation and tests, but before `gh pr create`
or any other PR creation command. Treat unresolved review findings as blocking
unless explicitly documented as false positives or out of scope.

Before creating any PR:

1. Run implementation verification.
2. Self-review `git diff main..HEAD`.
3. Confirm the diff is stable, then run `codex review --base main`.
4. Treat unresolved material findings as blocking unless explicitly documented
   as false positives or out of scope.
5. Only then create the PR.

## Automated Review Standard

Review must inspect the linked issue or user request, relevant contract
sections, PR diff, and test plan/results.

Prioritize findings in this order:

1. Correctness against the v0.1 contract and acceptance criteria
2. Regression risk
3. Scope discipline
4. Test adequacy, including negative/edge cases
5. Maintainability and clarity
6. Style last

Block approval when acceptance criteria are unclear, contract behavior drifts,
tests are missing or weak for behavior changes, scope is too broad, or
correctness cannot be determined from the issue/request, contract, diff, and
tests.

## Autonomy and Merge Rules

- Default mode is review mode: open PRs but do not merge.
- "Work autonomously" allows implementation, PR updates, and automated-review
  response, but not merging.
- Merge only when the user explicitly authorizes autonomous merging in the
  session and all checks/reviews are green.
- Verify PR status with concrete GitHub data before merging.
- If review/check status is unavailable, ambiguous, delayed, or absent, do not
  merge.
- Squash merge is preferred.
- After any merge, switch back to `main` and update from origin before starting
  new work.
