# SayNext Codex Skills

Repo-scoped Codex skills for building and improving SayNext.

## Skills

- `saynext-product-interview`: clarify fuzzy SayNext ideas before coding.
- `saynext-implementation`: implement scoped SayNext changes with focused verification.
- `saynext-testing`: add and run test-first coverage for SayNext routing, prompts, memory grounding, output constraints, and drift.
- `saynext-retrospective-learning`: turn failed tests, user feedback, and repeated mistakes into persistent project guidance.

## Install

Copy the `.agents` folder into the root of the SayNext repository:

```text
SayNext/
  .agents/
    skills/
      saynext-product-interview/
        SKILL.md
      saynext-implementation/
        SKILL.md
      saynext-retrospective-learning/
        SKILL.md
```

Restart Codex if the skills do not appear.

## Example Prompts

Product discovery:

```text
$saynext-product-interview
I have a fuzzy SayNext idea. Interview me first and turn it into an MVP with acceptance criteria.
```

Implementation:

```text
$saynext-implementation
Implement the approved MVP. Keep the diff small, run focused tests, deploy VPS first, and do not push until I confirm.
```

Retrospective:

```text
$saynext-retrospective-learning
Summarize what went wrong in this test and propose small updates to skills, AGENTS.md, docs, or eval cases. Do not edit until I approve.
```

Testing:

```text
$saynext-testing
Fix this SayNext prompt/routing bug test-first, keep true regressions, run drift checks, and report remaining risk.
```
