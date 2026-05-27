# Contributing to @posteria/observer

Thanks for the interest. Observer is a small, deliberately-narrow project,
and contribution discipline reflects that.

## Scope discipline (read before opening a PR)

Observer is the identity-function open subset of Posteria. The v0.1 contract
is canonical. PRs that would:

- Add policy evaluation, blocking, redaction, or any payload mutation,
- Add cryptographic attestation or signing in v0.1,
- Open network sockets at runtime,
- Consume the audit stream within Observer itself,
- Remove or rename the reserved `posteria_*` field set or
  `x-<orgslug>-*` namespace convention,

are out of scope. A fork that adds any of the above is welcome under MIT,
but it is NOT `@posteria/observer` and MUST be renamed.

If you want to discuss whether a change is in scope, open an issue first.

## How to contribute

1. **Open an issue.** Describe the bug, the gap, or the change you want to
   make. For anything larger than a typo or a one-line fix, wait for a
   maintainer ack on scope before writing code.
2. **Fork and branch.** Branch names: `fix/<short-slug>`,
   `feat/<short-slug>`, `docs/<short-slug>`.
3. **Conform to the contract.** Runtime changes MUST keep the v0.1 contract
   passing. The conformance suite lives at `test/conformance/` (lands with
   v0.1.0).
4. **One concern per PR.** Mixing a doc fix with a runtime change makes the
   review longer. Split them.
5. **Open a PR against `main`.** Include:
   - A one-paragraph description of what changed and why.
   - For runtime changes: confirmation that conformance tests pass locally.
   - For doc changes: confirmation that the change does not alter normative
     contract language (or, if it does, an explanation of why).

## Style

- **Code:** match the existing style. No bikeshedding PRs.
- **Commits:** present tense, imperative ("add X", not "added X" or
  "adds X"). One logical change per commit when reasonable.
- **No AI-generated PR descriptions.** Write what the change does, in your
  own voice. Auto-generated walls of text get closed.

## What gets merged fast

- Documentation fixes (typos, broken links, factual corrections to the
  README that do not change the normative contract).
- Bug fixes with a clear reproducer and a passing test.
- CI / tooling improvements that do not change runtime behavior.

## What takes longer

- Anything touching the audit record shape, configuration surface, or
  telemetry stub. These are contract-level changes and require a spec
  amendment in the closed Posteria spec repo.
- Anything that would require a `record_version` bump.
- Anything that adds a new dependency.

## License of contributions

By contributing, you agree your contribution is licensed under the MIT
License (see `LICENSE`).
