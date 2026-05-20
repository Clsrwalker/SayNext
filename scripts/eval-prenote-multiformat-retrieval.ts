import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conversationLogger, type PrenoteFileRecord } from "../src/server/data/conversation-logger";
import { extractTextFromFile, processPrenote } from "../src/server/prenotes/prenote-processor";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const userId = process.argv.find((arg) => arg.includes("@")) || `eval-prenote-multiformat-${Date.now()}`;
const outDir = join("data", "eval");

const sources = {
  mitPdf: {
    id: "mit-ocw-18-085-lecture14",
    name: "MIT OCW 18.085 Lecture 14 PDF",
    url: "https://ocw.mit.edu/courses/18-085-computational-science-and-engineering-i-fall-2008/1b9d3132350905168127c7d42421f0a0_18-085F08-L14.pdf",
    license: "MIT OpenCourseWare material, CC BY-NC-SA unless otherwise noted",
  },
  wikimediaOcrImage: {
    id: "wikimedia-test-ocr-document-2",
    name: "Wikimedia Commons Test OCR document 2",
    url: "https://upload.wikimedia.org/wikipedia/commons/b/bd/Test_OCR_document_2.jpg",
    license: "Public domain scan of public domain original",
  },
};

type EvalFile = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  sourceId: string;
  expectedNeedles: string[];
  extractionOptional?: boolean;
};

