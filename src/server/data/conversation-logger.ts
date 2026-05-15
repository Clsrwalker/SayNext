import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

export interface ConversationSampleRecord {
  id: number;
  userId: string;
  sessionId: string;
  timestamp: string;
  language: string | null;
  transcript: string;
  aiReply: string | null;
  actionType: string;
  reasoning: string | null;
  model: string | null;
  profileVersion: string | null;
  retrievedSampleIds: string[];
  natural: number | null;
  short: number | null;
  fitsXiang: number | null;
  tooOfficial: boolean | null;
  directlySayable: boolean | null;
  inventedInfo: boolean | null;
  idealReply: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationSampleInput {
  userId: string;
  sessionId: string;
  timestamp: number;
  language?: string | null;
  transcript: string;
  aiReply?: string | null;
  actionType: string;
  reasoning?: string | null;
  model?: string | null;
  profileVersion?: string | null;
  retrievedSampleIds?: string[];
}

export interface UpdateConversationSampleInput {
  natural?: number | null;
  short?: number | null;
  fitsXiang?: number | null;
  tooOfficial?: boolean | null;
  directlySayable?: boolean | null;
  inventedInfo?: boolean | null;
  idealReply?: string;
  notes?: string;
}

export interface ConversationEventRecord {
  id: string;
  userId: string;
  sessionId: string;
  scene: string;
  title: string;
  summary: string;
  status: string;
  startTimestamp: string;
  lastTimestamp: string;
  transcriptCount: number;
  aiReplyCount: number;
  rawTranscript: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertConversationEventInput {
  id: string;
  userId: string;
  sessionId: string;
  scene: string;
  title: string;
  summary: string;
  status: "active" | "closed";
  startTimestamp: number;
  lastTimestamp: number;
  transcriptCount: number;
  aiReplyCount: number;
  rawTranscript: string;
}

export interface PersonalizationPipelineRunRecord {
  id: number;
  sourceType: string;
  sourceId: string;
  userId: string;
  status: string;
  model: string | null;
  rawTranscript: string;
  rawOutput: string | null;
  cleanedTranscript: string;
  cleanedOutput: string;
  segmentsJson: string;
  contextJson: string;
  eventJson: string;
  outputIntentJson: string;
  qualityJson: string;
  pseudoLabel: string;
  reviewPriority: string;
  needsReview: boolean;
  memoryJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPersonalizationPipelineRunInput {
  sourceType: "sample" | "event";
  sourceId: string;
  userId: string;
  status: "processed" | "failed";
  model?: string | null;
  rawTranscript: string;
  rawOutput?: string | null;
  cleanedTranscript?: string;
  cleanedOutput?: string;
  segmentsJson?: string;
  contextJson?: string;
  eventJson?: string;
  outputIntentJson?: string;
  qualityJson?: string;
  pseudoLabel?: string;
  reviewPriority?: "low" | "medium" | "high";
  needsReview?: boolean;
  memoryJson?: string;
  error?: string;
}

export interface PersonalMemoryItemRecord {
  id: number;
  userId: string;
  sourceRunId: number;
  memoryType: string;
  content: string;
  tagsJson: string;
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonalMemoryItemInput {
  userId: string;
  sourceRunId: number;
  memoryType: string;
  content: string;
  tags?: string[];
  confidence?: number;
  status?: "active" | "archived";
}

const DEFAULT_DB_PATH = join(process.cwd(), "data", "saynext.sqlite");

function boolFromDb(value: number | null): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function boolToDb(value: boolean | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value ? 1 : 0;
}

function mergeBoolForDb(updateValue: boolean | null | undefined, existingValue: boolean | null): number | null {
  if (updateValue !== undefined) {
    return boolToDb(updateValue) ?? null;
  }

  return boolToDb(existingValue) ?? null;
}

function mapRecord(row: any): ConversationSampleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    language: row.language,
    transcript: row.transcript,
    aiReply: row.ai_reply,
    actionType: row.action_type,
    reasoning: row.reasoning,
    model: row.model,
    profileVersion: row.profile_version,
    retrievedSampleIds: JSON.parse(row.retrieved_sample_ids || "[]"),
    natural: row.rating_natural,
    short: row.rating_short,
    fitsXiang: row.rating_fits_xiang,
    tooOfficial: boolFromDb(row.too_official),
    directlySayable: boolFromDb(row.directly_sayable),
    inventedInfo: boolFromDb(row.invented_info),
    idealReply: row.ideal_reply || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRecord(row: any): ConversationEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    scene: row.scene,
    title: row.title,
    summary: row.summary,
    status: row.status,
    startTimestamp: row.start_timestamp,
    lastTimestamp: row.last_timestamp,
    transcriptCount: row.transcript_count,
    aiReplyCount: row.ai_reply_count,
    rawTranscript: row.raw_transcript || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPipelineRunRecord(row: any): PersonalizationPipelineRunRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    userId: row.user_id,
    status: row.status,
    model: row.model,
    rawTranscript: row.raw_transcript,
    rawOutput: row.raw_output,
    cleanedTranscript: row.cleaned_transcript || "",
    cleanedOutput: row.cleaned_output || "",
    segmentsJson: row.segments_json || "[]",
    contextJson: row.context_json || "{}",
    eventJson: row.event_json || "{}",
    outputIntentJson: row.output_intent_json || "{}",
    qualityJson: row.quality_json || "{}",
    pseudoLabel: row.pseudo_label || "",
    reviewPriority: row.review_priority || "low",
    needsReview: Boolean(row.needs_review),
    memoryJson: row.memory_json || "{}",
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPersonalMemoryItemRecord(row: any): PersonalMemoryItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceRunId: row.source_run_id,
    memoryType: row.memory_type,
    content: row.content,
    tagsJson: row.tags_json || "[]",
    confidence: row.confidence ?? 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ConversationLogger {
  private db: Database | null = null;
  private initialized = false;

  isEnabled(): boolean {
    return process.env.DATA_LOGGING_ENABLED !== "false";
  }

  private getDb(): Database {
    if (!this.isEnabled()) {
      throw new Error("Conversation logging is disabled");
    }

    if (!this.db) {
      const dbPath = process.env.SAYNEXT_DB_PATH || DEFAULT_DB_PATH;
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA foreign_keys = ON");
    }

    if (!this.initialized) {
      this.initialize();
    }

    return this.db;
  }

  private initialize(): void {
    const db = this.db;
    if (!db) return;

    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        language TEXT,
        transcript TEXT NOT NULL,
        ai_reply TEXT,
        action_type TEXT NOT NULL,
        reasoning TEXT,
        model TEXT,
        profile_version TEXT,
        retrieved_sample_ids TEXT NOT NULL DEFAULT '[]',
        rating_natural INTEGER,
        rating_short INTEGER,
        rating_fits_xiang INTEGER,
        too_official INTEGER,
        directly_sayable INTEGER,
        invented_info INTEGER,
        ideal_reply TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_conversation_samples_user_time ON conversation_samples(user_id, timestamp DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        scene TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        start_timestamp TEXT NOT NULL,
        last_timestamp TEXT NOT NULL,
        transcript_count INTEGER NOT NULL DEFAULT 0,
        ai_reply_count INTEGER NOT NULL DEFAULT 0,
        raw_transcript TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_conversation_events_user_time ON conversation_events(user_id, last_timestamp DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS personalization_pipeline_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT,
        raw_transcript TEXT NOT NULL,
        raw_output TEXT,
        cleaned_transcript TEXT NOT NULL DEFAULT '',
        cleaned_output TEXT NOT NULL DEFAULT '',
        segments_json TEXT NOT NULL DEFAULT '[]',
        context_json TEXT NOT NULL DEFAULT '{}',
        event_json TEXT NOT NULL DEFAULT '{}',
        output_intent_json TEXT NOT NULL DEFAULT '{}',
        quality_json TEXT NOT NULL DEFAULT '{}',
        pseudo_label TEXT NOT NULL DEFAULT '',
        review_priority TEXT NOT NULL DEFAULT 'low',
        needs_review INTEGER NOT NULL DEFAULT 0,
        memory_json TEXT NOT NULL DEFAULT '{}',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_type, source_id)
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_user_time ON personalization_pipeline_runs(user_id, updated_at DESC)");
    db.run("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_review ON personalization_pipeline_runs(user_id, needs_review, review_priority)");

    db.run(`
      CREATE TABLE IF NOT EXISTS personal_memory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source_run_id INTEGER NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_run_id, memory_type, content)
      )
    `);

    db.run("CREATE INDEX IF NOT EXISTS idx_personal_memory_user ON personal_memory_items(user_id, status, updated_at DESC)");
    this.initialized = true;
  }

  createSample(input: CreateConversationSampleInput): ConversationSampleRecord | null {
    if (!this.isEnabled()) return null;

    const db = this.getDb();
    const result = db
      .query(`
        INSERT INTO conversation_samples (
          user_id, session_id, timestamp, language, transcript, ai_reply,
          action_type, reasoning, model, profile_version, retrieved_sample_ids
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.userId,
        input.sessionId,
        new Date(input.timestamp).toISOString(),
        input.language ?? null,
        input.transcript,
        input.aiReply ?? null,
        input.actionType,
        input.reasoning ?? null,
        input.model ?? null,
        input.profileVersion ?? null,
        JSON.stringify(input.retrievedSampleIds ?? []),
      );

    return this.getSample(Number(result.lastInsertRowid));
  }

  getSample(id: number): ConversationSampleRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM conversation_samples WHERE id = ?")
      .get(id);

    return row ? mapRecord(row) : null;
  }

  listSamples(userId: string, limit = 50): ConversationSampleRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM conversation_samples WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapRecord);
  }

  updateSample(id: number, input: UpdateConversationSampleInput): ConversationSampleRecord | null {
    if (!this.isEnabled()) return null;

    const existing = this.getSample(id);
    if (!existing) return null;

    this.getDb()
      .query(`
        UPDATE conversation_samples
        SET
          rating_natural = ?,
          rating_short = ?,
          rating_fits_xiang = ?,
          too_official = ?,
          directly_sayable = ?,
          invented_info = ?,
          ideal_reply = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(
        input.natural ?? existing.natural,
        input.short ?? existing.short,
        input.fitsXiang ?? existing.fitsXiang,
        mergeBoolForDb(input.tooOfficial, existing.tooOfficial),
        mergeBoolForDb(input.directlySayable, existing.directlySayable),
        mergeBoolForDb(input.inventedInfo, existing.inventedInfo),
        input.idealReply ?? existing.idealReply,
        input.notes ?? existing.notes,
        id,
      );

    return this.getSample(id);
  }

  upsertEvent(input: UpsertConversationEventInput): ConversationEventRecord | null {
    if (!this.isEnabled()) return null;

    this.getDb()
      .query(`
        INSERT INTO conversation_events (
          id, user_id, session_id, scene, title, summary, status,
          start_timestamp, last_timestamp, transcript_count, ai_reply_count, raw_transcript
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scene = excluded.scene,
          title = excluded.title,
          summary = excluded.summary,
          status = excluded.status,
          last_timestamp = excluded.last_timestamp,
          transcript_count = excluded.transcript_count,
          ai_reply_count = excluded.ai_reply_count,
          raw_transcript = excluded.raw_transcript,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.id,
        input.userId,
        input.sessionId,
        input.scene,
        input.title,
        input.summary,
        input.status,
        new Date(input.startTimestamp).toISOString(),
        new Date(input.lastTimestamp).toISOString(),
        input.transcriptCount,
        input.aiReplyCount,
        input.rawTranscript,
      );

    return this.getEvent(input.id);
  }

  getEvent(id: string): ConversationEventRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM conversation_events WHERE id = ?")
      .get(id);

    return row ? mapEventRecord(row) : null;
  }

  listEvents(userId: string, limit = 50): ConversationEventRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM conversation_events WHERE user_id = ? ORDER BY last_timestamp DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapEventRecord);
  }

  upsertPipelineRun(input: UpsertPersonalizationPipelineRunInput): PersonalizationPipelineRunRecord | null {
    if (!this.isEnabled()) return null;

    this.getDb()
      .query(`
        INSERT INTO personalization_pipeline_runs (
          source_type, source_id, user_id, status, model, raw_transcript, raw_output,
          cleaned_transcript, cleaned_output, segments_json, context_json, event_json,
          output_intent_json, quality_json, pseudo_label, review_priority, needs_review,
          memory_json, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_type, source_id) DO UPDATE SET
          user_id = excluded.user_id,
          status = excluded.status,
          model = excluded.model,
          raw_transcript = excluded.raw_transcript,
          raw_output = excluded.raw_output,
          cleaned_transcript = excluded.cleaned_transcript,
          cleaned_output = excluded.cleaned_output,
          segments_json = excluded.segments_json,
          context_json = excluded.context_json,
          event_json = excluded.event_json,
          output_intent_json = excluded.output_intent_json,
          quality_json = excluded.quality_json,
          pseudo_label = excluded.pseudo_label,
          review_priority = excluded.review_priority,
          needs_review = excluded.needs_review,
          memory_json = excluded.memory_json,
          error = excluded.error,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.sourceType,
        input.sourceId,
        input.userId,
        input.status,
        input.model ?? null,
        input.rawTranscript,
        input.rawOutput ?? null,
        input.cleanedTranscript ?? "",
        input.cleanedOutput ?? "",
        input.segmentsJson ?? "[]",
        input.contextJson ?? "{}",
        input.eventJson ?? "{}",
        input.outputIntentJson ?? "{}",
        input.qualityJson ?? "{}",
        input.pseudoLabel ?? "",
        input.reviewPriority ?? "low",
        input.needsReview ? 1 : 0,
        input.memoryJson ?? "{}",
        input.error ?? "",
      );

    return this.getPipelineRunBySource(input.sourceType, input.sourceId);
  }

  getPipelineRunBySource(sourceType: string, sourceId: string): PersonalizationPipelineRunRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM personalization_pipeline_runs WHERE source_type = ? AND source_id = ?")
      .get(sourceType, sourceId);

    return row ? mapPipelineRunRecord(row) : null;
  }

  listPipelineRuns(userId: string, limit = 50): PersonalizationPipelineRunRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM personalization_pipeline_runs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapPipelineRunRecord);
  }

