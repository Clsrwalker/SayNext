import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import type { AutoCueCategory, EvenHubV2Settings } from "./protocol";

const DEFAULT_DB_PATH = join(process.cwd(), "data", "saynext.sqlite");

export type StoredConversationStatus = "active" | "ended" | "abandoned";
export type StoredAttemptStatus = "queued" | "running" | "created" | "skipped" | "failed" | "stale";

export type EvenHubV2ConversationRecord = {
  id: string;
  userId: string;
  clientSessionId: string;
  status: StoredConversationStatus;
  title: string;
  startedAt: string;
  endedAt: string;
  durationMs: number | null;
  settingsJson: string;
  usedPrenoteJson: string;
  lastPartialAtEnd: string;
  createdAt: string;
  updatedAt: string;
};

export type EvenHubV2TranscriptLineRecord = {
  id: string;
  conversationId: string;
  userId: string;
  lineIndex: number;
  text: string;
  receivedAt: string;
  source: string;
  createdAt: string;
};

export type EvenHubV2AutoCueAttemptRecord = {
  id: string;
  conversationId: string;
  userId: string;
  requestId: string;
  status: StoredAttemptStatus;
  category: AutoCueCategory | "";
  confidence: number | null;
  title: string;
  g2Title: string;
  output: string;
  reason: string;
  inputHash: string;
  inputWindow: string;
  sourceTranscriptLineIdsJson: string;
  promptContextSnapshot: string;
  rawOutput: string;
  model: string;
  latencyMs: number | null;
  skippedReason: string;
  traceJson: string;
  createdAt: string;
  updatedAt: string;
};

export type EvenHubV2CueRecord = {
  id: string;
  conversationId: string;
  userId: string;
  attemptId: string;
  category: Exclude<AutoCueCategory, "none">;
  title: string;
  g2Title: string;
  output: string;
  sourceTranscriptLineIdsJson: string;
  createdAt: string;
};

export type CreateConversationInput = {
  id: string;
  userId: string;
  clientSessionId: string;
  title: string;
  startedAt: string;
  settings: EvenHubV2Settings;
  usedPrenote: {
    ids: string[];
    text: string;
  };
};

export type CreateAttemptInput = {
  id: string;
  conversationId: string;
  userId: string;
  requestId: string;
  status: StoredAttemptStatus;
  inputHash: string;
  inputWindow: string;
  sourceTranscriptLineIds: string[];
  promptContextSnapshot: string;
  model?: string;
  trace?: unknown;
};

export type UpdateAttemptInput = {
  status: StoredAttemptStatus;
  category?: AutoCueCategory | "";
  confidence?: number | null;
  title?: string;
  g2Title?: string;
  output?: string;
  reason?: string;
  rawOutput?: string;
  model?: string;
  latencyMs?: number | null;
  skippedReason?: string;
  trace?: unknown;
};

export type CreateCueInput = {
  id: string;
  conversationId: string;
  userId: string;
  attemptId: string;
  category: Exclude<AutoCueCategory, "none">;
  title: string;
  g2Title: string;
  output: string;
  sourceTranscriptLineIds: string[];
  createdAt: string;
};

function dbPath(): string {
  return process.env.SAYNEXT_DB_PATH || DEFAULT_DB_PATH;
}

