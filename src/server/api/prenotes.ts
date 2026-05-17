import type { Context } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { conversationLogger, type PrenoteRecord } from "../data/conversation-logger";
import { extractTextFromFile, processPrenote } from "../prenotes/prenote-processor";

const PRENOTE_UPLOAD_DIR = process.env.PRENOTE_UPLOAD_DIR || join(process.cwd(), "data", "prenote-files");

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "file";
}

function serializePrenote(prenote: PrenoteRecord, options: { includeFullText?: boolean } = {}) {
  return {
    id: prenote.id,
    userId: prenote.userId,
    title: prenote.title,
    description: prenote.description,
    status: prenote.status,
    isActive: prenote.isActive,
    runtimeContext: prenote.runtimeContext,
    model: prenote.model,
    error: prenote.error,
    createdAt: prenote.createdAt,
    updatedAt: prenote.updatedAt,
    ...(options.includeFullText
      ? {
          sourceText: prenote.sourceText,
          extractedText: prenote.extractedText,
          processedJson: prenote.processedJson,
          contentHash: prenote.contentHash,
        }
      : {}),
    files: conversationLogger.listPrenoteFiles(prenote.id).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      status: file.status,
      error: file.error,
      extractedTextLength: file.extractedText.length,
      createdAt: file.createdAt,
    })),
    sourceTextLength: prenote.sourceText.length,
    extractedTextLength: prenote.extractedText.length,
    runtimeContextLength: prenote.runtimeContext.length,
  };
}

function getUserId(c: Context): string | null {
  return c.req.query("userId") || null;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function inferPrenoteTitle(input: { title: string; sourceText: string; files: File[] }): string {
  if (input.title.trim()) return input.title.trim();

  const firstFile = input.files[0];
  if (firstFile?.name) {
    return stripExtension(firstFile.name).slice(0, 80) || "Uploaded prenote";
  }

  const firstLine = input.sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstLine) {
    return firstLine.slice(0, 80);
  }

  return `Prenote ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

async function readJsonBody(c: Context): Promise<Record<string, any> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

export const listPrenotes = (c: Context) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const prenotes = conversationLogger.listPrenotes(userId).map((prenote) => serializePrenote(prenote));
  return c.json({ prenotes });
};

export const getPrenote = (c: Context) => {
  const userId = getUserId(c);
  const id = Number(c.req.param("id"));
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid prenote id" }, 400);

  const prenote = conversationLogger.getPrenote(id);
  if (!prenote || prenote.userId !== userId) return c.json({ error: "Prenote not found" }, 404);

  return c.json({ prenote: serializePrenote(prenote, { includeFullText: true }) });
};

export const createPrenote = async (c: Context) => {
  const formData = await c.req.raw.formData();
  const userId = String(formData.get("userId") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const sourceText = String(formData.get("sourceText") || "").trim();
  const setActive = String(formData.get("setActive") || "true") !== "false";
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const inferredTitle = inferPrenoteTitle({ title, sourceText, files });

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!sourceText && files.length === 0) return c.json({ error: "Add text or upload at least one file" }, 400);

  const prenote = conversationLogger.createPrenote({ userId, title: inferredTitle, description, sourceText });
  if (!prenote) return c.json({ error: "Prenote storage is disabled" }, 503);

  const uploadedFiles = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = safePathPart(file.name || "upload");
    const relativeDir = join(safePathPart(userId), String(prenote.id));
    const dir = join(PRENOTE_UPLOAD_DIR, relativeDir);
    mkdirSync(dir, { recursive: true });

    const filePath = join(dir, `${randomUUID()}-${safeName}`);
    writeFileSync(filePath, buffer);

    const extracted = await extractTextFromFile(buffer, file.name || safeName, file.type || "");
    const record = conversationLogger.createPrenoteFile({
      prenoteId: prenote.id,
      fileName: file.name || safeName,
      mimeType: file.type || "",
      filePath,
      sizeBytes: file.size,
      extractedText: extracted.text,
      status: extracted.status,
      error: extracted.error ?? "",
    });

    if (record) uploadedFiles.push(record);
  }

  const processed = await processPrenote({
    title: inferredTitle,
    description,
    sourceText,
    files: uploadedFiles,
  });

  const extractionErrors = uploadedFiles.filter((file) => file.status === "error").map((file) => `${file.fileName}: ${file.error}`);
  const updated = conversationLogger.updatePrenoteProcessing(prenote.id, {
    status: "ready",
    extractedText: processed.extractedText,
    processedJson: processed.processedJson,
    runtimeContext: processed.runtimeContext,
    model: processed.model,
    contentHash: processed.contentHash,
    error: extractionErrors.join("\n"),
  });

  if (setActive) {
    conversationLogger.setPrenoteActive(userId, prenote.id, true);
  }

  const finalPrenote = conversationLogger.getPrenote(prenote.id) ?? updated ?? prenote;
  return c.json({ prenote: serializePrenote(finalPrenote) }, 201);
};

export const updatePrenote = async (c: Context) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid prenote id" }, 400);

  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const userId = String(body.userId || "").trim();
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const prenote = conversationLogger.getPrenote(id);
  if (!prenote || prenote.userId !== userId) return c.json({ error: "Prenote not found" }, 404);

  if (typeof body.runtimeContext === "string" || typeof body.title === "string") {
    const updated = conversationLogger.updatePrenoteMemory(userId, id, {
      title: typeof body.title === "string" ? body.title : undefined,
      runtimeContext: typeof body.runtimeContext === "string" ? body.runtimeContext : undefined,
    });
    if (!updated) return c.json({ error: "Prenote not found" }, 404);
    return c.json({ prenote: serializePrenote(updated) });
  }

  if (body.active === true) {
    const active = conversationLogger.setPrenoteActive(userId, id, true);
    return c.json({ prenote: active ? serializePrenote(active) : null });
  }

  if (body.active === false) {
    const inactive = conversationLogger.setPrenoteActive(userId, id, false);
    return c.json({ prenote: serializePrenote(inactive ?? conversationLogger.getPrenote(id) ?? prenote) });
  }

  return c.json({ prenote: serializePrenote(prenote) });
};

export const deletePrenote = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = (await readJsonBody(c)) ?? {};
  const userId = String(body.userId || c.req.query("userId") || "").trim();
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid prenote id" }, 400);

  const deleted = conversationLogger.deletePrenote(userId, id);
  if (!deleted) return c.json({ error: "Prenote not found" }, 404);

  return c.json({ ok: true });
};
