# SayNext Personalization Pipeline

This pipeline is offline and local-first. The realtime SayNext path should only save raw data and stay fast. A background/manual process uses Ollama to turn noisy transcript and output into training examples, review items, and personal memory.

## Realtime Path

1. Mentra transcript arrives.
2. SayNext generates a short reply.
3. Store raw transcript, AI output, model, profile version, and retrieved sample IDs in `conversation_samples`.
4. Active event memory groups continuous transcripts into `conversation_events`.

No cleaner, scorer, or pseudo-label generation should block realtime output.

## Offline Local LLM Path

Input:

- raw transcript
- SayNext output
- event context when available

Stages:

1. Cleaner: remove ASR noise and duplicated partials, but keep natural spoken style.
2. Segmenter: split long transcript into small conversation events.
3. Context Classifier: interview, classroom, daily chat, work discussion, group discussion, service/advisor, or unknown.
4. Event Extractor: title, summary, useful facts, blind spots, follow-up questions.
5. Output Intent Judge: decide what SayNext should have done.
6. Quality Scorer: score naturalness, usefulness, conciseness, Xiang fit, and grounding.
7. Pseudo Label Generator: write a better Xiang-style reply if useful.
8. Review Selector: only ask Xiang for uncertain, high-value, or bad samples.
9. Personal Memory Candidate: save stable facts, style corrections, reusable examples, and preferences.

## Storage

- `personalization_pipeline_runs`: one processed result per raw sample/event.
- `personal_memory_items`: accepted memory candidates from processed runs.

## Review Policy

Ask Xiang only when:

- quality is low
- the model may have invented personal details
- context classification is uncertain
- the pseudo label is high-value
- the sample reveals a strong preference or style correction

Avoid asking Xiang to review routine clean examples.

## Local Model

Use Ollama through:

- `PIPELINE_OLLAMA_MODEL`, falling back to `OLLAMA_MODEL`
- `PIPELINE_OLLAMA_TIMEOUT_MS`, default 90 seconds

The realtime model and pipeline model can be different. For example, realtime can use a smaller/faster model and pipeline can use `qwen2.5:14b-instruct`.
