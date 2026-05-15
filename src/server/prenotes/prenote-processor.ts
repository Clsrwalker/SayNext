import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { PrenoteFileRecord } from "../data/conversation-logger";

const PRENOTE_MODEL = process.env.PRENOTE_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const PRENOTE_MAX_PROCESS_CHARS = Number(process.env.PRENOTE_MAX_PROCESS_CHARS || 180000);

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
      model: PRENOTE_MODEL,
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

export async function extractTextFromFile(buffer: Buffer, fileName: string, mimeType: string): Promise<ExtractedFileContent> {
  try {
    const ext = extensionOf(fileName);

    if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "heic"].includes(ext)) {
      return { text: normalizeWhitespace(await extractImageWithOpenAI(buffer, mimeType, fileName)), status: "ready" };
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

function truncateForProcessing(text: string): { text: string; wasTruncated: boolean } {
  if (text.length <= PRENOTE_MAX_PROCESS_CHARS) {
    return { text, wasTruncated: false };
  }

  return {
    text: text.slice(0, PRENOTE_MAX_PROCESS_CHARS),
    wasTruncated: true,
  };
}

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  return cleaned.slice(first, last + 1);
}

function buildFallbackRuntimeContext(title: string, text: string): string {
  const compact = normalizeWhitespace(text).slice(0, 5000);
  return [
    `Prenote: ${title}`,
    "Use this as prepared scene context.",
    compact,
  ].filter(Boolean).join("\n");
}

export async function processPrenote(input: ProcessPrenoteInput): Promise<ProcessedPrenote> {
  const fullText = buildFullPrenoteText(input);
  const contentHash = createHash("sha256").update(`${input.title}\n${input.description ?? ""}\n${fullText}`).digest("hex");

  if (!fullText) {
    return {
      extractedText: "",
      processedJson: JSON.stringify({ title: input.title, error: "No readable text extracted" }),
      runtimeContext: `Prenote: ${input.title}\nNo readable text was extracted. Use only the title as weak context.`,
      model: null,
      contentHash,
    };
  }

  const prepared = truncateForProcessing(fullText);
  const prompt = `You are preparing a PreNote memory for SayNext, a real-time glasses conversation assistant.

Read the material carefully. Clean noisy text, understand the scene, and produce a runtime memory that can be inserted into future prompts.

Requirements:
- Preserve the important meaning from the material.
- Be specific and useful for answering questions or adding knowledge supplements.
- Include key terms, definitions, mechanisms, examples, formulas, requirements, names, dates, rubrics, and likely questions when present.
- Do not invent facts outside the material.
- Runtime context should be concise but rich enough for real-time use.
- If the material was truncated, say that in processed_json.

Return only JSON:
{
  "title": "short title",
  "scene": "classroom | interview | meeting | service | casual | other",
  "cleaned_outline": ["..."],
  "key_terms": [{"term":"...","meaning":"...","example":"..."}],
  "important_points": ["..."],
  "likely_questions": ["..."],
  "useful_examples": ["..."],
  "answer_strategy": "how SayNext should use this prenote",
  "runtime_context": "direct prompt-ready memory, dense and useful",
  "was_truncated": ${prepared.wasTruncated}
}

Title: ${input.title}
Description: ${input.description ?? ""}

Material:
${prepared.text}`;

  try {
    const responseText = await callOpenAIResponses([{ type: "input_text", text: prompt }]);
    const jsonText = extractJsonObject(responseText);
    const parsed = jsonText ? JSON.parse(jsonText) : null;
    const runtimeContext = typeof parsed?.runtime_context === "string"
      ? parsed.runtime_context
      : buildFallbackRuntimeContext(input.title, responseText || fullText);

    return {
      extractedText: fullText,
      processedJson: jsonText ?? JSON.stringify({ title: input.title, responseText }),
      runtimeContext,
      model: PRENOTE_MODEL,
      contentHash,
    };
  } catch (error) {
    const fallback = buildFallbackRuntimeContext(input.title, fullText);
    return {
      extractedText: fullText,
      processedJson: JSON.stringify({
        title: input.title,
        error: error instanceof Error ? error.message : "Unknown prenote processing error",
      }),
      runtimeContext: fallback,
      model: null,
      contentHash,
    };
  }
}
