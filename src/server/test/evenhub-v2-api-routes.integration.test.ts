import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("EvenHub v2 HTTP routes persist settings, prenotes, transcripts, cues, and deletion in isolated SQLite", async () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "saynext-evenhub-v2-api-"));
  const resolvedTempDirectory = resolve(tempDirectory);
  const probePath = resolve(import.meta.dir, "fixtures", "evenhub-v2-api-route-probe.ts");

  try {
    const child = Bun.spawn([process.execPath, "run", probePath], {
      cwd: resolve(import.meta.dir, "..", "..", ".."),
      env: {
        ...process.env,
        DATA_LOGGING_ENABLED: "true",
        SAYNEXT_DB_PATH: join(resolvedTempDirectory, "route-integration.sqlite"),
        EVENHUB_DEFAULT_USER_ID: "route-integration-user",
        EVENHUB_V2_ALLOW_QUERY_USER_ID: "false",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode, stderr).toBe(0);
    const result = JSON.parse(stdout.trim()) as Record<string, any>;

    expect(result.invalidSettingsStatus).toBe(400);
    expect(result.settingsStatus).toBe(200);
    expect(result.settings).toMatchObject({
      settingsSource: "saved",
      settings: {
        language: "chinese",
        cueDurationMs: "forever",
        autoPopup: false,
        showAiCue: false,
        showTranscript: true,
      },
    });

    expect(result.prenoteStatus).toBe(201);
    expect(result.prenote.prenote).toMatchObject({
      title: "Route integration note",
      text: "Use the verified project details from this prepared note.",
      selected: true,
    });
    expect(result.bootstrapStatus).toBe(200);
    expect(result.bootstrap.settingsSource).toBe("saved");
    expect(result.bootstrap.prenotes).toHaveLength(1);

    expect(result.updatePrenoteStatus).toBe(200);
    expect(result.updatedPrenote.prenote).toMatchObject({
      id: result.prenote.prenote.id,
      title: "Updated route note",
      text: "Use the updated project details after this edit.",
      selected: false,
    });
    expect(result.selectPrenoteStatus).toBe(200);
    expect(result.selectedPrenote.prenote.selected).toBe(true);
    expect(result.updatedBootstrapStatus).toBe(200);
    expect(result.updatedBootstrap.prenotes).toEqual([
      expect.objectContaining({
        title: "Updated route note",
        text: "Use the updated project details after this edit.",
        selected: true,
      }),
    ]);
    expect(result.forbiddenPrenoteUpdateStatus).toBe(404);
    expect(result.forbiddenPrenoteDeleteStatus).toBe(404);

    expect(result.detailStatus).toBe(200);
    expect(result.detail.transcript).toEqual([
      expect.objectContaining({
        id: "route-line-1",
        text: "Please implement a small add function.",
      }),
    ]);
    expect(result.detail.cues).toEqual([
      expect.objectContaining({
        id: "route-cue-1",
        category: "code",
        language: "typescript",
        code: "function add(a: number, b: number): number {\n  return a + b;\n}",
      }),
    ]);
    expect(result.detail.conversation.usedPrenote).toMatchObject({
      text: "Use the verified project details from this prepared note.",
    });

    expect(result.deletePrenoteStatus).toBe(200);
    expect(result.deletedPrenote).toEqual({
      deleted: true,
      id: result.prenote.prenote.id,
    });
    expect(result.bootstrapAfterPrenoteDeleteStatus).toBe(200);
    expect(result.bootstrapAfterPrenoteDelete.prenotes).toEqual([]);

    expect(result.forbiddenDetailStatus).toBe(404);
    expect(result.deleteStatus).toBe(200);
    expect(result.deleted).toEqual({
      deleted: true,
      id: "route-integration-conversation",
    });
    expect(result.missingAfterDeleteStatus).toBe(404);
    expect(result.corsStatus).toBe(204);
    expect(result.corsOrigin).toBe("*");
  } finally {
    if (resolvedTempDirectory.startsWith(resolve(tmpdir()))) {
      rmSync(resolvedTempDirectory, { recursive: true, force: true });
    }
  }
});
