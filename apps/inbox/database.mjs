import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  getRawEmailById,
  getRawEmailByMessageId,
  insertRawEmail,
} from "./raw-email-store.mjs";
import {
  compareNewNotesToDuplicateCandidates,
  compareNewNotesToExistingNotes,
  compareNotesByKeywords,
} from "./relationship-matcher.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TAXONOMY_TYPES = Object.freeze([
  {
    key: "claim",
    label: "Claim",
    description: "An asserted statement or conclusion that should be preserved as a claim.",
  },
  {
    key: "fact",
    label: "Fact",
    description: "A concrete, verifiable statement grounded in the source material.",
  },
  {
    key: "idea",
    label: "Idea",
    description: "A novel concept, synthesis, or proposal that represents one core idea.",
  },
  {
    key: "opinion",
    label: "Opinion",
    description: "A subjective judgment, preference, or point of view expressed in the source.",
  },
  {
    key: "task",
    label: "Task",
    description: "A concrete action item, to-do, or recommended next step.",
  },
  {
    key: "question",
    label: "Question",
    description: "An open question, unknown, or research prompt worth preserving.",
  },
  {
    key: "opportunity",
    label: "Opportunity",
    description: "A potential upside, opening, or underexploited advantage.",
  },
  {
    key: "warning_risk",
    label: "Warning/Risk",
    description: "A downside, caution, threat, or meaningful risk signal.",
  },
  {
    key: "tool_update",
    label: "Tool Update",
    description: "A new launch, release, integration, or notable product or tool change.",
  },
  {
    key: "pattern_trend",
    label: "Pattern/Trend",
    description: "A repeated pattern, directional shift, or emerging trend across examples.",
  },
  {
    key: "contradiction",
    label: "Contradiction",
    description: "A tension, disagreement, or explicit contradiction between ideas.",
  },
  {
    key: "playbook_candidate",
    label: "Playbook Candidate",
    description: "A reusable operating procedure, workflow, checklist, or repeatable tactic.",
  },
  {
    key: "preference_candidate",
    label: "Preference Candidate",
    description: "A stated preference or taste signal that may be useful as a future preference.",
  },
]);

export const DEFAULT_DATABASE_PATH = path.join(
  __dirname,
  "data",
  "newsletter-intelligence.sqlite"
);

const MAX_PERSISTED_KEYWORDS = 20;
const SERIALIZED_KEYWORD_SEPARATOR = "\u001f";
const DUPLICATE_OF_RELATIONSHIP_TYPE = "duplicate_of";
const DUPLICATE_OF_UNIQUE_INDEX_NAME = "relationships_duplicate_of_pair_unique";
const DUPLICATE_OF_FALLBACK_MATCHED_VALUE = "duplicate match";
const DEFAULT_DIGEST_NOTE_LIMIT = 5;
const LEGACY_TAXONOMY_KEY_MAP = Object.freeze({
  statistic: "fact",
  quote: "claim",
  insight: "idea",
  prediction: "claim",
  recommendation: "task",
  tactic: "playbook_candidate",
  framework: "playbook_candidate",
  trend: "pattern_trend",
  resource: "fact",
  event: "tool_update",
});
const TAXONOMY_KEY_ALIASES = new Map();
const DAILY_DIGEST_ACTIONABLE_TYPES = new Set([
  "task",
  "playbook_candidate",
  "opportunity",
]);
const ACTIONABLE_LANGUAGE_RE =
  /\b(?:should|must|need to|needs to|review|schedule|audit|test|pilot|launch|build|create|document|update|monitor|investigate|prioritize|adopt|prototype|delete|remove|follow up|reach out)\b/i;
const ACTION_ITEM_BASE_PRIORITY = new Map([
  ["task", 400],
  ["playbook_candidate", 300],
  ["opportunity", 220],
  ["warning_risk", 140],
  ["question", 120],
]);

function normalizeTaxonomyAlias(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  return normalized
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function registerTaxonomyKeyAlias(alias, key) {
  const normalizedAlias = normalizeTaxonomyAlias(alias);

  if (normalizedAlias) {
    TAXONOMY_KEY_ALIASES.set(normalizedAlias, key);
  }
}

for (const taxonomyType of TAXONOMY_TYPES) {
  registerTaxonomyKeyAlias(taxonomyType.key, taxonomyType.key);
  registerTaxonomyKeyAlias(taxonomyType.label, taxonomyType.key);
}

for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_TAXONOMY_KEY_MAP)) {
  registerTaxonomyKeyAlias(legacyKey, canonicalKey);
}

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    name: "initial newsletter intelligence schema",
    sql: `
      CREATE TABLE IF NOT EXISTS taxonomy_types (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'agentmail',
        delivery_id TEXT UNIQUE,
        event_type TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS raw_emails (
        id INTEGER PRIMARY KEY,
        webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
        provider TEXT NOT NULL DEFAULT 'agentmail',
        delivery_id TEXT,
        event_type TEXT,
        agentmail_message_id TEXT,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY,
        webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
        agentmail_message_id TEXT NOT NULL UNIQUE,
        agentmail_inbox_id TEXT,
        message_id_header TEXT,
        subject TEXT,
        from_name TEXT,
        from_address TEXT,
        sender_address TEXT,
        sent_at TEXT,
        received_at TEXT,
        text_content TEXT,
        html_content TEXT,
        raw_payload TEXT NOT NULL,
        ingestion_status TEXT NOT NULL DEFAULT 'received',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
        taxonomy_key TEXT NOT NULL REFERENCES taxonomy_types(key),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        summary TEXT,
        source_excerpt TEXT,
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        classification_confidence REAL CHECK (
          classification_confidence IS NULL OR (
            classification_confidence >= 0
            AND classification_confidence <= 1
          )
        ),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY,
        keyword TEXT NOT NULL,
        normalized_keyword TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS note_keywords (
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
        source TEXT NOT NULL DEFAULT 'llm',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (note_id, keyword_id)
      );

      CREATE TABLE IF NOT EXISTS note_links (
        source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
        strength REAL NOT NULL DEFAULT 0,
        shared_keywords_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source_note_id, target_note_id),
        CHECK (source_note_id < target_note_id)
      );

      CREATE INDEX IF NOT EXISTS emails_by_inbox_received_at
      ON emails (agentmail_inbox_id, received_at DESC);

      CREATE INDEX IF NOT EXISTS raw_emails_by_webhook_delivery_id
      ON raw_emails (webhook_delivery_id);

      CREATE INDEX IF NOT EXISTS raw_emails_by_delivery_id_received_at
      ON raw_emails (delivery_id, received_at DESC);

      CREATE INDEX IF NOT EXISTS raw_emails_by_agentmail_message_id_received_at
      ON raw_emails (agentmail_message_id, received_at DESC);

      CREATE INDEX IF NOT EXISTS notes_by_email_id
      ON notes (email_id);

      CREATE INDEX IF NOT EXISTS notes_by_taxonomy_key
      ON notes (taxonomy_key);

      CREATE INDEX IF NOT EXISTS note_keywords_by_keyword_id
      ON note_keywords (keyword_id);

      CREATE INDEX IF NOT EXISTS note_links_by_relationship_type
      ON note_links (relationship_type);
    `,
  },
  {
    version: 2,
    name: "track note source timestamps and email processing state",
    sql: `
      ALTER TABLE notes
      ADD COLUMN source_timestamp TEXT;

      ALTER TABLE emails
      ADD COLUMN processing_error TEXT;
    `,
  },
  {
    version: 3,
    name: "add relationships table for note graph links",
    sql: `
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
        strength REAL NOT NULL DEFAULT 0,
        overlap_source TEXT NOT NULL DEFAULT 'keyword_overlap',
        overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
        overlap_terms_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (note_id, related_note_id),
        CHECK (note_id < related_note_id)
      );

      INSERT OR IGNORE INTO relationships (
        note_id,
        related_note_id,
        relationship_type,
        strength,
        overlap_source,
        overlap_source_metadata_json,
        overlap_terms_json,
        created_at,
        updated_at
      )
      SELECT
        source_note_id,
        target_note_id,
        relationship_type,
        strength,
        'shared_keyword',
        '{"migratedFrom":"note_links"}',
        shared_keywords_json,
        created_at,
        created_at
      FROM note_links;

      CREATE INDEX IF NOT EXISTS relationships_by_note_id
      ON relationships (note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_related_note_id
      ON relationships (related_note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_relationship_type
      ON relationships (relationship_type);

      CREATE INDEX IF NOT EXISTS relationships_by_overlap_source
      ON relationships (overlap_source);
    `,
  },
  {
    version: 4,
    name: "align taxonomy to newsletter intelligence note types",
    sql: `
      PRAGMA defer_foreign_keys = ON;

      UPDATE notes
      SET taxonomy_key = CASE taxonomy_key
        WHEN 'statistic' THEN 'fact'
        WHEN 'quote' THEN 'claim'
        WHEN 'insight' THEN 'idea'
        WHEN 'prediction' THEN 'claim'
        WHEN 'recommendation' THEN 'task'
        WHEN 'tactic' THEN 'playbook_candidate'
        WHEN 'framework' THEN 'playbook_candidate'
        WHEN 'trend' THEN 'pattern_trend'
        WHEN 'resource' THEN 'fact'
        WHEN 'event' THEN 'tool_update'
        ELSE taxonomy_key
      END
      WHERE taxonomy_key IN (
        'statistic',
        'quote',
        'insight',
        'prediction',
        'recommendation',
        'tactic',
        'framework',
        'trend',
        'resource',
        'event'
      );

      DELETE FROM taxonomy_types
      WHERE key NOT IN (
        'claim',
        'fact',
        'idea',
        'opinion',
        'task',
        'question',
        'opportunity',
        'warning_risk',
        'tool_update',
        'pattern_trend',
        'contradiction',
        'playbook_candidate',
        'preference_candidate'
      );
    `,
  },
  {
    version: 5,
    name: "persist email processing jobs for async note extraction",
    sql: `
      CREATE TABLE IF NOT EXISTS email_processing_jobs (
        id INTEGER PRIMARY KEY,
        email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
        webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS email_processing_jobs_by_status_created_at
      ON email_processing_jobs (status, created_at);
    `,
  },
  {
    version: 6,
    name: "track failed email processing job timestamps separately",
    sql: `
      ALTER TABLE email_processing_jobs
      ADD COLUMN failed_at TEXT;

      UPDATE email_processing_jobs
      SET failed_at = completed_at
      WHERE status = 'failed'
        AND failed_at IS NULL
        AND completed_at IS NOT NULL;
    `,
  },
  {
    version: 7,
    name: "persist raw AgentMail webhook payload receipts",
    sql: `
      CREATE TABLE IF NOT EXISTS raw_emails (
        id INTEGER PRIMARY KEY,
        webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
        provider TEXT NOT NULL DEFAULT 'agentmail',
        delivery_id TEXT,
        event_type TEXT,
        agentmail_message_id TEXT,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS raw_emails_by_webhook_delivery_id
      ON raw_emails (webhook_delivery_id);

      CREATE INDEX IF NOT EXISTS raw_emails_by_delivery_id_received_at
      ON raw_emails (delivery_id, received_at DESC);

      CREATE INDEX IF NOT EXISTS raw_emails_by_agentmail_message_id_received_at
      ON raw_emails (agentmail_message_id, received_at DESC);
    `,
  },
  {
    version: 8,
    name: "expand raw email records for reusable payload persistence",
    sql: `
      ALTER TABLE raw_emails
      ADD COLUMN agentmail_inbox_id TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN message_id_header TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN subject TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN from_name TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN from_address TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN sender_address TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN sent_at TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN created_at TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN updated_at TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN text_content TEXT;

      ALTER TABLE raw_emails
      ADD COLUMN html_content TEXT;

      ALTER TABLE raw_emails
      RENAME COLUMN payload TO raw_payload;

      UPDATE raw_emails
      SET created_at = COALESCE(created_at, received_at)
      WHERE created_at IS NULL;

      UPDATE raw_emails
      SET updated_at = COALESCE(updated_at, received_at)
      WHERE updated_at IS NULL;

      DELETE FROM raw_emails
      WHERE agentmail_message_id IS NOT NULL
        AND id NOT IN (
          SELECT MAX(id)
          FROM raw_emails
          WHERE agentmail_message_id IS NOT NULL
          GROUP BY agentmail_message_id
        );

      CREATE UNIQUE INDEX IF NOT EXISTS raw_emails_by_agentmail_message_id
      ON raw_emails (agentmail_message_id);

      CREATE INDEX IF NOT EXISTS raw_emails_by_inbox_received_at
      ON raw_emails (agentmail_inbox_id, received_at DESC, id DESC);
    `,
  },
  {
    version: 9,
    name: "normalize relationships into basis and matched value links",
    sql: `
      PRAGMA defer_foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
        strength REAL NOT NULL DEFAULT 0,
        overlap_source TEXT NOT NULL DEFAULT 'keyword_overlap',
        overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
        overlap_terms_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (note_id, related_note_id),
        CHECK (note_id < related_note_id)
      );

      ALTER TABLE relationships
      RENAME TO relationships_legacy;

      CREATE TABLE relationships (
        id INTEGER PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
        strength REAL NOT NULL DEFAULT 0,
        overlap_basis TEXT NOT NULL,
        matched_value TEXT NOT NULL COLLATE NOCASE,
        overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (note_id, related_note_id, relationship_type, overlap_basis, matched_value),
        CHECK (note_id < related_note_id),
        CHECK (overlap_basis IN ('topic', 'keyword'))
      );

      INSERT OR IGNORE INTO relationships (
        note_id,
        related_note_id,
        relationship_type,
        strength,
        overlap_basis,
        matched_value,
        overlap_source_metadata_json,
        created_at,
        updated_at
      )
      SELECT
        relationships_legacy.note_id,
        relationships_legacy.related_note_id,
        relationships_legacy.relationship_type,
        relationships_legacy.strength,
        CASE
          WHEN lower(trim(COALESCE(relationships_legacy.overlap_source, ''))) IN (
            'topic',
            'topic_overlap',
            'shared_topic'
          ) THEN 'topic'
          ELSE 'keyword'
        END,
        lower(trim(CAST(json_each.value AS TEXT))),
        COALESCE(relationships_legacy.overlap_source_metadata_json, '{}'),
        relationships_legacy.created_at,
        relationships_legacy.updated_at
      FROM relationships_legacy
      INNER JOIN json_each(
        CASE
          WHEN json_valid(relationships_legacy.overlap_terms_json)
            THEN relationships_legacy.overlap_terms_json
          ELSE '[]'
        END
      )
      WHERE trim(CAST(json_each.value AS TEXT)) != '';

      DROP TABLE relationships_legacy;

      CREATE INDEX IF NOT EXISTS relationships_by_note_id
      ON relationships (note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_related_note_id
      ON relationships (related_note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_relationship_type
      ON relationships (relationship_type);

      CREATE INDEX IF NOT EXISTS relationships_by_overlap_basis
      ON relationships (overlap_basis);

      CREATE INDEX IF NOT EXISTS relationships_by_matched_value
      ON relationships (matched_value);
    `,
  },
  {
    version: 10,
    name: "capture agentmail webhook receipt metadata",
    run(db) {
      rebuildWebhookDeliveriesTable(db);
    },
  },
  {
    version: 11,
    name: "track newsletter sources for sender provenance",
    run(db) {
      migrateSourcesTable(db);
    },
  },
  {
    version: 12,
    name: "record async email processing events independently from webhook receipts",
    sql: `
      CREATE TABLE IF NOT EXISTS email_processing_events (
        id INTEGER PRIMARY KEY,
        email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
        processing_job_id INTEGER REFERENCES email_processing_jobs(id) ON DELETE SET NULL,
        webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        job_status TEXT,
        error_message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS email_processing_events_by_email_created_at
      ON email_processing_events (email_id, created_at ASC, id ASC);

      CREATE INDEX IF NOT EXISTS email_processing_events_by_job_created_at
      ON email_processing_events (processing_job_id, created_at ASC, id ASC);

      CREATE INDEX IF NOT EXISTS email_processing_events_by_event_type_created_at
      ON email_processing_events (event_type, created_at ASC, id ASC);
    `,
  },
  {
    version: 13,
    name: "validate persisted note confidence scores",
    run(db) {
      rebuildNotesTableWithValidatedConfidence(db);
    },
  },
  {
    version: 14,
    name: "allow duplicate_of relationships alongside overlap evidence",
    sql: `
      PRAGMA defer_foreign_keys = ON;

      ALTER TABLE relationships
      RENAME TO relationships_legacy_v14;

      CREATE TABLE relationships (
        id INTEGER PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
        strength REAL NOT NULL DEFAULT 0,
        overlap_basis TEXT NOT NULL,
        matched_value TEXT NOT NULL COLLATE NOCASE,
        overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (note_id, related_note_id, relationship_type, overlap_basis, matched_value),
        CHECK (note_id < related_note_id),
        CHECK (overlap_basis IN ('topic', 'keyword'))
      );

      INSERT OR IGNORE INTO relationships (
        id,
        note_id,
        related_note_id,
        relationship_type,
        strength,
        overlap_basis,
        matched_value,
        overlap_source_metadata_json,
        created_at,
        updated_at
      )
      SELECT
        id,
        note_id,
        related_note_id,
        relationship_type,
        strength,
        overlap_basis,
        matched_value,
        overlap_source_metadata_json,
        created_at,
        updated_at
      FROM relationships_legacy_v14;

      DROP TABLE relationships_legacy_v14;

      CREATE INDEX IF NOT EXISTS relationships_by_note_id
      ON relationships (note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_related_note_id
      ON relationships (related_note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_relationship_type
      ON relationships (relationship_type);

      CREATE INDEX IF NOT EXISTS relationships_by_overlap_basis
      ON relationships (overlap_basis);

      CREATE INDEX IF NOT EXISTS relationships_by_matched_value
      ON relationships (matched_value);
    `,
  },
  {
    version: 15,
    name: "track email relevance decisions for skipped processing",
    sql: `
      ALTER TABLE emails
      ADD COLUMN relevance_status TEXT NOT NULL DEFAULT 'pending';
    `,
  },
  {
    version: 16,
    name: "link processing jobs to persisted raw email payloads",
    run(db) {
      migrateEmailProcessingJobsRawEmailLink(db);
    },
  },
  {
    version: 17,
    name: "persist note classification confidence separately",
    run(db) {
      migrateNoteClassificationConfidence(db);
    },
  },
  {
    version: 18,
    name: "store duplicate_of relationships directionally",
    sql: `
      PRAGMA defer_foreign_keys = ON;

      ALTER TABLE relationships
      RENAME TO relationships_legacy_v18;

      CREATE TABLE relationships (
        id INTEGER PRIMARY KEY,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
        strength REAL NOT NULL DEFAULT 0,
        overlap_basis TEXT NOT NULL,
        matched_value TEXT NOT NULL COLLATE NOCASE,
        overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (note_id, related_note_id, relationship_type, overlap_basis, matched_value),
        CHECK (
          (
            relationship_type = 'duplicate_of'
            AND note_id != related_note_id
          ) OR (
            relationship_type != 'duplicate_of'
            AND note_id < related_note_id
          )
        ),
        CHECK (overlap_basis IN ('topic', 'keyword'))
      );

      INSERT OR IGNORE INTO relationships (
        id,
        note_id,
        related_note_id,
        relationship_type,
        strength,
        overlap_basis,
        matched_value,
        overlap_source_metadata_json,
        created_at,
        updated_at
      )
      SELECT
        id,
        CASE
          WHEN relationship_type = 'duplicate_of' THEN related_note_id
          ELSE note_id
        END,
        CASE
          WHEN relationship_type = 'duplicate_of' THEN note_id
          ELSE related_note_id
        END,
        relationship_type,
        strength,
        overlap_basis,
        matched_value,
        overlap_source_metadata_json,
        created_at,
        updated_at
      FROM relationships_legacy_v18;

      DROP TABLE relationships_legacy_v18;

      CREATE INDEX IF NOT EXISTS relationships_by_note_id
      ON relationships (note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_related_note_id
      ON relationships (related_note_id);

      CREATE INDEX IF NOT EXISTS relationships_by_relationship_type
      ON relationships (relationship_type);

      CREATE INDEX IF NOT EXISTS relationships_by_overlap_basis
      ON relationships (overlap_basis);

      CREATE INDEX IF NOT EXISTS relationships_by_matched_value
      ON relationships (matched_value);
    `,
  },
  {
    version: 19,
    name: "store matched terms on relationships and allow combined overlap basis",
    run(db) {
      migrateRelationshipsMatchedTerms(db);
    },
  },
  {
    version: 20,
    name: "normalize email processing jobs to queued state tracking",
    run(db) {
      migrateEmailProcessingJobsQueueState(db);
    },
  },
  {
    version: 21,
    name: "collapse duplicate_of edges to one row per directed note pair",
    run(db) {
      migrateDuplicateRelationshipsToSingleEdge(db);
    },
  },
  {
    version: 22,
    name: "store per-note usefulness feedback",
    sql: `
      ALTER TABLE notes
      ADD COLUMN feedback_useful INTEGER CHECK (
        feedback_useful IS NULL
        OR feedback_useful IN (0, 1)
      );

      ALTER TABLE notes
      ADD COLUMN feedback_comment TEXT;

      ALTER TABLE notes
      ADD COLUMN feedback_updated_at TEXT;
    `,
  },
  {
    version: 23,
    name: "persist generated digests by covered date range",
    sql: `
      CREATE TABLE IF NOT EXISTS digests (
        id INTEGER PRIMARY KEY,
        range_start TEXT NOT NULL,
        range_end TEXT NOT NULL,
        digest_text TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (range_start, range_end)
      );
    `,
  },
]);

function isSpecialDatabasePath(databasePath) {
  return databasePath === ":memory:" || databasePath.startsWith("file:");
}

async function ensureDatabaseDirectory(databasePath) {
  if (!isSpecialDatabasePath(databasePath)) {
    await mkdir(path.dirname(databasePath), { recursive: true });
  }
}

function configureDatabase(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
}

function getSchemaVersion(db) {
  return db.prepare("PRAGMA user_version").get()?.user_version ?? 0;
}

function normalizeWebhookReceiptHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return {};
  }

  const normalizedEntries = Object.entries(headers)
    .map(([key, value]) => {
      const normalizedKey = trimToNull(key)?.toLowerCase();

      if (!normalizedKey) {
        return null;
      }

      if (Array.isArray(value)) {
        const normalizedValues = value
          .map((entry) => trimToNull(typeof entry === "string" ? entry : String(entry ?? "")))
          .filter(Boolean);

        return normalizedValues.length > 0 ? [normalizedKey, normalizedValues] : null;
      }

      const normalizedValue = trimToNull(
        typeof value === "string" ? value : String(value ?? "")
      );

      return normalizedValue ? [normalizedKey, normalizedValue] : null;
    })
    .filter(Boolean)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return Object.fromEntries(normalizedEntries);
}

function getWebhookReceiptHeader(headers, targetName) {
  const target = trimToNull(targetName)?.toLowerCase();

  if (!target || !headers || typeof headers !== "object" || Array.isArray(headers)) {
    return null;
  }

  const value = headers[target];

  if (Array.isArray(value)) {
    return pickFirstString(...value);
  }

  return pickFirstString(value);
}

function parseWebhookPayload(rawPayload) {
  if (typeof rawPayload !== "string" || rawPayload.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload);
    return getObject(parsed);
  } catch {
    return null;
  }
}

function deriveWebhookSourceIp(receipt = {}) {
  const headers = normalizeWebhookReceiptHeaders(receipt.headers);
  const forwardedFor = getWebhookReceiptHeader(headers, "x-forwarded-for");
  const firstForwardedIp = trimToNull(forwardedFor?.split(",")[0] ?? null);

  return pickFirstString(
    receipt.sourceIp,
    firstForwardedIp,
    getWebhookReceiptHeader(headers, "x-real-ip"),
    getWebhookReceiptHeader(headers, "cf-connecting-ip")
  );
}

function buildWebhookPayloadHash(rawPayload) {
  if (typeof rawPayload !== "string" || rawPayload.length === 0) {
    return null;
  }

  return createHash("sha256").update(rawPayload).digest("hex");
}

function normalizeAgentMailWebhookDelivery({
  deliveryId = null,
  eventType = null,
  rawPayload,
  payload,
  receipt = null,
}) {
  const serializedPayload =
    typeof rawPayload === "string" && rawPayload.length > 0
      ? rawPayload
      : JSON.stringify(payload ?? {});
  const parsedPayload = getObject(payload) ?? parseWebhookPayload(serializedPayload);
  const headers = normalizeWebhookReceiptHeaders(receipt?.headers);
  const bodyBytes =
    Number.isInteger(receipt?.bodyBytes) && receipt.bodyBytes >= 0
      ? receipt.bodyBytes
      : Buffer.byteLength(serializedPayload, "utf8");

  return {
    provider: "agentmail",
    delivery_id: pickFirstString(deliveryId, getWebhookReceiptHeader(headers, "svix-id")),
    event_id: pickFirstString(parsedPayload?.event_id),
    event_type: pickFirstString(eventType, parsedPayload?.event_type),
    webhook_path: pickFirstString(receipt?.webhookPath),
    content_type: pickFirstString(
      receipt?.contentType,
      getWebhookReceiptHeader(headers, "content-type")
    ),
    body_bytes: bodyBytes,
    payload_sha256: buildWebhookPayloadHash(serializedPayload),
    headers_json: JSON.stringify(headers),
    svix_signature: pickFirstString(
      receipt?.signature,
      getWebhookReceiptHeader(headers, "svix-signature")
    ),
    svix_timestamp: pickFirstString(
      receipt?.timestamp,
      getWebhookReceiptHeader(headers, "svix-timestamp")
    ),
    user_agent: pickFirstString(
      receipt?.userAgent,
      getWebhookReceiptHeader(headers, "user-agent")
    ),
    source_ip: deriveWebhookSourceIp(receipt ?? {}),
    payload: serializedPayload,
  };
}

