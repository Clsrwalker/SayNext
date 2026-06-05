---
name: saynext-testing
description: Use when changing or evaluating SayNext routing, prompt assembly, memory grounding, output constraints, prompt wording, intent classification, scene behavior, or regression/eval coverage. Enforces test-first bug fixes, scoped prompt changes, drift checks, and a structured verification report.
---

# SayNext Testing

Use this skill before and after changing SayNext behavior that depends on prompts, routing, memory retrieval, scene mode, or LLM output shape.

## Core Workflow

1. Record the problem:
   - input transcript or scenario;
   - current wrong output or wrong route;
   - expected intent and expected output behavior.
2. Add the test before the fix:
   - bug fix: add a failing regression test;
   - new behavior: add an acceptance test;
   - prompt change: add a route, prompt assembly, memory grounding, or output constraint test.
3. Make the smallest change:
   - change one main routing rule, prompt hint, postprocess rule, or memory packing path at a time;
   - avoid broad prompt rewrites and wide regex changes.
4. Run the new test and confirm it fails before the fix when practical, then passes after the fix.
5. Run related old tests for the touched area.
6. Run broader regression for prompt assembly, scene prompt, and memory grounding.
7. Keep true regression cases permanently.
8. Record the pattern learned so future fixes can reuse it.

## Exploratory Variant Rule

Do not probe with only one clean "standard" question. For each exploratory topic, test a small realistic variant cluster:

- canonical wording: the clean interview/classroom/service/daily version;
- casual wording: how a real person would say it quickly;
- indirect wording: implied question, follow-up, or missing exact keyword;
- noisy wording: clipped phrase, ASR-ish wording, or mixed context when relevant;
- false-positive neighbor: a similar sentence that should route differently.

Use the most likely real situations first:

- `interview`: personal facts, unsupported experience, project deep dive, weakness/feedback/conflict, salary/role questions, common CS mechanism/debug questions.
- `service`: front desk, delivery, refund, bank charge, landlord/deposit, clinic/insurance, appointment/forms.
- `daily/casual`: greetings, food, weather, parties, plans, preference, small practical how-to, awkward/social replies.
- `classroom`: direct concept, mechanism, compare, trade-off, lab debug, lecture note, "any questions" prompts.

If all variants in a cluster pass, switch to a different topic family instead of adding more near-identical examples.

## Duplicate And Coverage Guard

Before adding or keeping a test, check whether it is meaningfully new:

1. Search existing tests with `rg` for the core entity, symptom, and expected behavior.
2. Normalize the candidate to a signature: `mode + intent + topic + failure mode`.
3. If the signature already exists and the new case does not expose a new failure mode, keep it as exploratory only.
4. If it is the same failure mode with a useful wording variant, append it to an existing table/array test instead of creating a new standalone test.
5. If several saved tests are near-duplicates, consolidate them into a parameterized test and keep the clearest 2-4 variants.

Prefer permanent tests that catch a class of drift, not a single phrasing. Avoid exact snapshots unless deterministic code formatting is the subject.

## Test Classes

Use three buckets:

- `exploratory`: temporary probes used to discover issues. Do not keep every case permanently.
- `regression`: cases for real bugs that were fixed. Keep these in the normal suite.
- `eval`: real OpenAI/Ollama output quality checks. Use for manual or nightly checks; avoid exact snapshots.

Do not make every LLM output an exact snapshot. Prefer assertions on intent, prompt content, facts used, forbidden phrases, max length, and absence of fabrication.

## Four Required Test Types

### 1. Routing Tests

Use for intent/classifier changes.

Assert input maps to expected intent, including false positives:

- technical symptom -> `technical_debug`;
- mechanism question -> `technical_mechanism`;
- identity question -> `personal_fact`;
- project/experience question -> project/interview intent;
- consumer-device or casual question -> not technical debug.

### 2. Prompt Assembly Tests

Use when memory, scene, prenote, or prompt packing changes.

Assert required context actually reaches the model prompt. Example: interview backend question with JobLens memory must include `JobLens`, `Lambda`, `API Gateway`, `DynamoDB`, and `S3`.

### 3. Output Constraint Tests

Use when prompt wording or postprocessing changes.

Assert behavior, not exact prose:

- `ordinary_practical`: short direct answer; no checklist; no "there are several ways"; no theory-first framing.
- `classroom_answer`: compact answer; not teacher-like; no "When I talk about...".
- `personal_fact`: exact supported fact only; no acronym expansion or invented school detail.
- `interview_project`: names a supported project when memory is present; no generic-only architecture answer.

### 4. Drift Regression Tests

After fixing one area, run old tests from neighboring areas likely to drift:

- changing `personal_fact`: run personal positive/negative, technical, ordinary practical, and interview project tests;
- changing technical debug: run mechanism-vs-debug and consumer-device false positive tests;
- changing ordinary practical: run technical/interview/classroom non-leak tests;
- changing classroom output: run direct-question, comparison/detail, and lecture-note tests.

## LLM Eval Rules

For real model checks, use different questions from the original bug after the targeted regression passes.

Prefer checking:

- intent is correct;
- prompt contains top memory when relevant;
- output uses required supported facts;
- output does not include forbidden phrases;
- output does not invent scale, users, production, awards, exact dates, or unsupported incidents;
- output is not generic when a named memory is available.

Do not keep every model-output probe as a permanent exact test. Save only stable regression properties.

## Final Report Checklist

Always report:

- New tests added:
- Target tests passed:
- Old regression tests passed:
- Potential drift checked:
- Saved regression cases:
- Remaining risk:
