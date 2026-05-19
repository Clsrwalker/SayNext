# Memory Review Workflow

Use `data/review/` for private review batches.

- Put new review files in `data/review/inbox/`.
- Work-in-progress files go in `data/review/in-progress/`.
- Reviewed items waiting for tests go in `data/review/ready-to-test/`.
- Passed review batches go in `data/review/completed/`.
- Test reports go in `data/review/reports/`.
- Old batches go in `data/review/archive/`.

Recommended validation after a review:

1. Targeted retrieval test.
2. Negative or confusing retrieval test.
3. Regression test against existing CS, lecture, IELTS, interview, meeting, and teleprompt cases.
4. Random stress test with ASR noise, mixed language, and unrelated daily chat.
5. LLM output test for naturalness, correctness, and hallucination risk.

Only promote or keep memory changes after the process path is clean, not merely because one final answer looks correct.

## Local/VPS Database Rule

Use one source of truth at a time:

- At home: Local is the main database.
- During travel: VPS is the main database.
- Sync before switching.
- Do not let both sides write new transcript or memory at the same time.

Switch Local to VPS before travel:

```powershell
cd D:\SayNext
.\scripts\sync-local-to-vps.ps1 -SwitchToTravelMode
```

Switch VPS back to Local after travel:

```powershell
cd D:\SayNext
.\scripts\sync-vps-to-local.ps1 -SwitchToLocalMode
```

After pulling VPS data back to Local, run Memory Review and retrieval/LLM tests before promoting new memory.

## Prenote Uploads

Prenote uploads are not promoted directly into long-term memory.

- Uploading a Prenote stores the original/extracted text and builds a chunk index for live retrieval.
- The Prenote detail page button sends the material to `Memory Review` as a pending `knowledge_fact` candidate.
- Review/edit the candidate first, then promote it only after targeted, negative, regression, random, and LLM-output tests are clean.
- Low-quality OCR, extraction errors, or very long Prenotes are flagged for manual review instead of auto-promotion.
