---
name: saynext-product-interview
description: "Use for fuzzy SayNext product ideas that need clarification before coding: interview the user, define value, scope an MVP, and draft acceptance criteria. Do not use for straightforward bug fixes, deployments, or already-scoped implementation tasks."
---

# SayNext Product Interview

Use this skill when the user has an unclear SayNext feature idea and needs help turning it into a testable product and engineering plan.

Do not implement while using this skill unless the user explicitly approves the final criteria and asks to start coding.

## Core Workflow

1. Restate the idea and the user problem in one short paragraph.
2. Ask only the clarification questions that materially affect behavior or architecture.
3. Separate confirmed facts, reasonable assumptions, and risky assumptions.
4. Propose the smallest MVP that can prove the value.
5. Define non-goals so the task does not grow.
6. Draft acceptance criteria.
7. Ask the user to confirm or edit the criteria before implementation.

## SayNext Product Priorities

Prefer decisions that improve:

- low latency;
- natural, sayable output;
- context awareness without prompt bloat;
- low friction on glasses;
- simple, maintainable runtime code;
- measurable quality through eval or replay cases.

Avoid:

- extra model calls in the real-time path unless explicitly approved;
- long or polished responses that Xiang would not say aloud;
- UI states that hide the answer or overwrite the current reading flow;
- demo-only changes that damage daily, interview, classroom, or discussion behavior.

## Clarifying Questions

Ask 1-5 high-value questions. Prefer questions about:

- scene: classroom, interview, daily chat, discussion, meeting, service, or G2 manual mode;
- output: answer length, language, tone, and whether it should be spoken or displayed;
- control: tap, R1, scroll, phone UI, or automatic behavior;
- failure: what should happen when ASR is weak, context is missing, or no answer exists;
- latency: whether quality justifies extra retrieval, prompt, or model work.

Avoid asking implementation details that can be decided later.

## Draft Format

Return:

### Understanding

Short restatement of the idea and user problem.

### Questions

Only the questions that block a safe MVP.

### Assumptions

- Confirmed:
- Reasonable:
- Risky:

### MVP

- Feature:
- User flow:
- Non-goals:
- Files likely involved:

### Acceptance Criteria

- Functional:
- Output quality:
- Latency:
- Regression:

### Confirmation Needed

Ask the user to confirm or edit the acceptance criteria.
