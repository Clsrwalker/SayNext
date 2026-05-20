# SayNext Open Data References for Unseen Regression

This file tracks public/open datasets that can expand SayNext's unseen LLM-output and teleprompt regression tests.

Principle: use these as references for test-case generation, not as personal memory. Public/third-party transcripts must not become Xiang personal facts.

## Highest Priority

### Santa Barbara Corpus of Spoken American English

- Source: https://www.linguistics.ucsb.edu/research/santa-barbara-corpus-spoken-american-english
- Coverage: natural American speech, face-to-face conversation, telephone calls, games, food preparation, work talk, classroom lectures, sermons, stories, town halls, tour-guide speech.
- Why useful: best next source for messy real-life daily chat and public speech. It has disfluencies, interruptions, topic drift, and ordinary spoken rhythm.
- SayNext tests:
  - daily chat short replies
  - third-party transcript should not leak Xiang memory
  - ASR-like fragments and incomplete turns
  - teleprompt interruption and topic switch
- Risk: transcript formatting can be linguistics-heavy; normalize before generating cases.

### MICASE: Michigan Corpus of Academic Spoken English

- Source: https://varieng.helsinki.fi/CoRD/corpora/MICASE/index.html
- Coverage: academic lectures, classroom discussions, seminars, lab sections, office/advising-style interactions.
- Why useful: better classroom data than synthetic lecture snippets. Good for testing whether SayNext asks useful questions, supplements knowledge, and avoids fake participation.
- SayNext tests:
  - classroom lecture supplement
  - professor asks "any questions"
  - student discussion
  - academic presentation follow-up
- Risk: older university language style; should be mixed with current course transcripts.

### ICSI Meeting Corpus

- Source: https://groups.inf.ed.ac.uk/ami/icsi/
- Coverage: about 70 hours of real research meetings, with transcription, dialog acts, and speech quality annotations.
- Why useful: more realistic multi-speaker meeting data than simple AMI-style snippets.
- SayNext tests:
  - meeting state tracking
  - action item extraction
  - interruption handling
  - unclear ownership / blocker / decision moments
- Risk: research-meeting topics may be narrow; combine with software-project synthetic meeting cases.

### ClassBank / TalkBank Classroom Data

- Source: https://talkbank.org/class/index.html
- Coverage: filmed classroom interactions in science, math, medicine, and reading; learner levels from grade school to medical school.
- Why useful: captures real teacher-student classroom discourse, not just lecture monologue.
- SayNext tests:
  - teacher asks a direct question
  - class discussion
  - student answer vs. teacher explanation
  - when to stay silent vs. ask a good question
- Risk: some data may need TalkBank access workflow; check license/terms before bulk use.

## Strong Additions

### Speak & Improve Corpus 2025

- Source: https://researchdatasets.cambridge.org/datasets/speak-and-improve-corpus-2025
- Coverage: spontaneous L2 English speaking tests, CEFR labels, manual transcripts for a subset, disfluencies and language errors.
- Why useful: very close to Xiang's IELTS / English learner / imperfect speaking use case.
- SayNext tests:
  - IELTS Part 1/2/3 style answers
  - grammar errors and self-correction
  - unclear learner speech
  - teleprompt reread with non-native pronunciation/phrasing
- Risk: data access and license must be checked; use small approved samples first.

### Trinity Lancaster Corpus

- Source: https://cass.lancs.ac.uk/trinity-lancaster-corpus/
- Coverage: 4.2 million words of L2 speaker and examiner interaction from speaking exams.
- Why useful: direct fit for spoken exam behavior, examiner prompts, learner hesitation, and response strategy.
- SayNext tests:
  - IELTS-like examiner interaction
  - long speaking turn generation
  - follow-up question handling
  - casual but exam-appropriate phrasing
- Risk: access via TLC Hub; avoid copying large protected text into repo unless terms allow it.

### TALCS Mandarin-English Code-Switching Corpus

- Source: https://arxiv.org/abs/2206.13135
- Coverage: Mandarin-English code-switching speech from one-to-one English teaching scenes.
- Why useful: SayNext frequently sees Chinese-English mixed ASR. This can stress mixed-language transcripts more realistically than hand-written cases.
- SayNext tests:
  - Chinese-English mixed questions
  - wrong language output
  - code-switching in classroom/learning settings
  - ASR fragments where only part of the sentence is English
- Risk: verify the downloadable corpus license before direct use.

### HarperValleyBank

- Source: https://arxiv.org/abs/2010.13929
- Coverage: public-domain spoken banking call-center dialogues, 1,446 conversations, 23 hours, transcripts and intent/action annotations.
- Why useful: service/call-center dialogue is under-tested. Good for measuring whether SayNext stays role-appropriate and does not inject personal facts.
- SayNext tests:
  - service interaction
  - task-oriented clarification
  - polite short answers
  - caller/agent role confusion