function rebuildWebhookDeliveriesTable(db) {
  const legacyRows = db.prepare("SELECT * FROM webhook_deliveries ORDER BY id ASC").all();

  db.exec(`
    PRAGMA defer_foreign_keys = ON;

    DROP TABLE IF EXISTS webhook_deliveries_next;

    CREATE TABLE webhook_deliveries_next (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'agentmail',
      delivery_id TEXT UNIQUE,
      event_id TEXT,
      event_type TEXT,
      webhook_path TEXT,
      content_type TEXT,
      body_bytes INTEGER NOT NULL DEFAULT 0 CHECK (body_bytes >= 0),
      payload_sha256 TEXT,
      headers_json TEXT NOT NULL DEFAULT '{}',
      svix_signature TEXT,
      svix_timestamp TEXT,
      user_agent TEXT,
      source_ip TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      error_message TEXT
    );
  `);

  const insertDelivery = db.prepare(`
    INSERT INTO webhook_deliveries_next (
      id,
      provider,
      delivery_id,
      event_id,
      event_type,
      webhook_path,
      content_type,
      body_bytes,
      payload_sha256,
      headers_json,
      svix_signature,
      svix_timestamp,
      user_agent,
      source_ip,
      payload,
      status,
      received_at,
      processed_at,
      error_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const legacyRow of legacyRows) {
    const payload = typeof legacyRow.payload === "string" ? legacyRow.payload : "{}";
    const parsedPayload = parseWebhookPayload(payload);
    const headersJson =
      typeof legacyRow.headers_json === "string" && legacyRow.headers_json.length > 0
        ? legacyRow.headers_json
        : "{}";

    insertDelivery.run(
      legacyRow.id,
      trimToNull(legacyRow.provider) ?? "agentmail",
      trimToNull(legacyRow.delivery_id),
      pickFirstString(legacyRow.event_id, parsedPayload?.event_id),
      pickFirstString(legacyRow.event_type, parsedPayload?.event_type),
      trimToNull(legacyRow.webhook_path),
      trimToNull(legacyRow.content_type),
      Number.isInteger(legacyRow.body_bytes) && legacyRow.body_bytes >= 0
        ? legacyRow.body_bytes
        : Buffer.byteLength(payload, "utf8"),
      trimToNull(legacyRow.payload_sha256) ?? buildWebhookPayloadHash(payload),
      headersJson,
      trimToNull(legacyRow.svix_signature),
      trimToNull(legacyRow.svix_timestamp),
      trimToNull(legacyRow.user_agent),
      trimToNull(legacyRow.source_ip),
      payload,
      trimToNull(legacyRow.status) ?? "received",
      trimToNull(legacyRow.received_at) ?? new Date().toISOString(),
      trimToNull(legacyRow.processed_at),
      trimToNull(legacyRow.error_message)
    );
  }

  db.exec(`
    DROP TABLE webhook_deliveries;

    ALTER TABLE webhook_deliveries_next
    RENAME TO webhook_deliveries;

    CREATE INDEX IF NOT EXISTS webhook_deliveries_by_event_type_received_at
    ON webhook_deliveries (event_type, received_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS webhook_deliveries_by_status_received_at
    ON webhook_deliveries (status, received_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS webhook_deliveries_by_event_id
    ON webhook_deliveries (event_id);
  `);
}

function ensurePlaceholderEmailForLegacyNotes(db) {
  const existingEmail = db.prepare("SELECT id FROM emails ORDER BY id ASC LIMIT 1").get();

  if (existingEmail?.id !== undefined && existingEmail.id !== null) {
    return Number(existingEmail.id);
  }

  const emailColumns = getTableColumnNames(db, "emails");
  const placeholderEmailId = 1;
  const columnNames = ["id"];
  const values = [placeholderEmailId];
  const placeholders = ["?"];

  if (emailColumns.has("agentmail_message_id")) {
    columnNames.push("agentmail_message_id");
    values.push(`legacy-note-migration-${placeholderEmailId}`);
    placeholders.push("?");
  }

  if (emailColumns.has("raw_payload")) {
    columnNames.push("raw_payload");
    values.push("{}");
    placeholders.push("?");
  }

  if (emailColumns.has("ingestion_status")) {
    columnNames.push("ingestion_status");
    values.push("processed");
    placeholders.push("?");
  }

  if (emailColumns.has("relevance_status")) {
    columnNames.push("relevance_status");
    values.push("relevant");
    placeholders.push("?");
  }

  db.prepare(`
    INSERT INTO emails (${columnNames.join(", ")})
    VALUES (${placeholders.join(", ")})
  `).run(...values);

  return placeholderEmailId;
}

function rebuildNotesTableWithValidatedConfidence(db) {
  const noteColumns = getTableColumnNames(db, "notes");
  const legacyNoteCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM notes").get()?.count ?? 0
  );
  const needsPlaceholderEmail =
    legacyNoteCount > 0 &&
    (!noteColumns.has("email_id") ||
      Boolean(
        db.prepare(`
          SELECT 1
          FROM notes AS legacy_notes
          WHERE legacy_notes.email_id IS NULL
             OR NOT EXISTS (
               SELECT 1
               FROM emails
               WHERE emails.id = legacy_notes.email_id
             )
          LIMIT 1
        `).get()
      ));
  const placeholderEmailId = needsPlaceholderEmail
    ? ensurePlaceholderEmailForLegacyNotes(db)
    : null;
  const fallbackEmailIdExpression =
    placeholderEmailId === null ? "NULL" : String(placeholderEmailId);
  const fallbackTitleExpression = "'Legacy migrated note #' || legacy_notes.id";
  const titleExpression = noteColumns.has("title")
    ? `COALESCE(NULLIF(trim(legacy_notes.title), ''), ${fallbackTitleExpression})`
    : fallbackTitleExpression;
  const bodyExpression = noteColumns.has("body")
    ? `COALESCE(NULLIF(trim(legacy_notes.body), ''), ${titleExpression})`
    : titleExpression;
  const summaryExpression = noteColumns.has("summary")
    ? "NULLIF(trim(legacy_notes.summary), '')"
    : "NULL";
  const sourceExcerptExpression = noteColumns.has("source_excerpt")
    ? "NULLIF(trim(legacy_notes.source_excerpt), '')"
    : "NULL";
  const sourceTimestampExpression = noteColumns.has("source_timestamp")
    ? "NULLIF(trim(legacy_notes.source_timestamp), '')"
    : "NULL";
  const createdAtExpression = noteColumns.has("created_at")
    ? "COALESCE(NULLIF(trim(legacy_notes.created_at), ''), CURRENT_TIMESTAMP)"
    : "CURRENT_TIMESTAMP";
  const updatedAtExpression = noteColumns.has("updated_at")
    ? "COALESCE(NULLIF(trim(legacy_notes.updated_at), ''), CURRENT_TIMESTAMP)"
    : createdAtExpression;
  const taxonomyKeyExpression = noteColumns.has("taxonomy_key")
    ? "COALESCE(NULLIF(trim(legacy_notes.taxonomy_key), ''), 'claim')"
    : "'claim'";
  const emailIdExpression = noteColumns.has("email_id")
    ? `CASE
        WHEN legacy_notes.email_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM emails WHERE id = legacy_notes.email_id)
          THEN legacy_notes.email_id
        ELSE ${fallbackEmailIdExpression}
      END`
    : fallbackEmailIdExpression;
  const confidenceExpression = noteColumns.has("confidence")
    ? `CASE
        WHEN legacy_notes.confidence IS NULL THEN NULL
        WHEN typeof(legacy_notes.confidence) IN ('integer', 'real')
          AND legacy_notes.confidence >= 0
          AND legacy_notes.confidence <= 1
          THEN legacy_notes.confidence
        ELSE NULL
      END`
    : "NULL";
  const classificationConfidenceExpression = noteColumns.has("classification_confidence")
    ? `CASE
        WHEN legacy_notes.classification_confidence IS NULL THEN ${confidenceExpression}
        WHEN typeof(legacy_notes.classification_confidence) IN ('integer', 'real')
          AND legacy_notes.classification_confidence >= 0
          AND legacy_notes.classification_confidence <= 1
          THEN legacy_notes.classification_confidence
        ELSE ${confidenceExpression}
      END`
    : confidenceExpression;
  const noteKeywordRows = tableExists(db, "note_keywords")
    ? db.prepare(`
        SELECT note_id, keyword_id, source, created_at
        FROM note_keywords
        ORDER BY note_id ASC, keyword_id ASC
      `).all()
    : [];
  const relationshipColumns = tableExists(db, "relationships")
    ? getTableColumnNames(db, "relationships")
    : new Set();
  const selectMatchedTermsSql = relationshipColumns.has("matched_terms_json")
    ? "matched_terms_json"
    : "'[]' AS matched_terms_json";
  const relationshipRows = tableExists(db, "relationships")
    ? db.prepare(`
        SELECT
          note_id,
          related_note_id,
          relationship_type,
          strength,
          overlap_basis,
          matched_value,
          ${selectMatchedTermsSql},
          overlap_source_metadata_json,
          created_at,
          updated_at
        FROM relationships
        ORDER BY note_id ASC, related_note_id ASC, overlap_basis ASC, matched_value ASC
      `).all()
    : [];

  db.exec(`
    PRAGMA defer_foreign_keys = ON;

    DROP TABLE IF EXISTS notes_next;

    CREATE TABLE notes_next (
      id INTEGER PRIMARY KEY,
      email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      taxonomy_key TEXT NOT NULL REFERENCES taxonomy_types(key),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      summary TEXT,
      source_excerpt TEXT,
      confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      classification_confidence REAL CHECK (
        classification_confidence IS NULL OR (
          classification_confidence >= 0
          AND classification_confidence <= 1
        )
      ),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source_timestamp TEXT
    );

    INSERT INTO notes_next (
      id,
      email_id,
      taxonomy_key,
      title,
      body,
      summary,
      source_excerpt,
      confidence,
      classification_confidence,
      created_at,
      updated_at,
      source_timestamp
    )
    SELECT
      legacy_notes.id,
      ${emailIdExpression},
      ${taxonomyKeyExpression},
      ${titleExpression},
      ${bodyExpression},
      ${summaryExpression},
      ${sourceExcerptExpression},
      ${confidenceExpression},
      ${classificationConfidenceExpression},
      ${createdAtExpression},
      ${updatedAtExpression},
      ${sourceTimestampExpression}
    FROM notes AS legacy_notes;

    DROP TABLE notes;

    ALTER TABLE notes_next
    RENAME TO notes;

    CREATE INDEX IF NOT EXISTS notes_by_email_id
    ON notes (email_id);

    CREATE INDEX IF NOT EXISTS notes_by_taxonomy_key
    ON notes (taxonomy_key);
  `);

  if (noteKeywordRows.length > 0) {
    const insertNoteKeyword = db.prepare(`
      INSERT OR IGNORE INTO note_keywords (
        note_id,
        keyword_id,
        source,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `);

    for (const row of noteKeywordRows) {
      insertNoteKeyword.run(row.note_id, row.keyword_id, row.source, row.created_at);
    }
  }

  if (relationshipRows.length > 0) {
    const insertRelationship = relationshipColumns.has("matched_terms_json")
      ? db.prepare(`
          INSERT OR IGNORE INTO relationships (
            note_id,
            related_note_id,
            relationship_type,
            strength,
            overlap_basis,
            matched_value,
            matched_terms_json,
            overlap_source_metadata_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      : db.prepare(`
          INSERT OR IGNORE INTO relationships (
            note_id,
            related_note_id,
            relationship_type,
            strength,
            overlap_basis,
            matched_value,
            overlap_source_metadata_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

    for (const row of relationshipRows) {
      if (relationshipColumns.has("matched_terms_json")) {
        insertRelationship.run(
          row.note_id,
          row.related_note_id,
          row.relationship_type,
          row.strength,
          row.overlap_basis,
          row.matched_value,
          row.matched_terms_json,
          row.overlap_source_metadata_json,
          row.created_at,
          row.updated_at
        );
      } else {
        insertRelationship.run(
          row.note_id,
          row.related_note_id,
          row.relationship_type,
          row.strength,
          row.overlap_basis,
          row.matched_value,
          row.overlap_source_metadata_json,
          row.created_at,
          row.updated_at
        );
      }
    }
  }
}

function migrateRelationshipsMatchedTerms(db) {
  if (!tableExists(db, "relationships")) {
    return;
  }

  const relationshipColumns = getTableColumnNames(db, "relationships");
  const selectMatchedTermsSql = relationshipColumns.has("matched_terms_json")
    ? "matched_terms_json"
    : "'[]' AS matched_terms_json";
  const relationshipRows = db.prepare(`
    SELECT
      id,
      note_id,
      related_note_id,
      relationship_type,
      strength,
      overlap_basis,
      matched_value,
      ${selectMatchedTermsSql},
      overlap_source_metadata_json,
      created_at,
      updated_at
    FROM relationships
    ORDER BY id ASC
  `).all();

  db.exec(`
    PRAGMA defer_foreign_keys = ON;

    DROP TABLE IF EXISTS relationships_next;

    CREATE TABLE relationships_next (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
      strength REAL NOT NULL DEFAULT 0,
      overlap_basis TEXT NOT NULL,
      matched_value TEXT NOT NULL COLLATE NOCASE,
      matched_terms_json TEXT NOT NULL DEFAULT '[]',
      overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (note_id, related_note_id, relationship_type, overlap_basis, matched_value),
      CHECK (
        (
          relationship_type = 'duplicate_of'
          AND note_id != related_note_id
        ) OR (
          relationship_type != 'duplicate_of'
          AND note_id < related_note_id
        )
      ),
      CHECK (overlap_basis IN ('topic', 'keyword', 'both'))
    );

    DROP TABLE relationships;

    ALTER TABLE relationships_next
    RENAME TO relationships;

    CREATE INDEX IF NOT EXISTS relationships_by_note_id
    ON relationships (note_id);

    CREATE INDEX IF NOT EXISTS relationships_by_related_note_id
    ON relationships (related_note_id);

    CREATE INDEX IF NOT EXISTS relationships_by_relationship_type
    ON relationships (relationship_type);

    CREATE INDEX IF NOT EXISTS relationships_by_overlap_basis
    ON relationships (overlap_basis);

    CREATE INDEX IF NOT EXISTS relationships_by_matched_value
    ON relationships (matched_value);
  `);

  if (relationshipRows.length === 0) {
    return;
  }

  const insertRelationship = db.prepare(`
    INSERT OR IGNORE INTO relationships (
      id,
      note_id,
      related_note_id,
      relationship_type,
      strength,
      overlap_basis,
      matched_value,
      matched_terms_json,
      overlap_source_metadata_json,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of relationshipRows) {
    const overlapBasis = normalizeRelationshipOverlapBasis(row.overlap_basis) ?? "keyword";
    const matchedTerms = buildOrderedUniqueKeywords(
      parseJsonArray(row.matched_terms_json).concat(row.matched_value)
    );
    const matchedValue = trimToNull(row.matched_value) ?? matchedTerms[0];

    if (!matchedValue) {
      continue;
    }

    insertRelationship.run(
      row.id,
      row.note_id,
      row.related_note_id,
      row.relationship_type,
      row.strength,
      overlapBasis,
      matchedValue,
      JSON.stringify(matchedTerms),
      row.overlap_source_metadata_json,
      row.created_at,
      row.updated_at
    );
  }
}

function migrateDuplicateRelationshipsToSingleEdge(db) {
  if (!tableExists(db, "relationships")) {
    return;
  }

  const duplicateRows = db.prepare(`
    SELECT
      id,
      note_id,
      related_note_id,
      relationship_type,
      strength,
      overlap_basis,
      matched_value,
      matched_terms_json,
      overlap_source_metadata_json,
      created_at,
      updated_at
    FROM relationships
    WHERE relationship_type = ?
    ORDER BY note_id ASC, related_note_id ASC, strength DESC, id ASC
  `).all(DUPLICATE_OF_RELATIONSHIP_TYPE);
  const deleteRelationship = db.prepare(`
    DELETE FROM relationships
    WHERE id = ?
  `);
  const updateRelationship = db.prepare(`
    UPDATE relationships
    SET
      strength = ?,
      overlap_basis = ?,
      matched_value = ?,
      matched_terms_json = ?,
      overlap_source_metadata_json = ?,
      updated_at = ?
    WHERE id = ?
  `);
  const groupedRelationships = new Map();

  for (const row of duplicateRows) {
    if (Number(row.note_id) === Number(row.related_note_id)) {
      deleteRelationship.run(row.id);
      continue;
    }

    const parsedMetadata = parseJsonObject(row.overlap_source_metadata_json);
    const matchedTerms = buildRelationshipOverlapTerms(row, parsedMetadata);
    const groupKey = buildDuplicateRelationshipPairKey(row.note_id, row.related_note_id);
    const existingGroup = groupedRelationships.get(groupKey);
    const incomingMetadata = {
      ...parsedMetadata,
      matchedBy: DUPLICATE_OF_RELATIONSHIP_TYPE,
      canonicalNoteId: row.related_note_id,
      matchedTerms,
    };

    if (!existingGroup) {
      groupedRelationships.set(groupKey, {
        keeperId: row.id,
        duplicateIds: [],
        strength: Number(row.strength) || 0,
        overlapBasis: normalizeRelationshipOverlapBasis(row.overlap_basis) ?? "keyword",
        preferredMatchedValue: trimToNull(row.matched_value),
        matchedTerms,
        metadata: incomingMetadata,
        updatedAt: trimToNull(row.updated_at) ?? trimToNull(row.created_at) ?? null,
      });
      continue;
    }

    existingGroup.duplicateIds.push(row.id);
    existingGroup.strength = Math.max(existingGroup.strength, Number(row.strength) || 0);
    existingGroup.overlapBasis =
      mergeRelationshipOverlapBases(existingGroup.overlapBasis, row.overlap_basis) ?? "keyword";
    existingGroup.matchedTerms = buildOrderedUniqueKeywords([
      ...existingGroup.matchedTerms,
      ...matchedTerms,
    ]);
    existingGroup.preferredMatchedValue = buildDuplicateRelationshipMatchedValue(
      existingGroup.preferredMatchedValue,
      row.matched_value,
      existingGroup.matchedTerms
    );
    existingGroup.metadata = mergeDuplicateRelationshipMetadata(
      existingGroup.metadata,
      incomingMetadata,
      existingGroup.matchedTerms
    );
    existingGroup.updatedAt =
      [existingGroup.updatedAt, trimToNull(row.updated_at), trimToNull(row.created_at)]
        .filter(Boolean)
        .sort()
        .at(-1) ?? existingGroup.updatedAt;
  }

  for (const groupedRelationship of groupedRelationships.values()) {
    for (const duplicateId of groupedRelationship.duplicateIds) {
      deleteRelationship.run(duplicateId);
    }

    const matchedTerms = buildOrderedUniqueKeywords(groupedRelationship.matchedTerms);
    const matchedValue = buildDuplicateRelationshipMatchedValue(
      groupedRelationship.preferredMatchedValue,
      matchedTerms
    );

    updateRelationship.run(
      groupedRelationship.strength,
      groupedRelationship.overlapBasis,
      matchedValue,
      JSON.stringify(matchedTerms),
      JSON.stringify(
        mergeDuplicateRelationshipMetadata(
          groupedRelationship.metadata,
          {},
          matchedTerms
        )
      ),
      groupedRelationship.updatedAt ?? new Date().toISOString(),
      groupedRelationship.keeperId
    );
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${DUPLICATE_OF_UNIQUE_INDEX_NAME}
    ON relationships (note_id, related_note_id, relationship_type)
    WHERE relationship_type = '${DUPLICATE_OF_RELATIONSHIP_TYPE}';
  `);
}

function getTableColumnNames(db, tableName) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name)
  );
}

function tableExists(db, tableName) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
    `).get(tableName)
  );
}

function migrateEmailProcessingJobsRawEmailLink(db) {
  if (!tableExists(db, "email_processing_jobs")) {
    return;
  }

  const jobColumns = getTableColumnNames(db, "email_processing_jobs");

  if (!jobColumns.has("raw_email_id")) {
    db.exec(`
      ALTER TABLE email_processing_jobs
      ADD COLUMN raw_email_id INTEGER REFERENCES raw_emails(id) ON DELETE SET NULL;
    `);
  }

  const canBackfillRawEmailId =
    tableExists(db, "emails") &&
    tableExists(db, "raw_emails") &&
    getTableColumnNames(db, "emails").has("agentmail_message_id") &&
    getTableColumnNames(db, "raw_emails").has("agentmail_message_id");

  if (canBackfillRawEmailId) {
    db.exec(`
      UPDATE email_processing_jobs
      SET raw_email_id = (
        SELECT raw_emails.id
        FROM emails
        INNER JOIN raw_emails
          ON raw_emails.agentmail_message_id = emails.agentmail_message_id
        WHERE emails.id = email_processing_jobs.email_id
        LIMIT 1
      )
      WHERE raw_email_id IS NULL;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS email_processing_jobs_by_raw_email_id
    ON email_processing_jobs (raw_email_id);
  `);
}

function migrateEmailProcessingJobsQueueState(db) {
  if (!tableExists(db, "email_processing_jobs")) {
    return;
  }

  migrateEmailProcessingJobsRawEmailLink(db);
  const hasProcessingEvents = tableExists(db, "email_processing_events");
  const eventJobLinks = hasProcessingEvents
    ? db
        .prepare(`
          SELECT id, processing_job_id
          FROM email_processing_events
          WHERE processing_job_id IS NOT NULL
          ORDER BY id ASC
        `)
        .all()
    : [];

  const jobColumns = getTableColumnNames(db, "email_processing_jobs");

  if (!jobColumns.has("failed_at")) {
    db.exec(`
      ALTER TABLE email_processing_jobs
      ADD COLUMN failed_at TEXT;

      UPDATE email_processing_jobs
      SET failed_at = completed_at
      WHERE status = 'failed'
        AND failed_at IS NULL
        AND completed_at IS NOT NULL;
    `);
  }

  db.exec(`
    PRAGMA defer_foreign_keys = ON;

    DROP TABLE IF EXISTS email_processing_jobs_next;

    CREATE TABLE email_processing_jobs_next (
      id INTEGER PRIMARY KEY,
      email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
      raw_email_id INTEGER REFERENCES raw_emails(id) ON DELETE SET NULL,
      webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO email_processing_jobs_next (
      id,
      email_id,
      raw_email_id,
      webhook_delivery_id,
      status,
      attempts,
      error_message,
      created_at,
      started_at,
      completed_at,
      failed_at,
      updated_at
    )
    SELECT
      id,
      email_id,
      raw_email_id,
      webhook_delivery_id,
      CASE
        WHEN status IN ('queued', 'processing', 'completed', 'failed') THEN status
        ELSE 'queued'
      END,
      attempts,
      error_message,
      created_at,
      started_at,
      completed_at,
      failed_at,
      updated_at
    FROM email_processing_jobs;

    DROP TABLE email_processing_jobs;

    ALTER TABLE email_processing_jobs_next
    RENAME TO email_processing_jobs;

    CREATE INDEX IF NOT EXISTS email_processing_jobs_by_status_created_at
    ON email_processing_jobs (status, created_at);

    CREATE INDEX IF NOT EXISTS email_processing_jobs_by_raw_email_id
    ON email_processing_jobs (raw_email_id);
  `);

  if (hasProcessingEvents) {
    db.exec(`
      UPDATE email_processing_events
      SET job_status = 'queued'
      WHERE job_status = 'pending';
    `);

    const restoreEventJobLink = db.prepare(`
      UPDATE email_processing_events
      SET processing_job_id = ?
      WHERE id = ?
    `);

    for (const eventJobLink of eventJobLinks) {
      restoreEventJobLink.run(eventJobLink.processing_job_id, eventJobLink.id);
    }
  }
}

function migrateNoteClassificationConfidence(db) {
  if (!tableExists(db, "notes")) {
    return;
  }

  const noteColumns = getTableColumnNames(db, "notes");

  if (!noteColumns.has("classification_confidence")) {
    db.exec(`
      ALTER TABLE notes
      ADD COLUMN classification_confidence REAL
      CHECK (
        classification_confidence IS NULL OR (
          classification_confidence >= 0
          AND classification_confidence <= 1
        )
      );
    `);
  }

  if (noteColumns.has("confidence")) {
    db.exec(`
      UPDATE notes
      SET classification_confidence = CASE
        WHEN classification_confidence IS NOT NULL THEN classification_confidence
        WHEN confidence IS NULL THEN NULL
        WHEN typeof(confidence) IN ('integer', 'real')
          AND confidence >= 0
          AND confidence <= 1
          THEN confidence
        ELSE NULL
      END
      WHERE classification_confidence IS NULL;
    `);
  }
}

function migrateSourcesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      sender_address TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT,
      email_count INTEGER NOT NULL DEFAULT 0 CHECK (email_count >= 0),
      first_seen_at TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS sources_by_last_seen_at
    ON sources (last_seen_at DESC, id DESC);
  `);

  const emailColumns = getTableColumnNames(db, "emails");

  if (!emailColumns.has("source_id")) {
    db.exec(`
      ALTER TABLE emails
      ADD COLUMN source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL;
    `);
  }

  if (emailColumns.has("received_at")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS emails_by_source_id_received_at
      ON emails (source_id, received_at DESC, id DESC);
    `);
  }

  const senderAddressExpression = emailColumns.has("sender_address")
    ? "NULLIF(trim(sender_address), '')"
    : "NULL";
  const fromAddressExpression = emailColumns.has("from_address")
    ? "NULLIF(trim(from_address), '')"
    : "NULL";
  const sourceAddressExpression = `COALESCE(${senderAddressExpression}, ${fromAddressExpression})`;

  if (sourceAddressExpression === "COALESCE(NULL, NULL)") {
    return;
  }

  const displayNameExpression = emailColumns.has("from_name")
    ? "NULLIF(trim(from_name), '')"
    : "NULL";
  const observedAtExpression = `COALESCE(${
    emailColumns.has("received_at") ? "NULLIF(trim(received_at), '')" : "NULL"
  }, ${
    emailColumns.has("sent_at") ? "NULLIF(trim(sent_at), '')" : "NULL"
  }, ${emailColumns.has("created_at") ? "created_at" : "NULL"})`;

  db.exec(`
    INSERT INTO sources (
      sender_address,
      display_name,
      email_count,
      first_seen_at,
      last_seen_at
    )
    SELECT
      lower(trim(${sourceAddressExpression})),
      MAX(${displayNameExpression}),
      COUNT(*),
      MIN(datetime(${observedAtExpression})),
      MAX(datetime(${observedAtExpression}))
    FROM emails
    WHERE ${sourceAddressExpression} IS NOT NULL
    GROUP BY lower(trim(${sourceAddressExpression}));
  `);

  db.exec(`
    UPDATE emails
    SET source_id = (
      SELECT sources.id
      FROM sources
      WHERE sources.sender_address = lower(trim(${sourceAddressExpression}))
    )
    WHERE ${sourceAddressExpression} IS NOT NULL;
  `);
}

function syncTaxonomyTypes(db) {
  const insertTaxonomyType = db.prepare(`
    INSERT INTO taxonomy_types (key, label, description)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label,
      description = excluded.description
  `);

  for (const taxonomyType of TAXONOMY_TYPES) {
    insertTaxonomyType.run(
      taxonomyType.key,
      taxonomyType.label,
      taxonomyType.description
    );
  }
}

function ensureLegacyMigrationTables(db, schemaVersion = 0) {
  const directionalRelationshipCheckSql =
    schemaVersion >= 18
      ? `
      CHECK (
        (
          relationship_type = 'duplicate_of'
          AND note_id != related_note_id
        ) OR (
          relationship_type != 'duplicate_of'
          AND note_id < related_note_id
        )
      ),
    `
      : `
      CHECK (note_id < related_note_id),
    `;
  const noteLinksTableSql =
    schemaVersion < 3
      ? `
    CREATE TABLE IF NOT EXISTS note_links (
      source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
      strength REAL NOT NULL DEFAULT 0,
      shared_keywords_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_note_id, target_note_id),
      CHECK (source_note_id < target_note_id)
    );
  `
      : "";
  const relationshipsTableSql =
    schemaVersion >= 19
      ? `
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
      strength REAL NOT NULL DEFAULT 0,
      overlap_basis TEXT NOT NULL,
      matched_value TEXT NOT NULL COLLATE NOCASE,
      matched_terms_json TEXT NOT NULL DEFAULT '[]',
      overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (note_id, related_note_id, relationship_type, overlap_basis, matched_value),
      ${directionalRelationshipCheckSql}
      CHECK (overlap_basis IN ('topic', 'keyword', 'both'))
    );
  `
      : schemaVersion >= 9
      ? `
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
      strength REAL NOT NULL DEFAULT 0,
      overlap_basis TEXT NOT NULL,
      matched_value TEXT NOT NULL COLLATE NOCASE,
      overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (note_id, related_note_id, relationship_type, overlap_basis, matched_value),
      ${directionalRelationshipCheckSql}
      CHECK (overlap_basis IN ('topic', 'keyword'))
    );
  `
      : `
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      related_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
      strength REAL NOT NULL DEFAULT 0,
      overlap_source TEXT NOT NULL DEFAULT 'keyword_overlap',
      overlap_source_metadata_json TEXT NOT NULL DEFAULT '{}',
      overlap_terms_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (note_id, related_note_id),
      CHECK (note_id < related_note_id)
    );
  `;
  const duplicateOfRelationshipIndexSql =
    schemaVersion >= 21
      ? `
    CREATE UNIQUE INDEX IF NOT EXISTS ${DUPLICATE_OF_UNIQUE_INDEX_NAME}
    ON relationships (note_id, related_note_id, relationship_type)
    WHERE relationship_type = '${DUPLICATE_OF_RELATIONSHIP_TYPE}';
  `
      : "";

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY
    );

    ${noteLinksTableSql}
    ${relationshipsTableSql}
    ${duplicateOfRelationshipIndexSql}
  `);
}

export function resolveDatabasePath(env = process.env) {
  const configuredPath = env.DATABASE_PATH || env.SQLITE_PATH;

  if (!configuredPath) {
    return DEFAULT_DATABASE_PATH;
  }

  if (isSpecialDatabasePath(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(__dirname, configuredPath);
}

function initializeSchema(db) {
  let activeMigration = null;

  let transactionActive = false;
  db.exec("BEGIN IMMEDIATE");
  transactionActive = true;

  try {
    let schemaVersion = getSchemaVersion(db);

    if (schemaVersion > 0) {
      ensureLegacyMigrationTables(db, schemaVersion);
    }

    for (const migration of MIGRATIONS) {
      if (migration.version <= schemaVersion) {
        continue;
      }

      activeMigration = migration;
      if (typeof migration.run === "function") {
        migration.run(db);
      } else {
        db.exec(migration.sql);
      }
      db.exec(`PRAGMA user_version = ${migration.version}`);
      schemaVersion = migration.version;
    }

    syncTaxonomyTypes(db);
    db.exec("COMMIT");
    transactionActive = false;

    return schemaVersion;
  } catch (error) {
    db.exec("ROLLBACK");

    if (activeMigration) {
      throw new Error(
        `Failed to apply SQLite migration ${activeMigration.version} (${activeMigration.name}): ${error.message}`
      );
    }

    throw new Error(`Failed to initialize SQLite schema: ${error.message}`);
  }
}

export async function openDatabaseConnection(options = {}) {
  const databasePath = options.databasePath || resolveDatabasePath();
  const shouldInitializeSchema = options.initializeSchema !== false;

  await ensureDatabaseDirectory(databasePath);

  const db = new DatabaseSync(databasePath);

  try {
    configureDatabase(db);

    return {
      db,
      databasePath,
      schemaVersion: shouldInitializeSchema ? initializeSchema(db) : getSchemaVersion(db),
      taxonomyTypeCount: TAXONOMY_TYPES.length,
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseJsonObject(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return {};
  }

  try {
    return getObject(JSON.parse(normalized)) ?? {};
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getMessageHeader(headers, targetName) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return null;
  }

  const target = targetName.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return trimToNull(String(value));
    }
  }

  return null;
}

function parseMailbox(value) {
  const raw = trimToNull(value);

  if (!raw) {
    return { name: null, address: null };
  }

  const angleMatch = raw.match(/^(?:"?([^"]+)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/);

  if (angleMatch) {
    return {
      name: trimToNull(angleMatch[1] ?? null),
      address: trimToNull(angleMatch[2]),
    };
  }

  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (!emailMatch) {
    return { name: raw, address: null };
  }

  const address = trimToNull(emailMatch[0]);
  const name = trimToNull(
    raw
      .replace(emailMatch[0], "")
      .replace(/[<>\"]/g, "")
      .replace(/\s+/g, " ")
  );

  return { name, address };
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = trimToNull(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeSourceSenderAddress(value) {
  const normalized = trimToNull(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizePersistedSourceTimestamp(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized.replace(" ", "T")}Z`;
  }

  return normalized;
}

function normalizePersistedConfidenceValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePersistedBooleanValue(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  return null;
}

function hydratePersistedNoteRow(row) {
  if (!row) {
    return null;
  }

  const {
    feedback_useful: rawFeedbackUseful,
    feedbackUseful: rawFeedbackUsefulAlias,
    feedback_comment: rawFeedbackComment,
    feedbackComment: rawFeedbackCommentAlias,
    feedback_updated_at: rawFeedbackUpdatedAt,
    feedbackUpdatedAt: rawFeedbackUpdatedAtAlias,
    ...persistedRow
  } = row;
  const classificationConfidence = normalizePersistedConfidenceValue(
    row.classification_confidence ?? row.classificationConfidence ?? row.confidence
  );
  const feedbackUseful = normalizePersistedBooleanValue(
    rawFeedbackUseful ?? rawFeedbackUsefulAlias
  );
  const feedbackComment = trimToNull(rawFeedbackComment ?? rawFeedbackCommentAlias ?? null);
  const feedbackUpdatedAt = normalizePersistedSourceTimestamp(
    rawFeedbackUpdatedAt ?? rawFeedbackUpdatedAtAlias ?? null
  );
  const hydratedRow = {
    ...persistedRow,
    confidence: classificationConfidence,
    classification_confidence: classificationConfidence,
    classificationConfidence,
  };

  if (feedbackUseful !== null) {
    hydratedRow.feedback = {
      useful: feedbackUseful,
      comment: feedbackComment,
      updated_at: feedbackUpdatedAt,
    };
  }

  return hydratedRow;
}

function buildEmailSourceRecord(rawEmail) {
  return {
    senderAddress: normalizeSourceSenderAddress(
      pickFirstString(rawEmail.sender_address, rawEmail.from_address)
    ),
    displayName: pickFirstString(rawEmail.from_name),
    observedAt: pickFirstString(rawEmail.received_at, rawEmail.sent_at, rawEmail.created_at),
  };
}

function normalizeSourceTimestamp(note) {
  return pickFirstString(
    note.sourceTimestamp,
    note.source_timestamp,
    note.timestamp,
    note.createdAt,
    note.created_at
  );
}

function normalizeSourceExcerpt(note) {
  return pickFirstString(note.sourceExcerpt, note.source_excerpt, note.source);
}

function normalizeNoteConfidence(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Note confidence must be a finite number between 0 and 1");
  }

  if (value < 0 || value > 1) {
    throw new RangeError(`Note confidence must be between 0 and 1. Received ${value}`);
  }

  return value;
}

function normalizeNoteFeedbackUseful(value) {
  if (typeof value !== "boolean") {
    throw new TypeError("Note feedback useful must be a boolean");
  }

  return value;
}

function normalizeNoteFeedbackComment(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError("Note feedback comment must be a string when provided");
  }

  return trimToNull(value);
}

function resolveNoteClassificationConfidence(note) {
  return normalizeNoteConfidence(
    note.classificationConfidence ?? note.classification_confidence ?? note.confidence
  );
}

function normalizeTaxonomyKey(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  return TAXONOMY_KEY_ALIASES.get(normalizeTaxonomyAlias(normalized)) ?? normalized;
}

function normalizePersistedKeyword(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function buildOrderedUniqueKeywords(values, limit = MAX_PERSISTED_KEYWORDS) {
  const keywords = [];
  const seen = new Set();

  for (const value of values) {
    const normalizedKeyword = normalizePersistedKeyword(value);

    if (!normalizedKeyword || seen.has(normalizedKeyword)) {
      continue;
    }

    seen.add(normalizedKeyword);
    keywords.push(normalizedKeyword);

    if (keywords.length >= limit) {
      break;
    }
  }

  return keywords;
}

function splitSerializedKeywords(value) {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  return value.split(SERIALIZED_KEYWORD_SEPARATOR).filter(Boolean);
}

function normalizeRelationshipOverlapBasis(value) {
  const normalized = trimToNull(value)
    ?.toLowerCase()
    .replace(/[^a-z]+/g, " ");

  if (!normalized) {
    return null;
  }

  if (normalized.includes("both")) {
    return "both";
  }

  const includesTopic = normalized.includes("topic");
  const includesKeyword = normalized.includes("keyword");

  if (includesTopic && includesKeyword) {
    return "both";
  }

  if (includesTopic) {
    return "topic";
  }

  if (includesKeyword) {
    return "keyword";
  }

  return null;
}

function buildRelationshipSourceLabel(overlapBasis) {
  if (overlapBasis === "topic") {
    return "topic_overlap";
  }

  if (overlapBasis === "both") {
    return "topic_keyword_overlap";
  }

  return "keyword_overlap";
}

function buildRelationshipGroupKey(relationship) {
  if (relationship.relationship_type === DUPLICATE_OF_RELATIONSHIP_TYPE) {
    return [relationship.note_id, relationship.related_note_id, relationship.relationship_type].join(
      ":"
    );
  }

  return [
    relationship.note_id,
    relationship.related_note_id,
    relationship.relationship_type,
    relationship.overlap_basis,
  ].join(":");
}

function buildResolvedRelationshipGroupKey(relationship) {
  if (relationship.relationship_type === DUPLICATE_OF_RELATIONSHIP_TYPE) {
    return [relationship.resolved_related_note_id, relationship.relationship_type].join(":");
  }

  return [
    relationship.resolved_related_note_id,
    relationship.relationship_type,
    relationship.overlap_basis,
  ].join(":");
}

function buildPersistedRelationshipType(relationshipType, overlapBasis) {
  return trimToNull(relationshipType) ?? `shared_${overlapBasis}`;
}

function buildRelationshipMetadataLabel(relationshipType, overlapBasis) {
  return relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE
    ? DUPLICATE_OF_RELATIONSHIP_TYPE
    : buildRelationshipSourceLabel(overlapBasis);
}

function buildRelationshipOverlapTerms(row, parsedMetadata) {
  return buildOrderedUniqueKeywords(
    parseJsonArray(row.matched_terms_json).concat(
      row.relationship_type === DUPLICATE_OF_RELATIONSHIP_TYPE
        ? parsedMetadata.matchedTerms ??
            parsedMetadata.sharedTerms ??
            parsedMetadata.overlapTerms ??
            parsedMetadata.justificationTerms ??
            []
        : [],
      row.matched_value
    )
  );
}

function buildDuplicateRelationshipPairKey(noteId, relatedNoteId) {
  return [noteId, relatedNoteId, DUPLICATE_OF_RELATIONSHIP_TYPE].join(":");
}

function normalizeDuplicateRelationshipMatchedRules(value) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((rule) => typeof rule === "string")
            .map((rule) => rule.trim())
            .filter(Boolean)
        )
      )
    : [];
}

function mergeRelationshipOverlapBases(left, right) {
  const normalizedLeft = normalizeRelationshipOverlapBasis(left);
  const normalizedRight = normalizeRelationshipOverlapBasis(right);

  if (!normalizedLeft) {
    return normalizedRight;
  }

  if (!normalizedRight || normalizedLeft === normalizedRight) {
    return normalizedLeft;
  }

  return "both";
}

function pickPreferredDuplicateKind(...values) {
  const normalizedKinds = values
    .map((value) => trimToNull(value)?.toLowerCase())
    .filter(Boolean);

  if (normalizedKinds.includes("exact")) {
    return "exact";
  }

  return normalizedKinds[0] ?? null;
}

function buildDuplicateRelationshipMatchedValue(...valueSets) {
  return (
    buildOrderedUniqueKeywords(
      valueSets.flatMap((valueSet) => (Array.isArray(valueSet) ? valueSet : [valueSet]))
    )[0] ?? DUPLICATE_OF_FALLBACK_MATCHED_VALUE
  );
}

function mergeDuplicateRelationshipMetadata(existingMetadata, incomingMetadata, matchedTerms) {
  const normalizedExisting = getObject(existingMetadata) ?? {};
  const normalizedIncoming = getObject(incomingMetadata) ?? {};
  const existingRules = normalizeDuplicateRelationshipMatchedRules(normalizedExisting.matchedRules);
  const incomingRules = normalizeDuplicateRelationshipMatchedRules(normalizedIncoming.matchedRules);
  const existingSimilarityScore =
    typeof normalizedExisting.similarityScore === "number" &&
    Number.isFinite(normalizedExisting.similarityScore)
      ? normalizedExisting.similarityScore
      : null;
  const incomingSimilarityScore =
    typeof normalizedIncoming.similarityScore === "number" &&
    Number.isFinite(normalizedIncoming.similarityScore)
      ? normalizedIncoming.similarityScore
      : null;
  const mergedRules = Array.from(new Set([...existingRules, ...incomingRules]));
  const preferIncomingSimilarity =
    incomingSimilarityScore !== null &&
    (existingSimilarityScore === null || incomingSimilarityScore >= existingSimilarityScore);

  return {
    ...normalizedExisting,
    ...normalizedIncoming,
    matchedBy: DUPLICATE_OF_RELATIONSHIP_TYPE,
    duplicateKind:
      pickPreferredDuplicateKind(
        normalizedExisting.duplicateKind,
        normalizedIncoming.duplicateKind
      ) ?? undefined,
    matchedRules: mergedRules.length > 0 ? mergedRules : undefined,
    similarityScore:
      incomingSimilarityScore === null && existingSimilarityScore === null
        ? undefined
        : Math.max(incomingSimilarityScore ?? 0, existingSimilarityScore ?? 0),
    similarity: preferIncomingSimilarity
      ? normalizedIncoming.similarity ?? normalizedExisting.similarity
      : normalizedExisting.similarity ?? normalizedIncoming.similarity,
    canonicalNoteId:
      normalizedIncoming.canonicalNoteId ?? normalizedExisting.canonicalNoteId ?? undefined,
    matchedTerms,
  };
}

function resolveRelationshipStrength(relationship, fallback = 0) {
  if (typeof relationship?.similarityScore === "number" && Number.isFinite(relationship.similarityScore)) {
    return relationship.similarityScore;
  }

  if (typeof relationship?.score === "number" && Number.isFinite(relationship.score)) {
    return relationship.score;
  }

  return fallback;
}

function compareDuplicateRelationshipCandidates(left, right) {
  const leftKindRank = left?.duplicateKind === "exact" ? 0 : 1;
  const rightKindRank = right?.duplicateKind === "exact" ? 0 : 1;

  if (leftKindRank !== rightKindRank) {
    return leftKindRank - rightKindRank;
  }

  const leftScore =
    typeof left?.similarityScore === "number"
      ? left.similarityScore
      : typeof left?.score === "number"
        ? left.score
        : 0;
  const rightScore =
    typeof right?.similarityScore === "number"
      ? right.similarityScore
      : typeof right?.score === "number"
        ? right.score
        : 0;

  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return (
    Number(left?.existingNoteId ?? left?.relatedNoteId ?? Number.MAX_SAFE_INTEGER) -
    Number(right?.existingNoteId ?? right?.relatedNoteId ?? Number.MAX_SAFE_INTEGER)
  );
}

function resolveCanonicalDuplicateNote(db, noteId) {
  const selectDuplicateRelationship = db.prepare(`
    SELECT related_note_id
    FROM relationships
    WHERE relationship_type = ?
      AND note_id = ?
    ORDER BY strength DESC, id ASC
    LIMIT 1
  `);
  const selectNote = db.prepare(`
    SELECT
      id,
      email_id,
      taxonomy_key,
      title
    FROM notes
    WHERE id = ?
  `);
  const seenNoteIds = new Set();
  let resolvedNoteId = Number(noteId);

  while (resolvedNoteId > 0 && !seenNoteIds.has(resolvedNoteId)) {
    seenNoteIds.add(resolvedNoteId);
    const duplicateRelationship = selectDuplicateRelationship.get(
      DUPLICATE_OF_RELATIONSHIP_TYPE,
      resolvedNoteId
    );
    const nextNoteId = Number(duplicateRelationship?.related_note_id);

    if (!nextNoteId || nextNoteId === resolvedNoteId) {
      break;
    }

    resolvedNoteId = nextNoteId;
  }

  return selectNote.get(resolvedNoteId) ?? selectNote.get(noteId) ?? null;
}

