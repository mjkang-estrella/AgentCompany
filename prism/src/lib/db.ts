import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.join(process.cwd(), "prism_codex.db");

let database: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.PRISM_CODEX_DB_PATH || DEFAULT_DB_PATH;
}

export function getDb(): Database.Database {
  if (database) {
    return database;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  runMigrations(database);
  return database;
}

export function resetDbForTests(): void {
  if (database) {
    database.close();
    database = null;
  }

  const dbPath = getDbPath();
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = `${dbPath}${suffix}`;
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      initial_idea TEXT NOT NULL DEFAULT '',
      spec_content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      clarification_round INTEGER NOT NULL DEFAULT 0,
      readiness INTEGER NOT NULL DEFAULT 0,
      structure_score INTEGER NOT NULL DEFAULT 0,
      ambiguity_label TEXT NOT NULL DEFAULT 'High',
      warnings_count INTEGER NOT NULL DEFAULT 0,
      open_questions_count INTEGER NOT NULL DEFAULT 0,
      overall_score INTEGER NOT NULL DEFAULT 0,
      ambiguity_score REAL NOT NULL DEFAULT 1,
      goal_clarity REAL NOT NULL DEFAULT 0,
      constraint_clarity REAL NOT NULL DEFAULT 0,
      success_criteria_clarity REAL NOT NULL DEFAULT 0,
      goal_justification TEXT NOT NULL DEFAULT '',
      constraint_justification TEXT NOT NULL DEFAULT '',
      success_criteria_justification TEXT NOT NULL DEFAULT '',
      is_ready INTEGER NOT NULL DEFAULT 0,
      pending_question_text TEXT,
      pending_question_choices TEXT,
      pending_question_dimension TEXT,
      pending_question_round INTEGER,
      reconciliation_status TEXT NOT NULL DEFAULT 'idle',
      reconciled_round INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transcript_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('assistant', 'user')),
      entry_type TEXT NOT NULL CHECK (entry_type IN ('question', 'answer')),
      content TEXT NOT NULL,
      choices TEXT,
      selected_choice_key TEXT,
      selected_choice_label TEXT,
      target_dimension TEXT,
      round_number INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transcript_session_created_at ON transcript_entries(session_id, created_at);
  `);

  ensureColumn(db, "sessions", "reconciliation_status", "TEXT NOT NULL DEFAULT 'idle'");
  ensureColumn(db, "sessions", "reconciled_round", "INTEGER NOT NULL DEFAULT 0");
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (rows.some((row) => row.name === column)) {
    return;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
