import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { PrenoteFileRecord } from "../data/conversation-logger";

const OPENAI_PRENOTE_MODEL = process.env.PRENOTE_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OLLAMA_PRENOTE_MODEL = process.env.PRENOTE_OLLAMA_MODEL || process.env.OLLAMA_MODEL || "qwen2.5:14b-instruct";
const PRENOTE_VISION_MODEL = process.env.PRENOTE_VISION_MODEL || "";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 30000);
const PRENOTE_RUNTIME_CONTEXT_MAX_CHARS = Number(process.env.PRENOTE_RUNTIME_CONTEXT_MAX_CHARS || 0);
const LOSSLESS_RUNTIME_MARKER = "Complete prenote material follows. This is not a summary.";

export interface ExtractedFileContent {
  text: string;
  status: "ready" | "error";
  error?: string;
}

export interface ProcessPrenoteInput {
  title: string;
  description?: string;
  sourceText: string;
  files: Pick<PrenoteFileRecord, "fileName" | "mimeType" | "extractedText">[];
}

export interface ProcessedPrenote {
  extractedText: string;
  processedJson: string;
  runtimeContext: string;
  model: string | null;
  contentHash: string;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function stripXmlTags(xml: string): string {
  return normalizeWhitespace(
    xml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " "),
  );
}

function extensionOf(fileName: string): string {
  return extname(fileName).toLowerCase().replace(/^\./, "");
}

function isTextLike(fileName: string, mimeType: string): boolean {
  const ext = extensionOf(fileName);
  return (
    mimeType.startsWith("text/") ||
    [
      "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "html", "htm",
      "yaml", "yml", "log", "rtf", "ini", "conf", "config", "env", "sql", "js", "ts",
      "tsx", "jsx", "py", "java", "c", "cpp", "cs", "go", "rs", "php", "rb", "sh",
    ].includes(ext)
  );
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeWhitespace(result.text || "");
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(result.value || "");
}