function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class EvenHubV2Store {
  private db: Database | null = null;

  constructor(private readonly path: string = dbPath()) {}

  close(): void {
    this.db?.close();
    this.db = null;
  }

  getDb(): Database {
    if (!this.db) {
      if (this.path !== ":memory:") {
        mkdirSync(dirname(this.path), { recursive: true });
      }
      this.db = new Database(this.path);
      this.db.run("PRAGMA busy_timeout = 5000");
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA foreign_keys = ON");
      this.initialize();
    }
    return this.db;
  }

  initialize(): void {
    const db = this.db;
    if (!db) return;

    db.run(`
      CREATE TABLE IF NOT EXISTS evenhub_v2_conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER,
        settings_json TEXT NOT NULL DEFAULT '{}',
        used_prenote_json TEXT NOT NULL DEFAULT '{}',
        last_partial_at_end TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_evenhub_v2_conversations_user_time ON evenhub_v2_conversations(user_id, started_at DESC)");

    db.run(`
      CREATE TABLE IF NOT EXISTS evenhub_v2_transcript_lines (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        line_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        received_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'deepgram',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES evenhub_v2_conversations(id) ON DELETE CASCADE
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_evenhub_v2_transcript_conversation ON evenhub_v2_transcript_lines(conversation_id, line_index)");

    db.run(`
      CREATE TABLE IF NOT EXISTS evenhub_v2_auto_cue_attempts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        confidence REAL,
        title TEXT NOT NULL DEFAULT '',
        g2_title TEXT NOT NULL DEFAULT '',
        output TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        input_hash TEXT NOT NULL,
        input_window TEXT NOT NULL,
        source_transcript_line_ids_json TEXT NOT NULL DEFAULT '[]',
        prompt_context_snapshot TEXT NOT NULL DEFAULT '',
        raw_output TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        latency_ms INTEGER,
        skipped_reason TEXT NOT NULL DEFAULT '',
        trace_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES evenhub_v2_conversations(id) ON DELETE CASCADE
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_evenhub_v2_attempts_conversation ON evenhub_v2_auto_cue_attempts(conversation_id, created_at DESC)");
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_evenhub_v2_attempts_request ON evenhub_v2_auto_cue_attempts(conversation_id, request_id)");

    db.run(`
      CREATE TABLE IF NOT EXISTS evenhub_v2_cues (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        g2_title TEXT NOT NULL,
        output TEXT NOT NULL,
        source_transcript_line_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES evenhub_v2_conversations(id) ON DELETE CASCADE
      )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_evenhub_v2_cues_conversation ON evenhub_v2_cues(conversation_id, created_at DESC)");
  }

  createConversation(input: CreateConversationInput): EvenHubV2ConversationRecord {
    const db = this.getDb();
    db.query(`
      INSERT INTO evenhub_v2_conversations (
        id, user_id, client_session_id, status, title, started_at, settings_json, used_prenote_json
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      input.id,
      input.userId,
      input.clientSessionId,
      input.title,
      input.startedAt,
      asJson(input.settings),
      asJson(input.usedPrenote),
    );
    return this.getConversation(input.id)!;
  }

  endConversation(input: {
    conversationId: string;
    endedAt: string;
    durationMs: number;
    lastPartialAtEnd?: string;
  }): void {
    this.getDb().query(`
      UPDATE evenhub_v2_conversations
      SET status = 'ended', ended_at = ?, duration_ms = ?, last_partial_at_end = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(input.endedAt, input.durationMs, input.lastPartialAtEnd || "", input.conversationId);
  }

  getConversation(conversationId: string): EvenHubV2ConversationRecord | null {
    const row = this.getDb()
      .query("SELECT * FROM evenhub_v2_conversations WHERE id = ?")
      .get(conversationId) as any;
    return row ? EvenHubV2ConversationRecordMapper(row) : null;
  }

  listConversations(userId: string, limit = 20): EvenHubV2ConversationRecord[] {
    const rows = this.getDb()
      .query("SELECT * FROM evenhub_v2_conversations WHERE user_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(userId, limit) as any[];
    return rows.map(EvenHubV2ConversationRecordMapper);
  }

  deleteConversation(userId: string, conversationId: string): boolean {
    const conversation = this.getConversation(conversationId);
    if (!conversation || conversation.userId !== userId) return false;
    this.getDb()
      .query("DELETE FROM evenhub_v2_conversations WHERE id = ? AND user_id = ?")
      .run(conversationId, userId);
    return true;
  }

  addTranscriptLine(input: {
    id: string;
    conversationId: string;
    userId: string;
    lineIndex: number;
    text: string;
    receivedAt: string;
    source: string;
  }): EvenHubV2TranscriptLineRecord {
    const db = this.getDb();
    db.query(`
      INSERT INTO evenhub_v2_transcript_lines (
        id, conversation_id, user_id, line_index, text, received_at, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.conversationId, input.userId, input.lineIndex, input.text, input.receivedAt, input.source);
    return this.getTranscriptLine(input.id)!;
  }

  updateTranscriptLine(input: {
    id: string;
    text: string;
    receivedAt: string;
    source: string;
  }): EvenHubV2TranscriptLineRecord | null {
    this.getDb()
      .query("UPDATE evenhub_v2_transcript_lines SET text = ?, received_at = ?, source = ? WHERE id = ?")
      .run(input.text, input.receivedAt, input.source, input.id);
    return this.getTranscriptLine(input.id);
  }

  getTranscriptLine(id: string): EvenHubV2TranscriptLineRecord | null {
    const row = this.getDb()
      .query("SELECT * FROM evenhub_v2_transcript_lines WHERE id = ?")
      .get(id) as any;
    return row ? EvenHubV2TranscriptLineRecordMapper(row) : null;
  }

  listTranscriptLines(conversationId: string): EvenHubV2TranscriptLineRecord[] {
    const rows = this.getDb()
      .query("SELECT * FROM evenhub_v2_transcript_lines WHERE conversation_id = ? ORDER BY line_index ASC")
      .all(conversationId) as any[];
    return rows.map(EvenHubV2TranscriptLineRecordMapper);
  }

  createAutoCueAttempt(input: CreateAttemptInput): EvenHubV2AutoCueAttemptRecord {
    const db = this.getDb();
    db.query(`
      INSERT INTO evenhub_v2_auto_cue_attempts (
        id, conversation_id, user_id, request_id, status, input_hash, input_window,
        source_transcript_line_ids_json, prompt_context_snapshot, model, trace_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.conversationId,
      input.userId,
      input.requestId,
      input.status,
      input.inputHash,
      input.inputWindow,
      asJson(input.sourceTranscriptLineIds),
      input.promptContextSnapshot,
      input.model || "",
      asJson(input.trace || {}),
    );
    return this.getAutoCueAttempt(input.id)!;
  }

  updateAutoCueAttempt(id: string, input: UpdateAttemptInput): EvenHubV2AutoCueAttemptRecord | null {
    this.getDb().query(`
      UPDATE evenhub_v2_auto_cue_attempts
      SET status = ?,
          category = ?,
          confidence = ?,
          title = ?,
          g2_title = ?,
          output = ?,
          reason = ?,
          raw_output = ?,
          model = ?,
          latency_ms = ?,
          skipped_reason = ?,
          trace_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      input.status,
      input.category ?? "",
      input.confidence ?? null,
      input.title ?? "",
      input.g2Title ?? "",
      input.output ?? "",
      input.reason ?? "",
      input.rawOutput ?? "",
      input.model ?? "",
      input.latencyMs ?? null,
      input.skippedReason ?? "",
      asJson(input.trace || {}),
      id,
    );
    return this.getAutoCueAttempt(id);
  }

  getAutoCueAttempt(id: string): EvenHubV2AutoCueAttemptRecord | null {
    const row = this.getDb()
      .query("SELECT * FROM evenhub_v2_auto_cue_attempts WHERE id = ?")
      .get(id) as any;
    return row ? EvenHubV2AutoCueAttemptRecordMapper(row) : null;
  }

  createCue(input: CreateCueInput): EvenHubV2CueRecord {
    const db = this.getDb();
    db.query(`
      INSERT INTO evenhub_v2_cues (
        id, conversation_id, user_id, attempt_id, category, title, g2_title, output,
        source_transcript_line_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.conversationId,
      input.userId,
      input.attemptId,
      input.category,
      input.title,
      input.g2Title,
      input.output,
      asJson(input.sourceTranscriptLineIds),
      input.createdAt,
    );
    return this.getCue(input.id)!;
  }

  getCue(id: string): EvenHubV2CueRecord | null {
    const row = this.getDb()
      .query("SELECT * FROM evenhub_v2_cues WHERE id = ?")
      .get(id) as any;
    return row ? EvenHubV2CueRecordMapper(row) : null;
  }

  listCues(conversationId: string): EvenHubV2CueRecord[] {
    const rows = this.getDb()
      .query("SELECT * FROM evenhub_v2_cues WHERE conversation_id = ? ORDER BY created_at DESC")
      .all(conversationId) as any[];
    return rows.map(EvenHubV2CueRecordMapper);
  }

  getConversationDetail(conversationId: string): {
    conversation: EvenHubV2ConversationRecord;
    transcript: EvenHubV2TranscriptLineRecord[];
    cues: EvenHubV2CueRecord[];
  } | null {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;
    return {
      conversation,
      transcript: this.listTranscriptLines(conversationId),
      cues: this.listCues(conversationId),
    };
  }
}

function EvenHubV2ConversationRecordMapper(row: any): EvenHubV2ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    clientSessionId: row.client_session_id,
    status: row.status,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    settingsJson: row.settings_json,
    usedPrenoteJson: row.used_prenote_json,
    lastPartialAtEnd: row.last_partial_at_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function EvenHubV2TranscriptLineRecordMapper(row: any): EvenHubV2TranscriptLineRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    lineIndex: row.line_index,
    text: row.text,
    receivedAt: row.received_at,
    source: row.source,
    createdAt: row.created_at,
  };
}

function EvenHubV2AutoCueAttemptRecordMapper(row: any): EvenHubV2AutoCueAttemptRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    requestId: row.request_id,
    status: row.status,
    category: row.category,
    confidence: row.confidence,
    title: row.title,
    g2Title: row.g2_title,
    output: row.output,
    reason: row.reason,
    inputHash: row.input_hash,
    inputWindow: row.input_window,
    sourceTranscriptLineIdsJson: row.source_transcript_line_ids_json,
    promptContextSnapshot: row.prompt_context_snapshot,
    rawOutput: row.raw_output,
    model: row.model,
    latencyMs: row.latency_ms,
    skippedReason: row.skipped_reason,
    traceJson: row.trace_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function EvenHubV2CueRecordMapper(row: any): EvenHubV2CueRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    attemptId: row.attempt_id,
    category: row.category,
    title: row.title,
    g2Title: row.g2_title,
    output: row.output,
    sourceTranscriptLineIdsJson: row.source_transcript_line_ids_json,
    createdAt: row.created_at,
  };
}

export function parseStoredJson<T>(value: string, fallback: T): T {
  return parseJson(value, fallback);
}

export const evenHubV2Store = new EvenHubV2Store();