  createPersonalMemoryItem(input: CreatePersonalMemoryItemInput): PersonalMemoryItemRecord | null {
    if (!this.isEnabled()) return null;

    const result = this.getDb()
      .query(`
        INSERT INTO personal_memory_items (
          user_id, source_run_id, memory_type, content, tags_json, confidence, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_run_id, memory_type, content) DO UPDATE SET
          tags_json = excluded.tags_json,
          confidence = excluded.confidence,
          status = excluded.status,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.userId,
        input.sourceRunId,
        input.memoryType,
        input.content,
        JSON.stringify(input.tags ?? []),
        input.confidence ?? 0,
        input.status ?? "active",
      );

    const rowId = Number(result.lastInsertRowid);
    if (rowId > 0) {
      return this.getPersonalMemoryItem(rowId);
    }

    const existing = this.getDb()
      .query("SELECT * FROM personal_memory_items WHERE source_run_id = ? AND memory_type = ? AND content = ?")
      .get(input.sourceRunId, input.memoryType, input.content);

    return existing ? mapPersonalMemoryItemRecord(existing) : null;
  }

  getPersonalMemoryItem(id: number): PersonalMemoryItemRecord | null {
    if (!this.isEnabled()) return null;

    const row = this.getDb()
      .query("SELECT * FROM personal_memory_items WHERE id = ?")
      .get(id);

    return row ? mapPersonalMemoryItemRecord(row) : null;
  }

  listPersonalMemoryItems(userId: string, limit = 50): PersonalMemoryItemRecord[] {
    if (!this.isEnabled()) return [];

    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.getDb()
      .query("SELECT * FROM personal_memory_items WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(userId, safeLimit);

    return rows.map(mapPersonalMemoryItemRecord);
  }
}

export const conversationLogger = new ConversationLogger();