async function extractOfficeZipXml(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const xmlFiles = Object.values(zip.files)
    .filter((file) => !file.dir && /\.xml$/i.test(file.name))
    .filter((file) => /^(word|ppt|xl)\//i.test(file.name))
    .slice(0, 120);

  const parts: string[] = [];
  for (const file of xmlFiles) {
    const xml = await file.async("string");
    const text = stripXmlTags(xml);
    if (text.length > 20) {
      parts.push(`[${file.name}]\n${text}`);
    }
  }

  return normalizeWhitespace(parts.join("\n\n"));
}

async function callOpenAIResponses(content: any[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_PRENOTE_MODEL,
      input: [{ role: "user", content }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI prenote request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (typeof data.output_text === "string") return data.output_text;

  const texts: string[] = [];
  for (const item of data.output ?? []) {
    for (const contentItem of item.content ?? []) {
      if (typeof contentItem.text === "string") texts.push(contentItem.text);
    }
  }

  return texts.join("\n").trim();
}

async function callOllamaGenerate(prompt: string, options: { model?: string; images?: string[] } = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      model: options.model || OLLAMA_PRENOTE_MODEL,
      prompt,
      images: options.images,
      stream: false,
      options: {
        temperature: 0.1,
        top_p: 0.9,
        num_ctx: 8192,
        num_predict: 1800,
      },
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(`Ollama prenote request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return String(data.response ?? "").trim();
}

async function extractImageWithOpenAI(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const imageUrl = `data:${mimeType || "image/png"};base64,${buffer.toString("base64")}`;
  return callOpenAIResponses([
    {
      type: "input_text",
      text: `Extract all readable text from this image and describe any important visual context for a conversation assistant. File name: ${fileName}. Return concise plain text.`,
    },
    { type: "input_image", image_url: imageUrl },
  ]);
}

async function extractImageText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    return extractImageWithOpenAI(buffer, mimeType, fileName);
  }

  if (PRENOTE_VISION_MODEL) {
    return callOllamaGenerate(
      `Extract all readable text from this image and describe important visual context for a conversation assistant. File name: ${fileName}. Return concise plain text.`,
      { model: PRENOTE_VISION_MODEL, images: [buffer.toString("base64")] },
    );
  }

  throw new Error("Image OCR needs OPENAI_API_KEY or PRENOTE_VISION_MODEL with a local vision model.");
}

export async function extractTextFromFile(buffer: Buffer, fileName: string, mimeType: string): Promise<ExtractedFileContent> {
  try {
    const ext = extensionOf(fileName);

    if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "heic"].includes(ext)) {
      return { text: normalizeWhitespace(await extractImageText(buffer, mimeType, fileName)), status: "ready" };
    }

    if (mimeType === "application/pdf" || ext === "pdf") {
      return { text: await extractPdf(buffer), status: "ready" };
    }

    if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return { text: await extractDocx(buffer), status: "ready" };
    }

    if (["pptx", "xlsx"].includes(ext) || mimeType.includes("openxmlformats-officedocument")) {
      return { text: await extractOfficeZipXml(buffer), status: "ready" };
    }

    if (isTextLike(fileName, mimeType)) {
      const raw = buffer.toString("utf8");
      const text = ["xml", "html", "htm"].includes(ext) || mimeType.includes("xml") || mimeType.includes("html")
        ? stripXmlTags(raw)
        : normalizeWhitespace(raw);
      return { text, status: "ready" };
    }

    return {
      text: "",
      status: "error",
      error: `Unsupported file type for automatic text extraction: ${mimeType || ext || "unknown"}`,
    };
  } catch (error) {
    return {
      text: "",
      status: "error",
      error: error instanceof Error ? error.message : "Unknown extraction error",
    };
  }
}

function buildFullPrenoteText(input: ProcessPrenoteInput): string {
  const parts = [
    input.sourceText.trim() ? `[User text]\n${input.sourceText.trim()}` : "",
    ...input.files.map((file) => file.extractedText.trim() ? `[File: ${file.fileName}]\n${file.extractedText.trim()}` : ""),
  ].filter(Boolean);

  return normalizeWhitespace(parts.join("\n\n"));
}

function buildFallbackRuntimeContext(title: string, text: string): string {
  return buildLosslessRuntimeContext(title, text);
}

function compactPrenoteMaterial(text: string): string {
  return normalizeWhitespace(
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
      .join("\n"),
  );
}

export function buildLosslessRuntimeContext(title: string, text: string): string {
  const compact = compactPrenoteMaterial(text);
  const maxChars = PRENOTE_RUNTIME_CONTEXT_MAX_CHARS > 0 ? PRENOTE_RUNTIME_CONTEXT_MAX_CHARS : Infinity;
  const wasLimited = compact.length > maxChars;
  const material = wasLimited ? compact.slice(0, maxChars) : compact;

  return [
    `Prenote: ${title}`,
    LOSSLESS_RUNTIME_MARKER,
    wasLimited
      ? `Runtime context was limited by PRENOTE_RUNTIME_CONTEXT_MAX_CHARS=${PRENOTE_RUNTIME_CONTEXT_MAX_CHARS}. Full extracted text is still stored in the prenote detail.`
      : "Whitespace was normalized, but details were not summarized away by the LLM.",
    material,
  ].filter(Boolean).join("\n");
}

export function isLosslessPrenoteRuntimeContext(context: string): boolean {
  return context.includes(LOSSLESS_RUNTIME_MARKER);
}

export async function processPrenote(input: ProcessPrenoteInput): Promise<ProcessedPrenote> {
  const fullText = buildFullPrenoteText(input);
  const contentHash = createHash("sha256").update(`${input.title}\n${input.description ?? ""}\n${fullText}`).digest("hex");

  if (!fullText) {
    return {
      extractedText: "",
      processedJson: JSON.stringify({
        title: input.title,
        processor: "deterministic-no-llm",
        error: "No readable text extracted",
      }),
      runtimeContext: `Prenote: ${input.title}\nNo readable text was extracted. Use only the title as weak context.`,
      model: null,
      contentHash,
    };
  }

  const runtimeContext = buildFallbackRuntimeContext(input.title, fullText);
  const fileNames = input.files.map((file) => file.fileName).filter(Boolean);

  return {
    extractedText: fullText,
    processedJson: JSON.stringify({
      title: input.title,
      description: input.description ?? "",
      processor: "deterministic-no-llm",
      sourceTextLength: input.sourceText.trim().length,
      extractedTextLength: fullText.length,
      fileCount: input.files.length,
      fileNames,
      contentHash,
      sourceOfTruth: "Full extracted prenote text is stored losslessly. Runtime uses retrieved exact chunks, not an LLM summary.",
    }),
    runtimeContext,
    model: "deterministic:no-llm",
    contentHash,
  };
}