type RetrievalCase = {
  id: string;
  query: string;
  expect: string;
  reject?: string;
  optional?: boolean;
  mode?: "fast" | "semantic";
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function filler(topic: string, count = 80): string {
  return Array.from({ length: count }, (_, index) => `${topic} filler ${index}: this line pads the document so retrieval must choose the right chunk.`).join("\n");
}

function buildEvalSections(): Record<string, string> {
  return {
    docx: [
      "# DOCX Deployment Review",
      "DOCX_CRITICAL_ROLLBACK: The rollout plan must include a rollback owner, a failed-migration checklist, and a smoke-test command before traffic is restored.",
      filler("docx deployment"),
    ].join("\n"),
    pptx: [
      "# PPTX API Contract",
      "PPTX_CRITICAL_API_CONTRACT: The client and server must freeze the request fields userId, sessionId, activePrenoteIds, transcriptText, and responseMode before the demo.",
      filler("pptx api"),
    ].join("\n"),
    xlsx: [
      "XLSX_CRITICAL_PRIVACY_MATRIX, Uploaded files must be classified as personal, class material, project material, or third-party reference before memory promotion.",
      filler("xlsx privacy"),
    ].join("\n"),
    xml: [
      "<note><title>Latency Budget</title><detail>XML_CRITICAL_LATENCY_BUDGET: The live assistant target is under two seconds for normal short replies and under six seconds for long answer preparation.</detail></note>",
      filler("xml latency"),
    ].join("\n"),
    html: [
      "<h1>Accessibility Review</h1><p>HTML_CRITICAL_ACCESSIBILITY: Glass display text should avoid long dense paragraphs, keep line breaks readable, and provide manual escape controls.</p>",
      filler("html accessibility"),
    ].join("\n"),
    json: JSON.stringify({
      title: "Schema migration",
      detail: "JSON_CRITICAL_SCHEMA_VERSION: Prenote chunks must store contentHash, headingPath, charStart, charEnd, embeddingModel, and tokenEstimate for reproducible reindexing.",
    }, null, 2),
    csv: [
      "metric,value",
      "CSV_CRITICAL_EVAL_RESULT,Retrieval passes only if targeted queries hit the right chunk and confusing queries do not steal unrelated chunks",
      ...Array.from({ length: 40 }, (_, index) => `filler_${index},not relevant`),
    ].join("\n"),
    md: [
      "## Chunk Retrieval Rule",
      "MD_CRITICAL_CHUNKING: Long prenotes should be fully saved but only relevant exact chunks should enter the live LLM prompt.",
      filler("md chunking"),
    ].join("\n"),
    txt: [
      "TXT_CRITICAL_SOURCE_OF_TRUTH: The original extracted text remains the source of truth; LLM summaries are not allowed to delete details.",
      filler("txt source truth"),
    ].join("\n"),
  };
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": "SayNext prenote eval; local development test" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${url}: ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function makeDocx(text: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const paragraphs = text.split(/\r?\n/).map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`).join("");
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

async function makePptx(text: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.folder("ppt")?.file("presentation.xml", `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.folder("ppt/slides")?.file("slide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>${text.split(/\r?\n/).map((line) => `<a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

async function makeXlsx(text: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const rows = text.split(/\r?\n/).filter(Boolean);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl")?.file("workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Eval" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`);
  zip.folder("xl/_rels")?.file("workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const sheetRows = rows.map((row, index) => `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${escapeXml(row)}</t></is></c></row>`).join("");
  zip.folder("xl/worksheets")?.file("sheet1.xml", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

async function buildEvalFiles(): Promise<EvalFile[]> {
  const sections = buildEvalSections();
  const generated: EvalFile[] = [
    {
      fileName: "eval-rubric.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: await makeDocx(sections.docx),
      sourceId: "generated-ooxml-open-eval",
      expectedNeedles: ["DOCX_CRITICAL_ROLLBACK"],
    },
    {
      fileName: "eval-api-contract.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: await makePptx(sections.pptx),
      sourceId: "generated-ooxml-open-eval",
      expectedNeedles: ["PPTX_CRITICAL_API_CONTRACT"],
    },
    {
      fileName: "eval-privacy.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await makeXlsx(sections.xlsx),
      sourceId: "generated-ooxml-open-eval",
      expectedNeedles: ["XLSX_CRITICAL_PRIVACY_MATRIX"],
    },
    {
      fileName: "eval-latency.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(sections.xml),
      sourceId: "generated-text-open-eval",
      expectedNeedles: ["XML_CRITICAL_LATENCY_BUDGET"],
    },
    {
      fileName: "eval-accessibility.html",
      mimeType: "text/html",
      buffer: Buffer.from(sections.html),
      sourceId: "generated-text-open-eval",
      expectedNeedles: ["HTML_CRITICAL_ACCESSIBILITY"],
    },
    {
      fileName: "eval-schema.json",
      mimeType: "application/json",
      buffer: Buffer.from(sections.json),
      sourceId: "generated-text-open-eval",
      expectedNeedles: ["JSON_CRITICAL_SCHEMA_VERSION"],
    },
    {
      fileName: "eval-result.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(sections.csv),
      sourceId: "generated-text-open-eval",
      expectedNeedles: ["CSV_CRITICAL_EVAL_RESULT"],
    },
    {
      fileName: "eval-chunking.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(sections.md),
      sourceId: "generated-text-open-eval",
      expectedNeedles: ["MD_CRITICAL_CHUNKING"],
    },
    {
      fileName: "eval-source-truth.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(sections.txt),
      sourceId: "generated-text-open-eval",
      expectedNeedles: ["TXT_CRITICAL_SOURCE_OF_TRUTH"],
    },
  ];

  const openFiles: EvalFile[] = [];
  const openDownloadErrors: string[] = [];

  try {
    openFiles.push({
      fileName: "mit-ocw-18-085-lecture14.pdf",
      mimeType: "application/pdf",
      buffer: await fetchBuffer(sources.mitPdf.url),
      sourceId: sources.mitPdf.id,
      expectedNeedles: ["Lecture", "difference", "equation"],
      extractionOptional: true,
    });
  } catch (error) {
    openDownloadErrors.push(`${sources.mitPdf.id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    openFiles.push({
      fileName: "wikimedia-test-ocr-document-2.jpg",
      mimeType: "image/jpeg",
      buffer: await fetchBuffer(sources.wikimediaOcrImage.url),
      sourceId: sources.wikimediaOcrImage.id,
      expectedNeedles: ["Charles Ball", "wife", "children"],
      extractionOptional: !process.env.OPENAI_API_KEY && !process.env.PRENOTE_VISION_MODEL,
    });
  } catch (error) {
    openDownloadErrors.push(`${sources.wikimediaOcrImage.id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const error of openDownloadErrors) {
    console.warn(`OPEN_SOURCE_DOWNLOAD_SKIPPED ${error}`);
  }

  return [...generated, ...openFiles];
}

const retrievalCases: RetrievalCase[] = [
  {
    id: "docx_rollback",
    query: "What should the rollout rollback plan include?",
    expect: "DOCX_CRITICAL_ROLLBACK",
    reject: "PPTX_CRITICAL_API_CONTRACT",
  },
  {
    id: "pptx_api_contract",
    query: "Which request fields need to be frozen before the demo?",
    expect: "PPTX_CRITICAL_API_CONTRACT",
    reject: "XLSX_CRITICAL_PRIVACY_MATRIX",
  },
  {
    id: "xlsx_privacy_matrix",
    query: "How should uploaded files be classified before memory promotion?",
    expect: "XLSX_CRITICAL_PRIVACY_MATRIX",
    reject: "DOCX_CRITICAL_ROLLBACK",
  },
  {
    id: "xml_latency_budget",
    query: "What latency budget should the live assistant target?",
    expect: "XML_CRITICAL_LATENCY_BUDGET",
    reject: "HTML_CRITICAL_ACCESSIBILITY",
  },
  {
    id: "html_accessibility",
    query: "How should glass display text be formatted?",
    expect: "HTML_CRITICAL_ACCESSIBILITY",
    reject: "JSON_CRITICAL_SCHEMA_VERSION",
  },
  {
    id: "json_schema_version",
    query: "Which fields do prenote chunks need for reproducible reindexing?",
    expect: "JSON_CRITICAL_SCHEMA_VERSION",
    reject: "CSV_CRITICAL_EVAL_RESULT",
  },
  {
    id: "csv_eval_result",
    query: "When does retrieval pass in the evaluation result?",
    expect: "CSV_CRITICAL_EVAL_RESULT",
    reject: "TXT_CRITICAL_SOURCE_OF_TRUTH",
  },
  {
    id: "md_chunking_rule",
    query: "For long prenotes, should the full text or only relevant chunks enter the live prompt?",
    expect: "MD_CRITICAL_CHUNKING",
    reject: "DOCX_CRITICAL_ROLLBACK",
  },
  {
    id: "txt_source_of_truth",
    query: "Can LLM summaries delete details from original extracted text?",
    expect: "TXT_CRITICAL_SOURCE_OF_TRUTH",
    reject: "XML_CRITICAL_LATENCY_BUDGET",
  },
  {
    id: "negative_food",
    query: "What is Xiang's favorite takeout food?",
    expect: "",
    reject: "CRITICAL_",
  },
  {
    id: "image_charles_ball",
    query: "In the OCR image, what person is named in the page heading?",
    expect: "Charles Ball",
    optional: true,
    mode: "semantic",
  },
];

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  const files = await buildEvalFiles();
  const extractedFiles: Pick<PrenoteFileRecord, "fileName" | "mimeType" | "extractedText">[] = [];
  const extractionRows: string[] = [];
  let extractionFailures = 0;

  for (const file of files) {
    const result = await extractTextFromFile(file.buffer, file.fileName, file.mimeType);
    const missingNeedles = file.expectedNeedles.filter((needle) => !result.text.toLowerCase().includes(needle.toLowerCase()));
    const ok = result.status === "ready" && (missingNeedles.length === 0 || file.extractionOptional);
    if (!ok) extractionFailures += 1;

    extractionRows.push([
      `### ${ok ? "OK" : "FAIL"} ${file.fileName}`,
      `- source: ${file.sourceId}`,
      `- status: ${result.status}`,
      `- chars: ${result.text.length}`,
      `- missingNeedles: ${missingNeedles.join(", ") || "(none)"}`,
      result.error ? `- error: ${result.error}` : "",
      "",
      "```text",
      result.text.slice(0, 800),
      "```",
    ].filter(Boolean).join("\n"));

    extractedFiles.push({
      fileName: file.fileName,
      mimeType: file.mimeType,
      extractedText: result.text,
    });
  }

  const processed = await processPrenote({
    title: `Multi-format Prenote Retrieval Eval ${timestamp}`,
    description: "Evaluates deterministic prenote extraction, chunking, embedding, and hybrid retrieval across file types.",
    sourceText: "",
    files: extractedFiles,
  });

  if (processed.model !== "deterministic:no-llm") {
    throw new Error(`Expected deterministic prenote processor, got ${processed.model}`);
  }

  const prenote = conversationLogger.createPrenote({
    userId,
    title: `Multi-format Prenote Retrieval Eval ${timestamp}`,
    sourceText: "",
    contentHash: processed.contentHash,
  });
  if (!prenote) throw new Error("Failed to create eval prenote");

  let retrievalFailures = 0;
  const retrievalRows: string[] = [];

  try {
    conversationLogger.updatePrenoteProcessing(prenote.id, {
      status: "ready",
      extractedText: processed.extractedText,
      processedJson: processed.processedJson,
      runtimeContext: processed.runtimeContext,
      model: processed.model,
      contentHash: processed.contentHash,
    });
    conversationLogger.setPrenoteActive(userId, prenote.id, true);

    const chunks = await conversationLogger.rebuildPrenoteChunks(prenote.id);

    for (const test of retrievalCases) {
      const context = await conversationLogger.getActivePrenoteRuntimeContextForQuery(userId, test.query, test.mode || "fast");
      const hasExpected = test.expect ? context.toLowerCase().includes(test.expect.toLowerCase()) : true;
      const hasRejected = test.reject ? context.toLowerCase().includes(test.reject.toLowerCase()) : false;
      const ok = test.optional ? true : hasExpected && !hasRejected;
      if (!ok) retrievalFailures += 1;

      retrievalRows.push([
        `### ${ok ? "OK" : "FAIL"} ${test.id}`,
        `- query: ${test.query}`,
        `- expect: ${test.expect || "(none)"}`,
        `- reject: ${test.reject || "(none)"}`,
        `- contextChars: ${context.length}`,
        "",
        "```text",
        context.slice(0, 1200),
        "```",
      ].join("\n"));
    }

    const report = [
      "# Prenote Multi-format Retrieval Eval",
      "",
      `- timestamp: ${new Date().toISOString()}`,
      `- userId: ${userId}`,
      `- processor: ${processed.model}`,
      `- extractedTextLength: ${processed.extractedText.length}`,
      `- chunkCount: ${chunks.length}`,
      `- embeddingModel: ${chunks[0]?.embeddingModel || "(none)"}`,
      `- extractionFailures: ${extractionFailures}`,
      `- retrievalFailures: ${retrievalFailures}`,
      "",
      "## Open Sources Used",
      "",
      `- ${sources.mitPdf.name}: ${sources.mitPdf.url} (${sources.mitPdf.license})`,
      `- ${sources.wikimediaOcrImage.name}: ${sources.wikimediaOcrImage.url} (${sources.wikimediaOcrImage.license})`,
      "",
      "## Extraction",
      "",
      ...extractionRows,
      "",
      "## Retrieval",
      "",
      ...retrievalRows,
    ].join("\n");

    const reportPath = join(outDir, `prenote-multiformat-retrieval-${timestamp}.md`);
    writeFileSync(reportPath, report, "utf8");

    console.log(`PRENOTE_MULTIFORMAT_REPORT ${reportPath}`);
    console.log(`PRENOTE_MULTIFORMAT_SUMMARY extractionFailures=${extractionFailures} retrievalFailures=${retrievalFailures} chunks=${chunks.length} embeddingModel=${chunks[0]?.embeddingModel || "(none)"}`);

    if (extractionFailures > 0 || retrievalFailures > 0) {
      process.exit(1);
    }
  } finally {
    conversationLogger.deletePrenote(userId, prenote.id);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