function selectCanonicalDuplicateRelationships(db, detectedDuplicateCandidates) {
  if (!Array.isArray(detectedDuplicateCandidates) || detectedDuplicateCandidates.length === 0) {
    return [];
  }

  const selectedCandidatesByNoteIndex = new Map();

  for (const candidate of detectedDuplicateCandidates) {
    const newNoteIndex = Number(candidate?.newNoteIndex);
    const existingNoteId = Number(candidate?.existingNoteId ?? candidate?.relatedNoteId);

    if (!Number.isInteger(newNoteIndex) || newNoteIndex < 0 || existingNoteId <= 0) {
      continue;
    }

    const selectedCandidate = selectedCandidatesByNoteIndex.get(newNoteIndex);

    if (
      !selectedCandidate ||
      compareDuplicateRelationshipCandidates(candidate, selectedCandidate) < 0
    ) {
      selectedCandidatesByNoteIndex.set(newNoteIndex, candidate);
    }
  }

  return Array.from(selectedCandidatesByNoteIndex.values()).flatMap((candidate) => {
    const canonicalNote = resolveCanonicalDuplicateNote(
      db,
      candidate.existingNoteId ?? candidate.relatedNoteId
    );

    if (!canonicalNote) {
      return [];
    }

    return [
      {
        newNoteIndex: candidate.newNoteIndex,
        newNoteType: candidate.newNoteType,
        newNoteTitle: candidate.newNoteTitle,
        existingNoteId: canonicalNote.id,
        existingEmailId: canonicalNote.email_id,
        existingNoteType: canonicalNote.taxonomy_key,
        existingNoteTitle: canonicalNote.title,
        relationshipType: DUPLICATE_OF_RELATIONSHIP_TYPE,
        overlapBasis: "keyword",
        matchedValues: buildOrderedUniqueKeywords(
          candidate.sharedTerms ??
            candidate.justificationTerms ??
            candidate.matchedValues ??
            candidate.matched_values ??
            candidate.sharedBodyTokens ??
            candidate.sharedTitleTokens ??
            [candidate.matchedValue ?? candidate.matched_value]
        ),
        similarityScore:
          typeof candidate.similarityScore === "number" ? candidate.similarityScore : candidate.score,
        score:
          typeof candidate.similarityScore === "number" ? candidate.similarityScore : candidate.score,
        duplicateKind: trimToNull(candidate.duplicateKind),
        matchedRules: Array.isArray(candidate.matchedRules)
          ? Array.from(
              new Set(
                candidate.matchedRules
                  .filter((rule) => typeof rule === "string")
                  .map((rule) => rule.trim())
                  .filter(Boolean)
              )
            )
          : [],
        similarity: getObject(candidate.similarity) ?? null,
      },
    ];
  });
}

function derivePersistedTopics(note) {
  return buildOrderedUniqueKeywords(Array.isArray(note.topics) ? note.topics : []);
}

function derivePersistedKeywords(note) {
  return buildOrderedUniqueKeywords(Array.isArray(note.keywords) ? note.keywords : []);
}