- Risk: domain is banking, so avoid hallucinating account-specific advice.

### OD3 Open Directed Dialogue Dataset

- Source: https://www.amazon.science/code-and-datasets/od3-open-directed-dialogue-dataset
- Coverage: 63K task-oriented conversations, 600K turns, 1,172 hours of audio, with repeats and rephrases after failed utterances.
- Why useful: directly matches SayNext's hard problem: repeats, rephrases, failed ASR-like turns, and user repair behavior.
- SayNext tests:
  - repeated output should stay on screen
  - reread vs. new speaker response
  - partial repeats and paraphrases
  - repair after misunderstanding
- Risk: includes synthetic audio augmentation; keep separate from natural transcript tests.

## Useful But Lower Priority

### Claire English Dialogue Dataset

- Source: https://huggingface.co/datasets/OpenLLM-France/Claire-Dialogue-English-0.1
- Coverage: English dialogue transcripts from parliamentary proceedings, interviews, broadcasts, meetings, and free conversations.
- Why useful: broad multi-domain pool for random stress testing.
- SayNext tests:
  - open-domain public transcript leakage
  - speaker-label handling
  - formal vs. casual register switching
- Risk: mixed-source dataset; license and source provenance need per-subset caution.

### DailyTalk

- Source: https://arxiv.org/abs/2207.01063
- Coverage: 2,541 recorded dialogues derived from DailyDialog, conversational speech with CC-BY-SA 4.0 for academic use.
- Why useful: can expand casual speech and spoken response rhythm.
- SayNext tests:
  - daily short response
  - emotion shift
  - casual follow-up
- Risk: inherited DailyDialog style may be cleaner than real human speech.

### MedDialog

- Source: https://arxiv.org/abs/2004.03329
- Coverage: large-scale English and Chinese doctor-patient dialogues.
- Why useful: medical/service conversations are high-risk and currently under-tested.
- SayNext tests:
  - high-stakes medical questions should avoid giving unsafe advice
  - service/triage role confusion
  - Chinese-English health-related ASR
- Risk: high-stakes domain. Use only for refusal/safety/process tests, not medical answering quality.

### MediaSum / Interview-Style Media Dialog

- Sources:
  - https://github.com/zcgzcgzcg1/MediaSum
  - https://arxiv.org/abs/2004.03090
- Coverage: media interviews, NPR/CNN-style multi-party transcripts, summaries.
- Why useful: good for interview-like rhythm, public discussion, and Q/A follow-ups.
- SayNext tests:
  - public transcript should not become Xiang's opinion
  - interview question style
  - formal public conversation
- Risk: media transcripts may have copyright/provenance constraints. Use small derived prompts or metadata-based case generation unless terms are clear.

### Taskmaster

- Source: https://arxiv.org/abs/1909.05358
- Coverage: realistic task-oriented dialogues across everyday domains.
- Why useful: service, booking, planning, assistant-like conversations.
- SayNext tests:
  - practical one-sentence responses
  - clarification requests
  - avoiding over-answering in task contexts
- Risk: often written/task-oriented rather than raw ASR speech.

## Coverage Gaps These Sources Fill

- Real messy daily speech: Santa Barbara Corpus, TalkBank CA data.
- Academic classroom: MICASE, ClassBank.
- Real multi-speaker meetings: ICSI.
- L2 / IELTS-like learner speech: Speak & Improve, Trinity Lancaster.
- Chinese-English mixed ASR: TALCS.
- Service/call-center: HarperValleyBank, Taskmaster, OD3.
- Public interview/broadcast: MediaSum, Interview corpus, Claire Dialogue.
- High-risk safety scenarios: MedDialog.

## Suggested Next Implementation

1. Build `scripts/build-open-reference-cases.ts`.
2. Add a `data/reference/open-sources/manifest.json` with source name, URL, license note, allowed use, and local file paths.
3. Add import adapters per source instead of hardcoding cases.
4. Normalize transcripts into this internal shape:

```json
{
  "source": "sbcsae",
  "scene": "Daily Chat",
  "speakerTurns": [
    { "speaker": "A", "text": "..." },
    { "speaker": "B", "text": "..." }
  ],
  "stressTags": ["interruption", "disfluency", "topic_shift"],
  "mustNotContain": ["xiang", "saynext", "dalhousie"],
  "expectedBehavior": "natural short response, no personal-memory leak"
}
```

5. Generate three test sets:
   - `open-reference-smoke`: 50 cases, quick.
   - `open-reference-regression`: 300 cases, before deploy.
   - `open-reference-soak`: long ASR-like stream simulation.
