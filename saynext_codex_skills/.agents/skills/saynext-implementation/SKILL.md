---
name: saynext-implementation
description: Use for implementing an approved or clearly scoped SayNext task with minimal code changes, tests, and a concise verification report. Do not use for fuzzy product discovery before requirements are clear.
---

# SayNext Implementation

Use this skill when the task is clear enough to code: approved product plan, explicit bug fix, deployment fix, eval improvement, or a scoped engineering change.

If the task is still fuzzy, use `saynext-product-interview` first.

## Hard Rules

- Inspect relevant files before editing.
- Keep edits scoped to the requested behavior.
- Do not rewrite unrelated files or revert user changes.
- Do not add large dependencies without asking.
- Do not add extra model calls in real-time paths unless approved.
- Do not silently change API contracts, auth, storage, deployment, or prompt schemas.
- Do not claim tests passed unless they actually ran.
- Do not push untested changes. For SayNext VPS work: local commit, deploy VPS for user testing, then push only after confirmation.

## SayNext Runtime Rules

- Classroom mode should stay light: answer questions or add a compact knowledge supplement; avoid personal-memory-heavy prompts.
- Daily, interview, and discussion modes may use scene, prenote, and top personal memories when relevant.
- Mentra/G2 manual mode should default to text wall display; bitmap display is abandoned.
- Empty double tap should not reset or hide the display. If no pinned answer exists, generate from new speech; if no useful speech exists, restore listening.
- R1/scroll changes should preserve the pinned answer unless the user explicitly clears it.

## Workflow

1. Re-read the user request and any approved criteria.
2. Inspect code with `rg` and targeted file reads.
3. Identify the smallest file set to change.
4. Implement only the requested behavior.
5. Add or update focused tests when behavior changes.
6. Run relevant checks.
7. Review diff for scope creep.
8. Report exactly what changed, what passed, what was not tested, and whether anything was deployed.

## Verification Defaults

Prefer:

- focused unit tests for changed runtime behavior;
- `bunx tsc --noEmit` for TypeScript changes;
- replay/eval scripts for prompt or output-quality changes;
- VPS deploy only after local tests pass, and do not push until the user confirms.

## Final Report Format

Keep the report concise:

### Changed

- File: reason.

### Verification

- Command: pass/fail/not run.

### Deployment

- Local commit:
- VPS deployed: yes/no.
- Pushed: yes/no.

### Risks

Only real remaining risks or next checks.
