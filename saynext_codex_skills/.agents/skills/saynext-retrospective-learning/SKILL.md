---
name: saynext-retrospective-learning
description: Use after SayNext testing, failed assumptions, repeated Codex mistakes, eval regressions, or user feedback to extract lessons and propose small updates to skills, AGENTS.md, docs, or eval cases. Do not silently rewrite persistent guidance.
---

# SayNext Retrospective Learning

Use this skill when a SayNext task reveals a lesson that should persist beyond the current chat.

Do not directly rewrite major guidance unless the user approves. First propose the smallest useful updates.

## When To Use

Use after:

- a feature test fails or behaves differently than expected;
- Codex repeats a mistake;
- a prompt or model change helps one scene but hurts another;
- the user states a clear product or engineering rule;
- an eval run exposes a missing case;
- the user asks to remember, summarize, or update rules.

## Core Workflow

1. Summarize what happened.
2. Identify what Codex assumed incorrectly.
3. Capture what the user clarified.
4. Convert the lesson into 1-3 persistent updates.
5. Decide the right target file.
6. Propose exact updates and ask for approval.
7. Apply only approved updates.

## Where Lessons Belong

- `AGENTS.md`: always-on project rules that apply across most SayNext tasks.
- `.agents/skills/*/SKILL.md`: reusable workflow changes for Codex.
- `docs/learning/DECISIONS.md`: product or architecture decisions.
- `docs/learning/CODEX_RETROSPECTIVES.md`: notable mistakes and corrections.
- `evals/` or `data/review/`: concrete transcript/output cases.

Do not add one-off details to `AGENTS.md`.

## High-Value SayNext Lessons

These are examples of lessons worth preserving:

- do not push untested changes; deploy VPS first and wait for confirmation;
- Mentra bitmap display was abandoned; default to text wall display;
- G2 double tap in an empty state must not hide or reset the display;
- classroom prompt paths should stay minimal and avoid personal-memory noise;
- output-quality changes need concrete replay/eval cases.

## Proposed Update Format

Return:

### Retrospective Summary

What happened and why it matters.

### User Clarified

- ...

### Lessons

- Product:
- Engineering:
- Output quality:
- Eval:

### Proposed Persistent Updates

For each update:

- File:
- Change:
- Reason:
- Priority:
- Needs approval: yes/no

### Confirmation Needed

Ask which updates to apply.

## Anti-Patterns

Do not:

- claim memory is persistent unless it is written to a file;
- store secrets or credentials;
- add huge generic guidance;
- update many files for one small lesson;
- turn a temporary experiment into a universal rule without confirmation.