function derivePersistedKeywordsFromText(note) {
  const sourceText = [
    note.title,
    note.content,
    note.body,
    note.summary,
    note.sourceExcerpt,
    note.source_excerpt,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();

  const tokens = sourceText.split(/[^a-z0-9]+/g).filter((token) => token.length >= 3);
  return buildOrderedUniqueKeywords(tokens);
}

function insertNoteKeywords(db, noteId, note) {
  const topicKeywords = derivePersistedTopics(note);
  const explicitKeywords = derivePersistedKeywords(note);
  const derivedKeywords = derivePersistedKeywordsFromText(note);

  if (topicKeywords.length === 0 && explicitKeywords.length === 0 && derivedKeywords.length === 0) {
    return;
  }

  const upsertKeyword = db.prepare(`
    INSERT INTO keywords (keyword, normalized_keyword)
    VALUES (?, ?)
    ON CONFLICT(normalized_keyword) DO UPDATE SET
      keyword = excluded.keyword
  `);
  const selectKeywordId = db.prepare(`
    SELECT id
    FROM keywords
    WHERE normalized_keyword = ?
  `);
  const insertNoteKeyword = db.prepare(`
    INSERT INTO note_keywords (note_id, keyword_id, source)
    VALUES (?, ?, ?)
    ON CONFLICT(note_id, keyword_id) DO NOTHING
  `);
  const persistKeywords = (keywords, source) => {
    for (const keyword of keywords) {
      upsertKeyword.run(keyword, keyword);
      const keywordId = Number(selectKeywordId.get(keyword)?.id);

      if (keywordId > 0) {
        insertNoteKeyword.run(noteId, keywordId, source);
      }
    }
  };

  persistKeywords(topicKeywords, "topic");
  persistKeywords(explicitKeywords, "llm");
  persistKeywords(derivedKeywords, "derived");
}

function detectRelationshipsWithinNoteBatch(notes) {
  if (!Array.isArray(notes) || notes.length < 2) {
    return [];
  }

  const relationships = [];

  for (let leftIndex = 0; leftIndex < notes.length - 1; leftIndex += 1) {
    const leftNote = notes[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < notes.length; rightIndex += 1) {
      const rightNote = notes[rightIndex];
      const comparison = compareNotesByKeywords(leftNote, rightNote);

      if (!comparison.isRelated) {
        continue;
      }

      const relationshipBase = {
        newNoteIndex: leftIndex,
        newNoteType: leftNote?.type,
        newNoteTitle: leftNote?.title,
        relatedNoteIndex: rightIndex,
        relatedNoteType: rightNote?.type,
        relatedNoteTitle: rightNote?.title,
        score: comparison.score,
      };

      if (comparison.sharedTopics.length > 0) {
        relationships.push({
          ...relationshipBase,
          overlapBasis: "topic",
          matchedValues: comparison.sharedTopics,
        });
      }

      if (comparison.sharedKeywords.length > 0) {
        relationships.push({
          ...relationshipBase,
          overlapBasis: "keyword",
          matchedValues: comparison.sharedKeywords,
        });
      }
    }
  }

  return relationships;
}

function collectRelationshipMatchedValues(relationship, overlapBasis) {
  const values = [];
  const pushValues = (candidate) => {
    if (Array.isArray(candidate)) {
      values.push(...candidate);
      return;
    }

    if (candidate !== undefined && candidate !== null) {
      values.push(candidate);
    }
  };

  pushValues(relationship.matchedValues);
  pushValues(relationship.matched_values);

  if (overlapBasis === "topic" || overlapBasis === "both") {
    pushValues(relationship.sharedTopics);
    pushValues(relationship.shared_topics);
  }

  if (overlapBasis === "keyword" || overlapBasis === "both") {
    pushValues(relationship.sharedKeywords);
    pushValues(relationship.shared_keywords);
    pushValues(relationship.sharedTerms);
    pushValues(relationship.shared_terms);
    pushValues(relationship.justificationTerms);
    pushValues(relationship.justification_terms);
  }

  pushValues(relationship.matchedValue);
  pushValues(relationship.matched_value);

  return buildOrderedUniqueKeywords(values);
}

function insertDetectedRelationships(db, insertedNoteIds, detectedRelationships) {
  if (!Array.isArray(detectedRelationships) || detectedRelationships.length === 0) {
    return;
  }

  const selectNoteEmailId = db.prepare(`
    SELECT email_id
    FROM notes
    WHERE id = ?
  `);
  const upsertRelationship = db.prepare(`
    INSERT INTO relationships (
      note_id,
      related_note_id,
      relationship_type,
      strength,
      overlap_basis,
      matched_value,
      matched_terms_json,
      overlap_source_metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(note_id, related_note_id, relationship_type, overlap_basis, matched_value) DO UPDATE SET
      strength = excluded.strength,
      matched_terms_json = excluded.matched_terms_json,
      overlap_source_metadata_json = excluded.overlap_source_metadata_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  const selectDuplicateRelationship = db.prepare(`
    SELECT
      id,
      strength,
      overlap_basis,
      matched_value,
      matched_terms_json,
      overlap_source_metadata_json
    FROM relationships
    WHERE note_id = ?
      AND related_note_id = ?
      AND relationship_type = ?
    ORDER BY strength DESC, id ASC
    LIMIT 1
  `);
  const insertDuplicateRelationship = db.prepare(`
    INSERT INTO relationships (
      note_id,
      related_note_id,
      relationship_type,
      strength,
      overlap_basis,
      matched_value,
      matched_terms_json,
      overlap_source_metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDuplicateRelationship = db.prepare(`
    UPDATE relationships
    SET
      strength = ?,
      overlap_basis = ?,
      matched_value = ?,
      matched_terms_json = ?,
      overlap_source_metadata_json = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const seenPairs = new Set();
  const pendingDuplicateRelationships = new Map();
  const noteEmailIdsByNoteId = new Map();

  const getNoteEmailId = (noteId) => {
    if (!noteEmailIdsByNoteId.has(noteId)) {
      noteEmailIdsByNoteId.set(noteId, Number(selectNoteEmailId.get(noteId)?.email_id));
    }

    return noteEmailIdsByNoteId.get(noteId);
  };

  for (const relationship of detectedRelationships) {
    const noteId = Number(insertedNoteIds[relationship.newNoteIndex]);
    const unresolvedRelatedNoteId = Number(
      relationship.existingNoteId ??
        relationship.relatedNoteId ??
        insertedNoteIds[relationship.relatedNoteIndex]
    );

    if (!noteId || !unresolvedRelatedNoteId || noteId === unresolvedRelatedNoteId) {
      continue;
    }

    const explicitOverlapBasis = normalizeRelationshipOverlapBasis(
      relationship.overlapBasis ??
        relationship.overlap_basis ??
        relationship.overlapSource ??
        relationship.overlap_source
    );
    const relationshipMatches = [];

    if (explicitOverlapBasis) {
      relationshipMatches.push({
        overlapBasis: explicitOverlapBasis,
        matchedValues: collectRelationshipMatchedValues(relationship, explicitOverlapBasis),
      });
    } else {
      const topicMatches = buildOrderedUniqueKeywords(
        relationship.sharedTopics ?? relationship.shared_topics ?? []
      );
      const keywordMatches = buildOrderedUniqueKeywords(
        relationship.sharedKeywords ??
          relationship.shared_keywords ??
          relationship.sharedTerms ??
          relationship.shared_terms ??
          relationship.justificationTerms ??
          relationship.justification_terms ??
          []
      );

      if (topicMatches.length > 0) {
        relationshipMatches.push({
          overlapBasis: "topic",
          matchedValues: topicMatches,
        });
      }

      if (keywordMatches.length > 0) {
        relationshipMatches.push({
          overlapBasis: "keyword",
          matchedValues: keywordMatches,
        });
      }

      if (relationshipMatches.length === 0) {
        relationshipMatches.push({
          overlapBasis: "keyword",
          matchedValues: buildOrderedUniqueKeywords(
            relationship.matchedValues ??
              relationship.matched_values ??
              [relationship.matchedValue ?? relationship.matched_value]
          ),
        });
      }
    }

    for (const { overlapBasis, matchedValues } of relationshipMatches) {
      if (matchedValues.length === 0) {
        continue;
      }

      const relationshipType = buildPersistedRelationshipType(
        relationship.relationshipType ?? relationship.relationship_type,
        overlapBasis
      );
      const noteEmailId = getNoteEmailId(noteId);
      const providedRelatedEmailId = Number(
        relationship.existingEmailId ?? relationship.relatedEmailId
      );

      if (
        relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE &&
        Number.isInteger(noteEmailId) &&
        Number.isInteger(providedRelatedEmailId) &&
        providedRelatedEmailId === noteEmailId
      ) {
        continue;
      }

      const canonicalRelatedNote =
        relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE
          ? resolveCanonicalDuplicateNote(db, unresolvedRelatedNoteId)
          : null;
      const relatedNoteId = Number(canonicalRelatedNote?.id ?? unresolvedRelatedNoteId);
      const relatedNoteEmailId = Number(
        canonicalRelatedNote?.email_id ??
          relationship.existingEmailId ??
          relationship.relatedEmailId ??
          getNoteEmailId(relatedNoteId)
      );
      const persistedNoteId =
        relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE
          ? noteId
          : Math.min(noteId, relatedNoteId);
      const persistedRelatedNoteId =
        relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE
          ? relatedNoteId
          : Math.max(noteId, relatedNoteId);

      if (
        relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE &&
        Number.isInteger(relatedNoteEmailId) &&
        relatedNoteEmailId === noteEmailId
      ) {
        continue;
      }

      if (relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE) {
        const pairKey = buildDuplicateRelationshipPairKey(
          persistedNoteId,
          persistedRelatedNoteId
        );
        const metadata = {
          matchedBy: buildRelationshipMetadataLabel(relationshipType, overlapBasis),
          newNoteIndex: relationship.newNoteIndex,
          newNoteType: normalizeTaxonomyKey(relationship.newNoteType),
          newNoteTitle: trimToNull(relationship.newNoteTitle),
          existingEmailId:
            canonicalRelatedNote?.email_id ??
            relationship.existingEmailId ??
            relationship.relatedEmailId ??
            null,
          existingNoteType: normalizeTaxonomyKey(
            canonicalRelatedNote?.taxonomy_key ??
              relationship.existingNoteType ??
              relationship.relatedNoteType
          ),
          existingNoteTitle: trimToNull(
            canonicalRelatedNote?.title ??
              relationship.existingNoteTitle ??
              relationship.relatedNoteTitle
          ),
          duplicateKind: trimToNull(relationship.duplicateKind),
          matchedRules: normalizeDuplicateRelationshipMatchedRules(relationship.matchedRules),
          similarityScore:
            typeof relationship.similarityScore === "number"
              ? relationship.similarityScore
              : typeof relationship.score === "number"
                ? relationship.score
                : undefined,
          similarity: getObject(relationship.similarity) ?? undefined,
          canonicalNoteId: relatedNoteId,
          matchedTerms: matchedValues,
        };
        const existingDuplicateRelationship = pendingDuplicateRelationships.get(pairKey);

        if (existingDuplicateRelationship) {
          const mergedMatchedTerms = buildOrderedUniqueKeywords([
            ...existingDuplicateRelationship.matchedTerms,
            ...matchedValues,
          ]);

          existingDuplicateRelationship.matchedTerms = mergedMatchedTerms;
          existingDuplicateRelationship.overlapBasis =
            mergeRelationshipOverlapBases(
              existingDuplicateRelationship.overlapBasis,
              overlapBasis
            ) ?? existingDuplicateRelationship.overlapBasis;
          existingDuplicateRelationship.strength = Math.max(
            existingDuplicateRelationship.strength,
            resolveRelationshipStrength(relationship, matchedValues.length)
          );
          existingDuplicateRelationship.preferredMatchedValue =
            buildDuplicateRelationshipMatchedValue(
              existingDuplicateRelationship.preferredMatchedValue,
              relationship.matchedValue,
              relationship.matched_value,
              mergedMatchedTerms
            );
          existingDuplicateRelationship.metadata = mergeDuplicateRelationshipMetadata(
            existingDuplicateRelationship.metadata,
            metadata,
            mergedMatchedTerms
          );
        } else {
          pendingDuplicateRelationships.set(pairKey, {
            noteId: persistedNoteId,
            relatedNoteId: persistedRelatedNoteId,
            strength: resolveRelationshipStrength(relationship, matchedValues.length),
            overlapBasis,
            preferredMatchedValue: buildDuplicateRelationshipMatchedValue(
              relationship.matchedValue,
              relationship.matched_value,
              matchedValues
            ),
            matchedTerms: matchedValues,
            metadata,
          });
        }

        continue;
      }

      for (const matchedValue of matchedValues) {
        const pairKey = [
          persistedNoteId,
          persistedRelatedNoteId,
          relationshipType,
          overlapBasis,
          matchedValue,
        ].join(":");

        if (seenPairs.has(pairKey)) {
          continue;
        }

        seenPairs.add(pairKey);

        upsertRelationship.run(
          persistedNoteId,
          persistedRelatedNoteId,
          relationshipType,
          typeof relationship.score === "number" ? relationship.score : matchedValues.length,
          overlapBasis,
          matchedValue,
          JSON.stringify(matchedValues),
          JSON.stringify({
            matchedBy: buildRelationshipMetadataLabel(relationshipType, overlapBasis),
            newNoteIndex: relationship.newNoteIndex,
            newNoteType: normalizeTaxonomyKey(relationship.newNoteType),
            newNoteTitle: trimToNull(relationship.newNoteTitle),
            existingEmailId:
              canonicalRelatedNote?.email_id ??
              relationship.existingEmailId ??
              relationship.relatedEmailId ??
              null,
            existingNoteType: normalizeTaxonomyKey(
              canonicalRelatedNote?.taxonomy_key ??
                relationship.existingNoteType ??
                relationship.relatedNoteType
            ),
            existingNoteTitle: trimToNull(
              canonicalRelatedNote?.title ??
                relationship.existingNoteTitle ??
                relationship.relatedNoteTitle
            ),
            duplicateKind:
              relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE
                ? trimToNull(relationship.duplicateKind)
                : undefined,
            matchedRules:
              relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE &&
              Array.isArray(relationship.matchedRules)
                ? relationship.matchedRules.filter(
                    (rule) => typeof rule === "string" && rule.trim().length > 0
                  )
                : undefined,
            similarityScore:
              relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE &&
              typeof relationship.similarityScore === "number"
                ? relationship.similarityScore
                : undefined,
            similarity:
              relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE
                ? getObject(relationship.similarity)
                : undefined,
            canonicalNoteId:
              relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE ? relatedNoteId : undefined,
            matchedTerms:
              relationshipType === DUPLICATE_OF_RELATIONSHIP_TYPE ? matchedValues : undefined,
          })
        );
      }
    }
  }

  for (const relationship of pendingDuplicateRelationships.values()) {
    const existingRelationship = selectDuplicateRelationship.get(
      relationship.noteId,
      relationship.relatedNoteId,
      DUPLICATE_OF_RELATIONSHIP_TYPE
    );
    const existingMetadata = parseJsonObject(existingRelationship?.overlap_source_metadata_json);
    const existingMatchedTerms = existingRelationship
      ? buildRelationshipOverlapTerms(
          {
            relationship_type: DUPLICATE_OF_RELATIONSHIP_TYPE,
            matched_terms_json: existingRelationship.matched_terms_json,
            matched_value: existingRelationship.matched_value,
          },
          existingMetadata
        )
      : [];
    const mergedMatchedTerms = buildOrderedUniqueKeywords([
      ...existingMatchedTerms,
      ...relationship.matchedTerms,
    ]);
    const mergedMetadata = mergeDuplicateRelationshipMetadata(
      existingMetadata,
      relationship.metadata,
      mergedMatchedTerms
    );
    const matchedValue = buildDuplicateRelationshipMatchedValue(
      relationship.preferredMatchedValue,
      existingRelationship?.matched_value,
      mergedMatchedTerms
    );
    const strength = Math.max(
      relationship.strength,
      typeof existingRelationship?.strength === "number" ? existingRelationship.strength : 0
    );

    if (existingRelationship) {
      updateDuplicateRelationship.run(
        strength,
        mergeRelationshipOverlapBases(
          existingRelationship.overlap_basis,
          relationship.overlapBasis
        ) ?? relationship.overlapBasis,
        matchedValue,
        JSON.stringify(mergedMatchedTerms),
        JSON.stringify(mergedMetadata),
        existingRelationship.id
      );
      continue;
    }

    insertDuplicateRelationship.run(
      relationship.noteId,
      relationship.relatedNoteId,
      DUPLICATE_OF_RELATIONSHIP_TYPE,
      strength,
      relationship.overlapBasis,
      matchedValue,
      JSON.stringify(mergedMatchedTerms),
      JSON.stringify(mergedMetadata)
    );
  }
}

export { getRawEmailById, getRawEmailByMessageId, insertRawEmail };

export function storeAgentMailWebhookDelivery(
  db,
  { deliveryId = null, eventType = null, rawPayload, payload, receipt = null }
) {
  const normalizedDelivery = normalizeAgentMailWebhookDelivery({
    deliveryId,
    eventType,
    rawPayload,
    payload,
    receipt,
  });
  const normalizedEventType = normalizedDelivery.event_type;
  const insertDeliveryWithId = db.prepare(`
    INSERT INTO webhook_deliveries (
      delivery_id,
      event_id,
      event_type,
      webhook_path,
      content_type,
      body_bytes,
      payload_sha256,
      headers_json,
      svix_signature,
      svix_timestamp,
      user_agent,
      source_ip,
      payload,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
    ON CONFLICT(delivery_id) DO UPDATE SET
      event_id = excluded.event_id,
      event_type = excluded.event_type,
      webhook_path = excluded.webhook_path,
      content_type = excluded.content_type,
      body_bytes = excluded.body_bytes,
      payload_sha256 = excluded.payload_sha256,
      headers_json = excluded.headers_json,
      svix_signature = excluded.svix_signature,
      svix_timestamp = excluded.svix_timestamp,
      user_agent = excluded.user_agent,
      source_ip = excluded.source_ip,
      payload = excluded.payload,
      status = 'received',
      received_at = CURRENT_TIMESTAMP,
      processed_at = NULL,
      error_message = NULL
  `);
  const selectDeliveryById = db.prepare(`
    SELECT id
    FROM webhook_deliveries
    WHERE delivery_id = ?
  `);
  const insertDeliveryWithoutId = db.prepare(`
    INSERT INTO webhook_deliveries (
      event_id,
      event_type,
      webhook_path,
      content_type,
      body_bytes,
      payload_sha256,
      headers_json,
      svix_signature,
      svix_timestamp,
      user_agent,
      source_ip,
      payload,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
  `);
  const upsertEmail = db.prepare(`
    INSERT INTO emails (
      webhook_delivery_id,
      agentmail_message_id,
      agentmail_inbox_id,
      message_id_header,
      subject,
      from_name,
      from_address,
      sender_address,
      source_id,
      sent_at,
      received_at,
      text_content,
      html_content,
      raw_payload,
      ingestion_status,
      relevance_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 'pending')
    ON CONFLICT(agentmail_message_id) DO UPDATE SET
      webhook_delivery_id = excluded.webhook_delivery_id,
      agentmail_inbox_id = excluded.agentmail_inbox_id,
      message_id_header = excluded.message_id_header,
      subject = excluded.subject,
      from_name = excluded.from_name,
      from_address = excluded.from_address,
      sender_address = excluded.sender_address,
      source_id = COALESCE(excluded.source_id, emails.source_id),
      sent_at = excluded.sent_at,
      received_at = excluded.received_at,
      text_content = excluded.text_content,
      html_content = excluded.html_content,
      raw_payload = excluded.raw_payload,
      ingestion_status = 'received',
      relevance_status = 'pending',
      updated_at = CURRENT_TIMESTAMP
  `);
  const selectEmailByMessageId = db.prepare(`
    SELECT
      id,
      source_id,
      from_address,
      sender_address
    FROM emails
    WHERE agentmail_message_id = ?
  `);
  const upsertSource = db.prepare(`
    INSERT INTO sources (
      sender_address,
      display_name,
      email_count,
      first_seen_at,
      last_seen_at
    )
    VALUES (?, ?, ?, datetime(?), datetime(?))
    ON CONFLICT(sender_address) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, sources.display_name),
      email_count = sources.email_count + ?,
      first_seen_at = CASE
        WHEN sources.first_seen_at IS NULL THEN excluded.first_seen_at
        WHEN excluded.first_seen_at IS NULL THEN sources.first_seen_at
        WHEN datetime(excluded.first_seen_at) < datetime(sources.first_seen_at)
          THEN excluded.first_seen_at
        ELSE sources.first_seen_at
      END,
      last_seen_at = CASE
        WHEN sources.last_seen_at IS NULL THEN excluded.last_seen_at
        WHEN excluded.last_seen_at IS NULL THEN sources.last_seen_at
        WHEN datetime(excluded.last_seen_at) > datetime(sources.last_seen_at)
          THEN excluded.last_seen_at
        ELSE sources.last_seen_at
      END,
      updated_at = CURRENT_TIMESTAMP
  `);
  const selectSourceBySenderAddress = db.prepare(`
    SELECT id
    FROM sources
    WHERE sender_address = ?
  `);
  const updateDelivery = db.prepare(`
    UPDATE webhook_deliveries
    SET status = ?,
        processed_at = CURRENT_TIMESTAMP,
        error_message = ?
    WHERE id = ?
  `);
  let transactionActive = false;
  db.exec("BEGIN IMMEDIATE");
  transactionActive = true;

  try {
    let webhookDeliveryId;

    if (normalizedDelivery.delivery_id) {
      insertDeliveryWithId.run(
        normalizedDelivery.delivery_id,
        normalizedDelivery.event_id,
        normalizedDelivery.event_type,
        normalizedDelivery.webhook_path,
        normalizedDelivery.content_type,
        normalizedDelivery.body_bytes,
        normalizedDelivery.payload_sha256,
        normalizedDelivery.headers_json,
        normalizedDelivery.svix_signature,
        normalizedDelivery.svix_timestamp,
        normalizedDelivery.user_agent,
        normalizedDelivery.source_ip,
        normalizedDelivery.payload
      );
      webhookDeliveryId = Number(selectDeliveryById.get(normalizedDelivery.delivery_id)?.id);
    } else {
      webhookDeliveryId = Number(
        insertDeliveryWithoutId.run(
          normalizedDelivery.event_id,
          normalizedDelivery.event_type,
          normalizedDelivery.webhook_path,
          normalizedDelivery.content_type,
          normalizedDelivery.body_bytes,
          normalizedDelivery.payload_sha256,
          normalizedDelivery.headers_json,
          normalizedDelivery.svix_signature,
          normalizedDelivery.svix_timestamp,
          normalizedDelivery.user_agent,
          normalizedDelivery.source_ip,
          normalizedDelivery.payload
        ).lastInsertRowid
      );
    }

    let emailId = null;
    let rawEmailId = null;
    let storedEmail = false;
    let status = "ignored";
    let processingError = null;
    let processingJobId = null;
    let jobStatus = null;

    if (normalizedEventType === "message.received") {
      try {
        const rawEmail = insertRawEmail(db, {
          deliveryId: normalizedDelivery.delivery_id,
          eventType: normalizedEventType,
          rawPayload: normalizedDelivery.payload,
          payload,
          webhookDeliveryId,
        });
        rawEmailId = Number(rawEmail?.id);
        const existingEmail = selectEmailByMessageId.get(rawEmail.agentmail_message_id) ?? null;
        const sourceRecord = buildEmailSourceRecord(rawEmail);
        let sourceId = Number(existingEmail?.source_id) || null;

        if (sourceRecord.senderAddress) {
          const existingSource = selectSourceBySenderAddress.get(sourceRecord.senderAddress) ?? null;
          const emailCountIncrement = existingEmail && existingSource ? 0 : 1;

          upsertSource.run(
            sourceRecord.senderAddress,
            sourceRecord.displayName,
            emailCountIncrement,
            sourceRecord.observedAt,
            sourceRecord.observedAt,
            emailCountIncrement
          );

          sourceId = Number(
            selectSourceBySenderAddress.get(sourceRecord.senderAddress)?.id
          ) || null;
        }

        upsertEmail.run(
          webhookDeliveryId,
          rawEmail.agentmail_message_id,
          rawEmail.agentmail_inbox_id,
          rawEmail.message_id_header,
          rawEmail.subject,
          rawEmail.from_name,
          rawEmail.from_address,
          rawEmail.sender_address,
          sourceId,
          rawEmail.sent_at,
          rawEmail.received_at,
          rawEmail.text_content,
          rawEmail.html_content,
          normalizedDelivery.payload
        );

        emailId = Number(selectEmailByMessageId.get(rawEmail.agentmail_message_id)?.id);
        storedEmail = true;
        status = "stored";

        const processingJob = queueEmailProcessingJob(db, {
          emailId,
          rawEmailId,
          webhookDeliveryId,
        });
        processingJobId = Number(processingJob?.id);
        jobStatus = trimToNull(processingJob?.status);
      } catch (error) {
        processingError = error;
        status = "failed";
      }
    }

    updateDelivery.run(status, processingError?.message ?? null, webhookDeliveryId);
    db.exec("COMMIT");
    transactionActive = false;

    if (processingError) {
      throw processingError;
    }

    return {
      webhookDeliveryId,
      rawEmailId,
      emailId,
      storedEmail,
      status,
      processingJobId,
      jobStatus,
    };
  } catch (error) {
    if (transactionActive) {
      db.exec("ROLLBACK");
    }

    throw error;
  }
}

export function getEmailProcessingJobById(db, processingJobId) {
  const rawEmailColumns = tableExists(db, "raw_emails")
    ? getTableColumnNames(db, "raw_emails")
    : new Set();
  const rawEmailMessageIdSelect = rawEmailColumns.has("agentmail_message_id")
    ? "raw_emails.agentmail_message_id AS raw_email_agentmail_message_id"
    : "NULL AS raw_email_agentmail_message_id";
  const rawEmailPayloadSelect = rawEmailColumns.has("raw_payload")
    ? "raw_emails.raw_payload AS raw_email_payload"
    : "NULL AS raw_email_payload";

  return (
    db
      .prepare(`
        SELECT
          email_processing_jobs.id,
          email_processing_jobs.email_id,
          email_processing_jobs.raw_email_id,
          email_processing_jobs.webhook_delivery_id,
          email_processing_jobs.status,
          email_processing_jobs.attempts,
          email_processing_jobs.error_message,
          email_processing_jobs.created_at,
          email_processing_jobs.started_at,
          email_processing_jobs.completed_at,
          email_processing_jobs.failed_at,
          email_processing_jobs.updated_at,
          ${rawEmailMessageIdSelect},
          ${rawEmailPayloadSelect}
        FROM email_processing_jobs
        LEFT JOIN raw_emails
          ON raw_emails.id = email_processing_jobs.raw_email_id
        WHERE email_processing_jobs.id = ?
      `)
      .get(processingJobId) ?? null
  );
}

export function getEmailProcessingJobByEmailId(db, emailId) {
  const rawEmailColumns = tableExists(db, "raw_emails")
    ? getTableColumnNames(db, "raw_emails")
    : new Set();
  const rawEmailMessageIdSelect = rawEmailColumns.has("agentmail_message_id")
    ? "raw_emails.agentmail_message_id AS raw_email_agentmail_message_id"
    : "NULL AS raw_email_agentmail_message_id";
  const rawEmailPayloadSelect = rawEmailColumns.has("raw_payload")
    ? "raw_emails.raw_payload AS raw_email_payload"
    : "NULL AS raw_email_payload";

  return (
    db
      .prepare(`
        SELECT
          email_processing_jobs.id,
          email_processing_jobs.email_id,
          email_processing_jobs.raw_email_id,
          email_processing_jobs.webhook_delivery_id,
          email_processing_jobs.status,
          email_processing_jobs.attempts,
          email_processing_jobs.error_message,
          email_processing_jobs.created_at,
          email_processing_jobs.started_at,
          email_processing_jobs.completed_at,
          email_processing_jobs.failed_at,
          email_processing_jobs.updated_at,
          ${rawEmailMessageIdSelect},
          ${rawEmailPayloadSelect}
        FROM email_processing_jobs
        LEFT JOIN raw_emails
          ON raw_emails.id = email_processing_jobs.raw_email_id
        WHERE email_processing_jobs.email_id = ?
      `)
      .get(emailId) ?? null
  );
}

export function claimNextEmailProcessingJob(db) {
  const selectQueuedJob = db.prepare(`
    SELECT id
    FROM email_processing_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `);

  db.exec("BEGIN IMMEDIATE");

  try {
    const queuedJob = selectQueuedJob.get();

    if (!queuedJob) {
      db.exec("COMMIT");
      return null;
    }

    updateEmailProcessingJobState(db, queuedJob.id, { status: "processing" });
    const claimedJob = getEmailProcessingJobById(db, queuedJob.id);
    db.exec("COMMIT");

    return claimedJob;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function queueEmailProcessingJob(
  db,
  { emailId, rawEmailId = null, webhookDeliveryId = null }
) {
  db.prepare(`
    INSERT INTO email_processing_jobs (
      email_id,
      raw_email_id,
      webhook_delivery_id,
      status,
      attempts,
      error_message,
      started_at,
      completed_at,
      failed_at
    )
    VALUES (
      ?,
      COALESCE(
        ?,
        (
          SELECT raw_emails.id
          FROM emails
          INNER JOIN raw_emails
            ON raw_emails.agentmail_message_id = emails.agentmail_message_id
          WHERE emails.id = ?
          LIMIT 1
        )
      ),
      ?,
      'queued',
      0,
      NULL,
      NULL,
      NULL,
      NULL
    )
    ON CONFLICT(email_id) DO UPDATE SET
      raw_email_id = COALESCE(excluded.raw_email_id, email_processing_jobs.raw_email_id),
      webhook_delivery_id = COALESCE(excluded.webhook_delivery_id, email_processing_jobs.webhook_delivery_id),
      status = 'queued',
      error_message = NULL,
      started_at = NULL,
      completed_at = NULL,
      failed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).run(emailId, Number.isInteger(rawEmailId) ? rawEmailId : null, emailId, webhookDeliveryId);

  const job = getEmailProcessingJobByEmailId(db, emailId);

  if (job) {
    recordEmailProcessingEvent(db, {
      emailId,
      processingJobId: job.id,
      webhookDeliveryId: webhookDeliveryId ?? job.webhook_delivery_id ?? null,
      eventType: "queued",
      jobStatus: job.status,
      metadata: {
        trigger: "webhook_delivery",
      },
    });
  }

  return job;
}

export function getEmailById(db, emailId) {
  return (
    db
      .prepare(`
        SELECT
          id,
          agentmail_message_id,
          agentmail_inbox_id,
          message_id_header,
          subject,
          from_name,
          from_address,
          sender_address,
          source_id,
          sent_at,
          received_at,
          text_content,
          html_content,
          raw_payload,
          ingestion_status,
          relevance_status,
          processing_error,
          created_at,
          updated_at
        FROM emails
        WHERE id = ?
      `)
      .get(emailId) ?? null
  );
}

export function updateEmailRelevanceStatus(db, emailId, relevanceStatus) {
  const normalizedRelevanceStatus = trimToNull(relevanceStatus) ?? "pending";

  db.prepare(`
    UPDATE emails
    SET relevance_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(normalizedRelevanceStatus, emailId);
}

export function updateEmailProcessingState(
  db,
  emailId,
  { status, processingError = null, relevanceStatus = null }
) {
  db.prepare(`
    UPDATE emails
    SET ingestion_status = ?,
        processing_error = ?,
        relevance_status = COALESCE(?, relevance_status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, trimToNull(processingError), trimToNull(relevanceStatus), emailId);
}

export function updateEmailProcessingJobState(
  db,
  processingJobId,
  { status, errorMessage = null }
) {
  const normalizedErrorMessage = trimToNull(errorMessage);

  if (status === "queued") {
    db.prepare(`
      UPDATE email_processing_jobs
      SET status = ?,
          error_message = NULL,
          started_at = NULL,
          completed_at = NULL,
          failed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, processingJobId);
    recordJobStatusTransitionEvent(db, processingJobId, {
      eventType: "requeued",
      jobStatus: status,
      errorMessage: null,
    });
    return;
  }

  if (status === "processing") {
    db.prepare(`
      UPDATE email_processing_jobs
      SET status = ?,
          attempts = attempts + 1,
          error_message = NULL,
          started_at = CURRENT_TIMESTAMP,
          completed_at = NULL,
          failed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, processingJobId);
    recordJobStatusTransitionEvent(db, processingJobId, {
      eventType: "processing_started",
      jobStatus: status,
      errorMessage: null,
    });
    return;
  }

  if (status === "completed") {
    db.prepare(`
      UPDATE email_processing_jobs
      SET status = ?,
          error_message = NULL,
          completed_at = CURRENT_TIMESTAMP,
          failed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, processingJobId);
    recordJobStatusTransitionEvent(db, processingJobId, {
      eventType: "processing_completed",
      jobStatus: status,
      errorMessage: null,
    });
    return;
  }

  if (status === "failed") {
    db.prepare(`
      UPDATE email_processing_jobs
      SET status = ?,
          error_message = ?,
          failed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, normalizedErrorMessage, processingJobId);
    recordJobStatusTransitionEvent(db, processingJobId, {
      eventType: "processing_failed",
      jobStatus: status,
      errorMessage: normalizedErrorMessage,
    });
    return;
  }

  throw new Error(`Unsupported email processing job status "${status}"`);
}

export function retryEmailProcessingJob(db, processingJobId) {
  if (!Number.isInteger(processingJobId) || processingJobId <= 0) {
    throw new Error("retryEmailProcessingJob requires a positive integer processingJobId");
  }

  const existingJob = getEmailProcessingJobById(db, processingJobId);

  if (!existingJob) {
    return null;
  }

  updateEmailProcessingJobState(db, processingJobId, {
    status: "queued",
    errorMessage: null,
  });

  return getEmailProcessingJobById(db, processingJobId);
}

export function listEmailProcessingJobs(db) {
  return db
    .prepare(`
      SELECT
        email_processing_jobs.id,
        email_processing_jobs.email_id,
        email_processing_jobs.raw_email_id,
        email_processing_jobs.webhook_delivery_id,
        email_processing_jobs.status,
        email_processing_jobs.attempts,
        email_processing_jobs.error_message,
        email_processing_jobs.created_at,
        email_processing_jobs.started_at,
        email_processing_jobs.completed_at,
        email_processing_jobs.failed_at,
        email_processing_jobs.updated_at,
        raw_emails.agentmail_message_id AS raw_email_agentmail_message_id,
        raw_emails.raw_payload AS raw_email_payload
      FROM email_processing_jobs
      LEFT JOIN raw_emails
        ON raw_emails.id = email_processing_jobs.raw_email_id
      ORDER BY email_processing_jobs.created_at ASC, email_processing_jobs.id ASC
    `)
    .all();
}

export function recordEmailProcessingEvent(
  db,
  {
    emailId,
    processingJobId = null,
    webhookDeliveryId = null,
    eventType,
    jobStatus = null,
    errorMessage = null,
    metadata = null,
  }
) {
  const normalizedEventType = trimToNull(eventType);

  if (!Number.isInteger(emailId) || emailId <= 0) {
    throw new Error("recordEmailProcessingEvent requires a positive integer emailId");
  }

  if (!normalizedEventType) {
    throw new Error("recordEmailProcessingEvent requires an eventType");
  }

  const serializedMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? JSON.stringify(metadata)
      : "{}";

  db.prepare(`
    INSERT INTO email_processing_events (
      email_id,
      processing_job_id,
      webhook_delivery_id,
      event_type,
      job_status,
      error_message,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    emailId,
    Number.isInteger(processingJobId) ? processingJobId : null,
    Number.isInteger(webhookDeliveryId) ? webhookDeliveryId : null,
    normalizedEventType,
    trimToNull(jobStatus),
    trimToNull(errorMessage),
    serializedMetadata
  );
}

function recordJobStatusTransitionEvent(
  db,
  processingJobId,
  { eventType, jobStatus, errorMessage = null }
) {
  const job = getEmailProcessingJobById(db, processingJobId);

  if (!job) {
    return;
  }

  recordEmailProcessingEvent(db, {
    emailId: job.email_id,
    processingJobId: job.id,
    webhookDeliveryId: job.webhook_delivery_id,
    eventType,
    jobStatus,
    errorMessage,
  });
}

export function listEmailProcessingEvents(
  db,
  { emailId = null, processingJobId = null } = {}
) {
  const filters = [];
  const values = [];

  if (Number.isInteger(emailId) && emailId > 0) {
    filters.push("email_id = ?");
    values.push(emailId);
  }

  if (Number.isInteger(processingJobId) && processingJobId > 0) {
    filters.push("processing_job_id = ?");
    values.push(processingJobId);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  return db
    .prepare(`
      SELECT
        id,
        email_id,
        processing_job_id,
        webhook_delivery_id,
        event_type,
        job_status,
        error_message,
        metadata_json,
        created_at
      FROM email_processing_events
      ${whereClause}
      ORDER BY created_at ASC, id ASC
    `)
    .all(...values)
    .map((row) => ({
      id: row.id,
      email_id: row.email_id,
      processing_job_id: row.processing_job_id,
      webhook_delivery_id: row.webhook_delivery_id,
      event_type: row.event_type,
      job_status: row.job_status,
      error_message: row.error_message,
      metadata: parseJsonObject(row.metadata_json),
      created_at: row.created_at,
    }));
}

export function listSources(db) {
  const rows = db
    .prepare(`
      SELECT
        sender_address,
        email_count,
        last_seen_at
      FROM sources
      ORDER BY
        CASE
          WHEN last_seen_at IS NULL THEN 1
          ELSE 0
        END ASC,
        datetime(last_seen_at) DESC,
        sender_address ASC
    `)
    .all();

  return rows.map((row) => ({
    sender_address: row.sender_address,
    email_count: Number(row.email_count),
    last_seen_at: normalizePersistedSourceTimestamp(row.last_seen_at),
  }));
}

export function getEmailIngestionSummary(db) {
  const row =
    db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN ingestion_status = 'processed' THEN 1 ELSE 0 END), 0)
            AS processed_email_count,
          COALESCE(SUM(CASE WHEN ingestion_status = 'skipped' THEN 1 ELSE 0 END), 0)
            AS skipped_email_count
        FROM emails
      `)
      .get() ?? {};

  const processedEmailCount = Number(row.processed_email_count ?? 0);
  const skippedEmailCount = Number(row.skipped_email_count ?? 0);

  return {
    processed_email_count: processedEmailCount,
    skipped_email_count: skippedEmailCount,
    total_classified_email_count: processedEmailCount + skippedEmailCount,
  };
}

export function listTaxonomyTypeCounts(db) {
  const rows = db
    .prepare(`
      SELECT
        taxonomy_types.key AS taxonomy_key,
        taxonomy_types.label AS label,
        COUNT(notes.id) AS note_count
      FROM taxonomy_types
      LEFT JOIN notes
        ON notes.taxonomy_key = taxonomy_types.key
      GROUP BY taxonomy_types.key, taxonomy_types.label
    `)
    .all();

  const rowsByKey = new Map(rows.map((row) => [row.taxonomy_key, row]));

  return TAXONOMY_TYPES.map((taxonomyType) => {
    const row = rowsByKey.get(taxonomyType.key);

    return {
      taxonomy_key: taxonomyType.key,
      label: row?.label ?? taxonomyType.label,
      note_count: Number(row?.note_count ?? 0),
    };
  });
}

function clipText(value, maxLength) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  if (!Number.isInteger(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeDigestSummaryFragment(note) {
  const candidate = pickFirstString(note?.summary, note?.title, note?.body);
  return candidate ? candidate.replace(/\s+/g, " ").trim() : null;
}

function buildDigestSummary(notes, options = {}) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return null;
  }

  const maxFragments =
    Number.isInteger(options.maxFragments) && options.maxFragments > 0
      ? options.maxFragments
      : 3;
  const fragments = [];
  const seenFragments = new Set();

  for (const note of notes) {
    const fragment = normalizeDigestSummaryFragment(note);

    if (!fragment) {
      continue;
    }

    const fragmentKey = fragment.toLowerCase();

    if (seenFragments.has(fragmentKey)) {
      continue;
    }

    seenFragments.add(fragmentKey);
    fragments.push(fragment);

    if (fragments.length >= maxFragments) {
      break;
    }
  }

  return clipText(fragments.join(" "), 480);
}

function listDigestNotesForDate(db, digestDate) {
  return db
    .prepare(`
      WITH daily_notes AS (
        SELECT
          id
        FROM notes
        WHERE substr(COALESCE(source_timestamp, created_at), 1, 10) = ?
      ),
      note_connections AS (
        SELECT
          note_id,
          related_note_id AS connected_note_id
        FROM relationships
        WHERE note_id IN (SELECT id FROM daily_notes)
          AND related_note_id IN (SELECT id FROM daily_notes)

        UNION

        SELECT
          related_note_id AS note_id,
          note_id AS connected_note_id
        FROM relationships
        WHERE note_id IN (SELECT id FROM daily_notes)
          AND related_note_id IN (SELECT id FROM daily_notes)
      ),
      connection_counts AS (
        SELECT
          note_id,
          COUNT(DISTINCT connected_note_id) AS connection_count
        FROM note_connections
        GROUP BY note_id
      )
      SELECT
        notes.id,
        notes.email_id,
        notes.taxonomy_key,
        notes.title,
        notes.body,
        notes.summary,
        notes.source_excerpt,
        notes.source_timestamp,
        COALESCE(notes.classification_confidence, notes.confidence) AS confidence,
        notes.classification_confidence,
        notes.feedback_useful,
        notes.feedback_comment,
        notes.feedback_updated_at,
        notes.created_at,
        notes.updated_at,
        COALESCE(connection_counts.connection_count, 0) AS connection_count,
        COALESCE((
          SELECT GROUP_CONCAT(normalized_keyword, '${SERIALIZED_KEYWORD_SEPARATOR}')
          FROM (
            SELECT keywords.normalized_keyword AS normalized_keyword
            FROM note_keywords
            INNER JOIN keywords
              ON keywords.id = note_keywords.keyword_id
            WHERE note_keywords.note_id = notes.id
            ORDER BY
              CASE note_keywords.source
                WHEN 'topic' THEN 0
                WHEN 'llm' THEN 1
                ELSE 2
              END,
              keywords.normalized_keyword ASC,
              keywords.id ASC
          )
        ), '') AS digest_keywords,
        COALESCE((
          SELECT GROUP_CONCAT(normalized_keyword, '${SERIALIZED_KEYWORD_SEPARATOR}')
          FROM (
            SELECT keywords.normalized_keyword AS normalized_keyword
            FROM note_keywords
            INNER JOIN keywords
              ON keywords.id = note_keywords.keyword_id
            WHERE note_keywords.note_id = notes.id
              AND note_keywords.source = 'topic'
            ORDER BY keywords.normalized_keyword ASC, keywords.id ASC
          )
        ), '') AS digest_topics,
        COALESCE((
          SELECT GROUP_CONCAT(normalized_keyword, '${SERIALIZED_KEYWORD_SEPARATOR}')
          FROM (
            SELECT keywords.normalized_keyword AS normalized_keyword
            FROM note_keywords
            INNER JOIN keywords
              ON keywords.id = note_keywords.keyword_id
            WHERE note_keywords.note_id = notes.id
              AND note_keywords.source = 'llm'
            ORDER BY keywords.normalized_keyword ASC, keywords.id ASC
          )
        ), '') AS digest_explicit_keywords,
        COALESCE((
          SELECT GROUP_CONCAT(normalized_keyword, '${SERIALIZED_KEYWORD_SEPARATOR}')
          FROM (
            SELECT keywords.normalized_keyword AS normalized_keyword
            FROM note_keywords
            INNER JOIN keywords
              ON keywords.id = note_keywords.keyword_id
            WHERE note_keywords.note_id = notes.id
              AND note_keywords.source = 'derived'
            ORDER BY keywords.normalized_keyword ASC, keywords.id ASC
          )
        ), '') AS digest_derived_keywords
      FROM notes
      LEFT JOIN connection_counts
        ON notes.id = connection_counts.note_id
      WHERE substr(COALESCE(notes.source_timestamp, notes.created_at), 1, 10) = ?
      ORDER BY COALESCE(notes.source_timestamp, notes.created_at) DESC, notes.id DESC
    `)
    .all(digestDate, digestDate)
    .map((row) => ({
      ...hydratePersistedNoteRow(row),
      connection_count: Number(row.connection_count ?? 0),
      keywords: splitSerializedKeywords(row.digest_keywords),
      topics: splitSerializedKeywords(row.digest_topics),
      explicit_keywords: splitSerializedKeywords(row.digest_explicit_keywords),
      derived_keywords: splitSerializedKeywords(row.digest_derived_keywords),
    }));
}

function buildDailyDigestSectionsFromNotes(notes) {
  const notesByTaxonomyKey = new Map();

  for (const note of notes) {
    const existingNotes = notesByTaxonomyKey.get(note.taxonomy_key);

    if (existingNotes) {
      existingNotes.push(note);
      continue;
    }

    notesByTaxonomyKey.set(note.taxonomy_key, [note]);
  }

  return TAXONOMY_TYPES.map((taxonomyType) => {
    const sectionNotes = notesByTaxonomyKey.get(taxonomyType.key) ?? [];

    return {
      taxonomy_key: taxonomyType.key,
      label: taxonomyType.label,
      note_count: sectionNotes.length,
      summary: buildDigestSummary(sectionNotes),
      notes: sectionNotes,
    };
  });
}

function hydratePersistedDigestRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    range_start: trimToNull(row.range_start),
    range_end: trimToNull(row.range_end),
    digest_text: typeof row.digest_text === "string" ? row.digest_text : "",
    generated_at: normalizePersistedSourceTimestamp(row.generated_at),
  };
}

function getDigestByDateRange(db, rangeStart, rangeEnd) {
  const normalizedRangeStart = trimToNull(rangeStart);
  const normalizedRangeEnd = trimToNull(rangeEnd);

  if (!normalizedRangeStart || !normalizedRangeEnd) {
    return null;
  }

  return hydratePersistedDigestRow(
    db
      .prepare(`
        SELECT
          id,
          range_start,
          range_end,
          digest_text,
          generated_at
        FROM digests
        WHERE range_start = ?
          AND range_end = ?
      `)
      .get(normalizedRangeStart, normalizedRangeEnd)
  );
}

function insertDigestForDateRange(db, rangeStart, rangeEnd, digestText) {
  const normalizedRangeStart = trimToNull(rangeStart);
  const normalizedRangeEnd = trimToNull(rangeEnd);

  if (!normalizedRangeStart || !normalizedRangeEnd) {
    throw new TypeError("Digest range start and end dates are required");
  }

  const inserted = db
    .prepare(`
      INSERT INTO digests (
        range_start,
        range_end,
        digest_text
      )
      VALUES (?, ?, ?)
    `)
    .run(
      normalizedRangeStart,
      normalizedRangeEnd,
      typeof digestText === "string" ? digestText : ""
    );

  return hydratePersistedDigestRow(
    db
      .prepare(`
        SELECT
          id,
          range_start,
          range_end,
          digest_text,
          generated_at
        FROM digests
        WHERE id = ?
      `)
      .get(Number(inserted.lastInsertRowid))
  );
}

function isDuplicateDigestRangeError(error) {
  return /UNIQUE constraint failed: digests\.range_start, digests\.range_end/.test(
    error?.message ?? ""
  );
}

function getOrCreateDigestByDateRange(db, rangeStart, rangeEnd, generateDigestText) {
  const existingDigest = getDigestByDateRange(db, rangeStart, rangeEnd);

  if (existingDigest) {
    return existingDigest;
  }

  const digestText =
    typeof generateDigestText === "function" ? generateDigestText() : trimToNull(generateDigestText);

  try {
    return insertDigestForDateRange(db, rangeStart, rangeEnd, digestText ?? "");
  } catch (error) {
    if (isDuplicateDigestRangeError(error)) {
      const persistedDigest = getDigestByDateRange(db, rangeStart, rangeEnd);

      if (persistedDigest) {
        return persistedDigest;
      }
    }

    throw error;
  }
}

export function getLatestDigestDate(db) {
  return (
    trimToNull(
      db
        .prepare(`
          SELECT date(COALESCE(source_timestamp, created_at)) AS digest_date
          FROM notes
          WHERE date(COALESCE(source_timestamp, created_at)) IS NOT NULL
          ORDER BY
            date(COALESCE(source_timestamp, created_at)) DESC,
            COALESCE(source_timestamp, created_at) DESC,
            id DESC
          LIMIT 1
        `)
        .get()?.digest_date
    ) ?? null
  );
}

export function listDailyDigestSections(db, selectedDate) {
  const notes = trimToNull(selectedDate) ? listDigestNotesForDate(db, selectedDate) : [];
  return buildDailyDigestSectionsFromNotes(notes);
}

export function getDailyDigest(db, selectedDate = null) {
  const digestOptions =
    selectedDate && typeof selectedDate === "object" && !Array.isArray(selectedDate)
      ? selectedDate
      : { date: selectedDate };
  const resolvedDate = trimToNull(digestOptions.date) ?? new Date().toISOString().slice(0, 10);
  const notes = trimToNull(resolvedDate) ? listDigestNotesForDate(db, resolvedDate) : [];
  const sections = buildDailyDigestSectionsFromNotes(notes);
  const persistedDigest = getOrCreateDigestByDateRange(
    db,
    resolvedDate,
    resolvedDate,
    () => buildDigestSummary(notes, { maxFragments: 5 }) ?? ""
  );
  const topConnectedLimit =
    Number.isInteger(digestOptions.topConnectedLimit) && digestOptions.topConnectedLimit > 0
      ? digestOptions.topConnectedLimit
      : DEFAULT_DIGEST_NOTE_LIMIT;
  const actionItemLimit =
    Number.isInteger(digestOptions.actionItemLimit) && digestOptions.actionItemLimit > 0
      ? digestOptions.actionItemLimit
      : DEFAULT_DIGEST_NOTE_LIMIT;
  const topThemeLimit =
    Number.isInteger(digestOptions.topThemeLimit) && digestOptions.topThemeLimit > 0
      ? digestOptions.topThemeLimit
      : DEFAULT_DIGEST_NOTE_LIMIT;

  return {
    date: resolvedDate,
    total_notes: notes.length,
    summary: trimToNull(persistedDigest?.digest_text),
    sections,
    note_counts_by_type: listDailyDigestTypeCounts(db, resolvedDate),
    top_themes: buildDailyDigestThemesFromNotes(notes, topThemeLimit),
    top_connected_notes: [...notes]
      .sort(compareDigestNotes)
      .slice(0, topConnectedLimit),
    action_items: selectDailyDigestActionItems(notes, actionItemLimit),
  };
}

export function listMostConnectedNotes(db, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;

  return db
    .prepare(`
      WITH note_connections AS (
        SELECT
          note_id,
          related_note_id AS connected_note_id
        FROM relationships

        UNION

        SELECT
          related_note_id AS note_id,
          note_id AS connected_note_id
        FROM relationships
      ),
      connection_counts AS (
        SELECT
          note_id,
          COUNT(DISTINCT connected_note_id) AS connection_count
        FROM note_connections
        GROUP BY note_id
      )
      SELECT
        notes.id,
        notes.email_id,
        notes.taxonomy_key,
        notes.title,
        notes.body,
        notes.summary,
        notes.source_excerpt,
        notes.source_timestamp,
        COALESCE(notes.classification_confidence, notes.confidence) AS confidence,
        notes.classification_confidence,
        notes.feedback_useful,
        notes.feedback_comment,
        notes.feedback_updated_at,
        notes.created_at,
        notes.updated_at,
        COALESCE(connection_counts.connection_count, 0) AS connection_count
      FROM notes
      LEFT JOIN connection_counts
        ON notes.id = connection_counts.note_id
      ORDER BY
        connection_count DESC,
        COALESCE(notes.source_timestamp, notes.created_at) DESC,
        notes.id DESC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => ({
      ...hydratePersistedNoteRow(row),
      connection_count: Number(row.connection_count),
    }));
}

function listDailyDigestTypeCounts(db, digestDate) {
  const rows = db
    .prepare(`
      SELECT
        taxonomy_key,
        COUNT(*) AS note_count
      FROM notes
      WHERE substr(COALESCE(source_timestamp, created_at), 1, 10) = ?
      GROUP BY taxonomy_key
    `)
    .all(digestDate);
  const rowsByKey = new Map(rows.map((row) => [row.taxonomy_key, Number(row.note_count ?? 0)]));

  return TAXONOMY_TYPES.map((taxonomyType) => ({
    taxonomy_key: taxonomyType.key,
    label: taxonomyType.label,
    note_count: rowsByKey.get(taxonomyType.key) ?? 0,
  }));
}

function getDailyDigestThemeSource(theme) {
  if (theme.hasTopic && theme.hasKeyword) {
    return "topic_keyword";
  }

  if (theme.hasTopic) {
    return "topic";
  }

  return "keyword";
}

function getDailyDigestThemePriority(theme) {
  if (theme.hasTopic) {
    return 0;
  }

  if (theme.hasKeyword) {
    return 1;
  }

  return 2;
}

function countDigestThemeWords(value) {
  if (typeof value !== "string") {
    return 0;
  }

  return value.split(/\s+/g).filter(Boolean).length;
}

function buildDailyDigestThemesFromNotes(notes, limit = DEFAULT_DIGEST_NOTE_LIMIT) {
  const explicitThemes = new Map();
  const derivedThemes = new Map();
  const registerTheme = (registry, note, value, source) => {
    if (typeof value !== "string" || value.length === 0) {
      return;
    }

    const existingTheme = registry.get(value) ?? {
      theme: value,
      noteIds: new Set(),
      hasTopic: false,
      hasKeyword: false,
    };

    existingTheme.noteIds.add(note.id);
    existingTheme.hasTopic = existingTheme.hasTopic || source === "topic";
    existingTheme.hasKeyword = existingTheme.hasKeyword || source === "keyword";
    registry.set(value, existingTheme);
  };

  for (const note of notes) {
    const noteTopics = Array.isArray(note.topics) ? note.topics : [];
    const noteExplicitKeywords = Array.isArray(note.explicit_keywords) ? note.explicit_keywords : [];
    const noteDerivedKeywords = Array.isArray(note.derived_keywords) ? note.derived_keywords : [];

    for (const topic of noteTopics) {
      registerTheme(explicitThemes, note, topic, "topic");
    }

    for (const keyword of noteExplicitKeywords) {
      registerTheme(explicitThemes, note, keyword, "keyword");
    }

    for (const keyword of noteDerivedKeywords) {
      registerTheme(derivedThemes, note, keyword, "keyword");
    }
  }

  const selectThemes = (registry) =>
    Array.from(registry.values())
      .map((theme) => ({
        theme: theme.theme,
        source: getDailyDigestThemeSource(theme),
        note_count: theme.noteIds.size,
        note_ids: Array.from(theme.noteIds).sort((left, right) => left - right),
        hasTopic: theme.hasTopic,
        hasKeyword: theme.hasKeyword,
      }))
      .sort((left, right) => {
        return (
          right.note_count - left.note_count ||
          getDailyDigestThemePriority(left) - getDailyDigestThemePriority(right) ||
          countDigestThemeWords(right.theme) - countDigestThemeWords(left.theme) ||
          right.theme.length - left.theme.length ||
          left.theme.localeCompare(right.theme)
        );
      });
  const explicitThemeList = selectThemes(explicitThemes);
  const sharedExplicitThemes = explicitThemeList.filter((theme) => theme.note_count > 1);
  const selectedThemes =
    sharedExplicitThemes.length > 0
      ? sharedExplicitThemes
      : explicitThemeList.length > 0
        ? explicitThemeList
        : selectThemes(derivedThemes);

  return selectedThemes.slice(0, limit).map(({ hasTopic, hasKeyword, ...theme }) => theme);
}

function getDigestSortTimestamp(note) {
  return normalizePersistedSourceTimestamp(note.source_timestamp ?? note.created_at) ?? "";
}

function compareDigestNotes(left, right) {
  const connectionDelta =
    Number(right.connection_count ?? 0) - Number(left.connection_count ?? 0);

  if (connectionDelta !== 0) {
    return connectionDelta;
  }

  const confidenceDelta =
    (right.classificationConfidence ?? right.classification_confidence ?? right.confidence ?? 0) -
    (left.classificationConfidence ?? left.classification_confidence ?? left.confidence ?? 0);

  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  const timestampDelta = getDigestSortTimestamp(right).localeCompare(getDigestSortTimestamp(left));

  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return Number(right.id ?? 0) - Number(left.id ?? 0);
}

function looksActionableText(value) {
  return typeof value === "string" && ACTIONABLE_LANGUAGE_RE.test(value);
}

function isDailyDigestActionable(note) {
  if (DAILY_DIGEST_ACTIONABLE_TYPES.has(note.taxonomy_key)) {
    return true;
  }

  return (
    looksActionableText(note.summary) ||
    looksActionableText(note.body) ||
    looksActionableText(note.title)
  );
}

function scoreDailyDigestActionItem(note) {
  let score = ACTION_ITEM_BASE_PRIORITY.get(note.taxonomy_key) ?? 100;

  if (note.feedback?.useful === true) {
    score += 60;
  } else if (note.feedback?.useful === false) {
    score -= 60;
  }

  score += Number(note.connection_count ?? 0) * 15;
  score += Math.round(
    (note.classificationConfidence ?? note.classification_confidence ?? note.confidence ?? 0) * 25
  );

  return score;
}

function selectDailyDigestActionItems(notes, limit) {
  return notes
    .filter(isDailyDigestActionable)
    .sort((left, right) => {
      const scoreDelta = scoreDailyDigestActionItem(right) - scoreDailyDigestActionItem(left);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return compareDigestNotes(left, right);
    })
    .slice(0, limit);
}

export function replaceNotesForEmail(db, emailId, notes, options = {}) {
  const deleteNotes = db.prepare(`
    DELETE FROM notes
    WHERE email_id = ?
  `);
  const insertNote = db.prepare(`
    INSERT INTO notes (
      email_id,
      taxonomy_key,
      title,
      body,
      summary,
      source_excerpt,
      source_timestamp,
      confidence,
      classification_confidence
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertedNoteIds = [];
  const comparisonNotes = listNotesForComparison(db, { excludeEmailId: emailId });
  const detectedRelationships = Array.isArray(options.detectedRelationships)
    ? options.detectedRelationships
    : compareNewNotesToExistingNotes(notes, comparisonNotes);
  const hasExplicitDuplicateRelationships =
    Array.isArray(options.detectedRelationships) &&
    options.detectedRelationships.some(
      (relationship) =>
        buildPersistedRelationshipType(
          relationship.relationshipType ?? relationship.relationship_type,
          "keyword"
        ) === DUPLICATE_OF_RELATIONSHIP_TYPE
    );
  const detectedDuplicateCandidates = Array.isArray(options.detectedDuplicateCandidates)
    ? options.detectedDuplicateCandidates
    : hasExplicitDuplicateRelationships
      ? []
      : compareNewNotesToDuplicateCandidates(notes, comparisonNotes);
  const detectedDuplicateRelationships = hasExplicitDuplicateRelationships
    ? []
    : selectCanonicalDuplicateRelationships(db, detectedDuplicateCandidates);
  const intraEmailRelationships = detectRelationshipsWithinNoteBatch(notes);

  db.exec("BEGIN IMMEDIATE");

  try {
    deleteNotes.run(emailId);

    for (const note of notes) {
      const validatedClassificationConfidence = resolveNoteClassificationConfidence(note);
      const inserted = insertNote.run(
        emailId,
        normalizeTaxonomyKey(note.type),
        note.title,
        note.content,
        trimToNull(note.summary),
        normalizeSourceExcerpt(note),
        normalizeSourceTimestamp(note),
        validatedClassificationConfidence,
        validatedClassificationConfidence
      );

      const noteId = Number(inserted.lastInsertRowid);
      insertedNoteIds.push(noteId);
      insertNoteKeywords(db, noteId, note);
    }

    insertDetectedRelationships(db, insertedNoteIds, [
      ...detectedRelationships,
      ...detectedDuplicateRelationships,
      ...intraEmailRelationships,
    ]);

    db.exec("COMMIT");
    return insertedNoteIds;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listNotesByEmailId(db, emailId) {
  return db
    .prepare(`
      SELECT
        id,
        email_id,
        taxonomy_key,
        title,
        body,
        summary,
        source_excerpt,
        source_timestamp,
        COALESCE(classification_confidence, confidence) AS confidence,
        classification_confidence,
        feedback_useful,
        feedback_comment,
        feedback_updated_at,
        created_at,
        updated_at
      FROM notes
      WHERE email_id = ?
      ORDER BY id ASC
    `)
    .all(emailId)
    .map(hydratePersistedNoteRow);
}

export function getNoteWithRelationshipsById(db, noteId) {
  const note = hydratePersistedNoteRow(
    db
      .prepare(`
        SELECT
          id,
          email_id,
          taxonomy_key,
          title,
          body,
          summary,
          source_excerpt,
          source_timestamp,
          COALESCE(classification_confidence, confidence) AS confidence,
          classification_confidence,
          feedback_useful,
          feedback_comment,
          feedback_updated_at,
          created_at,
          updated_at
        FROM notes
        WHERE id = ?
      `)
      .get(noteId)
  );

  if (!note) {
    return null;
  }

  const relationshipRows = db
    .prepare(`
      SELECT
        relationships.id,
        relationships.note_id,
        relationships.related_note_id,
        relationships.relationship_type,
        relationships.strength,
        relationships.overlap_basis,
        relationships.matched_value,
        relationships.matched_terms_json,
        relationships.overlap_source_metadata_json,
        relationships.created_at,
        relationships.updated_at,
        related_notes.id AS resolved_related_note_id,
        related_notes.email_id AS related_note_email_id,
        related_notes.taxonomy_key AS related_note_taxonomy_key,
        related_notes.title AS related_note_title,
        related_notes.body AS related_note_body,
        related_notes.summary AS related_note_summary,
        related_notes.source_excerpt AS related_note_source_excerpt,
        related_notes.source_timestamp AS related_note_source_timestamp,
        COALESCE(
          related_notes.classification_confidence,
          related_notes.confidence
        ) AS related_note_confidence,
        related_notes.classification_confidence AS related_note_classification_confidence,
        related_notes.feedback_useful AS related_note_feedback_useful,
        related_notes.feedback_comment AS related_note_feedback_comment,
        related_notes.feedback_updated_at AS related_note_feedback_updated_at,
        related_notes.created_at AS related_note_created_at,
        related_notes.updated_at AS related_note_updated_at
      FROM relationships
      INNER JOIN notes AS related_notes
        ON related_notes.id = CASE
          WHEN relationships.note_id = ? THEN relationships.related_note_id
          ELSE relationships.note_id
        END
      WHERE relationships.note_id = ?
         OR relationships.related_note_id = ?
      ORDER BY relationships.strength DESC, related_notes.id ASC, relationships.id ASC
    `)
    .all(noteId, noteId, noteId);

  const relationshipGroups = new Map();

  for (const relationship of relationshipRows) {
    if (
      relationship.relationship_type === DUPLICATE_OF_RELATIONSHIP_TYPE &&
      relationship.note_id !== noteId
    ) {
      continue;
    }

    const groupKey = buildResolvedRelationshipGroupKey(relationship);
    const parsedMetadata = JSON.parse(relationship.overlap_source_metadata_json);
    let group = relationshipGroups.get(groupKey);

    if (!group) {
      group = {
        id: relationship.id,
        relationship_type: relationship.relationship_type,
        strength: relationship.strength,
        overlap_basis: relationship.overlap_basis,
        overlap_source: buildRelationshipMetadataLabel(
          relationship.relationship_type,
          relationship.overlap_basis
        ),
        overlap_source_metadata: parsedMetadata,
        matched_values: buildRelationshipOverlapTerms(relationship, parsedMetadata),
        created_at: relationship.created_at,
        updated_at: relationship.updated_at,
        related_note: hydratePersistedNoteRow({
          id: relationship.resolved_related_note_id,
          email_id: relationship.related_note_email_id,
          taxonomy_key: relationship.related_note_taxonomy_key,
          title: relationship.related_note_title,
          body: relationship.related_note_body,
          summary: relationship.related_note_summary,
          source_excerpt: relationship.related_note_source_excerpt,
          source_timestamp: relationship.related_note_source_timestamp,
          confidence: relationship.related_note_confidence,
          classification_confidence: relationship.related_note_classification_confidence,
          feedback_useful: relationship.related_note_feedback_useful,
          feedback_comment: relationship.related_note_feedback_comment,
          feedback_updated_at: relationship.related_note_feedback_updated_at,
          created_at: relationship.related_note_created_at,
          updated_at: relationship.related_note_updated_at,
        }),
      };
      relationshipGroups.set(groupKey, group);
    }

    if (relationship.matched_value && !group.matched_values.includes(relationship.matched_value)) {
      group.matched_values.push(relationship.matched_value);
    }
  }

  const relationships = Array.from(relationshipGroups.values()).map((relationship) => ({
    ...relationship,
    overlap_terms: [...relationship.matched_values],
  }));

  return {
    ...note,
    relationships,
  };
}

export function storeNoteFeedback(db, noteId, feedback) {
  if (!Number.isInteger(noteId) || noteId <= 0) {
    throw new TypeError("Note id must be a positive integer");
  }

  const useful = normalizeNoteFeedbackUseful(feedback?.useful);
  const comment = normalizeNoteFeedbackComment(feedback?.comment);
  const result = db
    .prepare(`
      UPDATE notes
      SET
        feedback_useful = ?,
        feedback_comment = ?,
        feedback_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(useful ? 1 : 0, comment, noteId);

  if (result.changes === 0) {
    return null;
  }

  return getNoteWithRelationshipsById(db, noteId);
}

export function listNotesForComparison(db, options = {}) {
  const excludeEmailId = Number.isInteger(options.excludeEmailId)
    ? options.excludeEmailId
    : null;
  const whereClause = excludeEmailId === null ? "" : "WHERE email_id != ?";
  const statement = db.prepare(`
    SELECT
      notes.id,
      notes.email_id,
      notes.taxonomy_key,
      notes.title,
      notes.body,
      notes.summary,
      notes.source_excerpt,
      notes.source_timestamp,
      COALESCE(notes.classification_confidence, notes.confidence) AS confidence,
      notes.classification_confidence,
      notes.created_at,
      notes.updated_at,
      COALESCE((
        SELECT GROUP_CONCAT(normalized_keyword, '${SERIALIZED_KEYWORD_SEPARATOR}')
        FROM (
          SELECT keywords.normalized_keyword AS normalized_keyword
          FROM note_keywords
          INNER JOIN keywords
            ON keywords.id = note_keywords.keyword_id
          WHERE note_keywords.note_id = notes.id
          ORDER BY
            CASE note_keywords.source
              WHEN 'topic' THEN 0
              WHEN 'llm' THEN 1
              ELSE 2
            END,
            keywords.normalized_keyword ASC,
            keywords.id ASC
        )
      ), '') AS comparison_keywords,
      COALESCE((
        SELECT GROUP_CONCAT(normalized_keyword, '${SERIALIZED_KEYWORD_SEPARATOR}')
        FROM (
          SELECT keywords.normalized_keyword AS normalized_keyword
          FROM note_keywords
          INNER JOIN keywords
            ON keywords.id = note_keywords.keyword_id
          WHERE note_keywords.note_id = notes.id
            AND note_keywords.source = 'topic'
          ORDER BY keywords.normalized_keyword ASC, keywords.id ASC
        )
      ), '') AS comparison_topics
    FROM notes
    ${whereClause}
    ORDER BY notes.id ASC
  `);

  const rows = excludeEmailId === null ? statement.all() : statement.all(excludeEmailId);

  return rows.map((row) => ({
    ...hydratePersistedNoteRow(row),
    keywords: splitSerializedKeywords(row.comparison_keywords),
    topics: splitSerializedKeywords(row.comparison_topics),
  }));
}

export function listRelationships(db) {
  const rows = db
    .prepare(`
      SELECT
        id,
        note_id,
        related_note_id,
        relationship_type,
        strength,
        overlap_basis,
        matched_value,
        matched_terms_json,
        overlap_source_metadata_json,
        created_at,
        updated_at
      FROM relationships
      ORDER BY note_id ASC, related_note_id ASC, overlap_basis ASC, id ASC
    `)
    .all();

  const groupedRelationships = new Map();

  for (const row of rows) {
    const groupKey = buildRelationshipGroupKey(row);
    const parsedMetadata = JSON.parse(row.overlap_source_metadata_json);
    let group = groupedRelationships.get(groupKey);

    if (!group) {
      group = {
        id: row.id,
        note_id: row.note_id,
        related_note_id: row.related_note_id,
        relationship_type: row.relationship_type,
        strength: row.strength,
        overlap_basis: row.overlap_basis,
        overlap_source: buildRelationshipMetadataLabel(row.relationship_type, row.overlap_basis),
        matched_values: buildRelationshipOverlapTerms(row, parsedMetadata),
        overlap_source_metadata: parsedMetadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      groupedRelationships.set(groupKey, group);
    }

    if (row.matched_value && !group.matched_values.includes(row.matched_value)) {
      group.matched_values.push(row.matched_value);
    }
  }

  return Array.from(groupedRelationships.values()).map((relationship) => ({
    ...relationship,
    overlap_terms: [...relationship.matched_values],
  }));
}

export async function initializeDatabase(options = {}) {
  const { db, databasePath } = await openDatabaseConnection(options);

  try {
    return {
      databasePath,
      schemaVersion: getSchemaVersion(db),
      taxonomyTypeCount: TAXONOMY_TYPES.length,
    };
  } finally {
    db.close();
  }
}
