import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import {
  getDailyDigest,
  getEmailIngestionSummary,
  getEmailProcessingJobById,
  getNoteWithRelationshipsById,
  initializeDatabase,
  listEmailProcessingEvents,
  listMostConnectedNotes,
  listNotesByEmailId,
  listRelationships,
  listSources,
  listTaxonomyTypeCounts,
  openDatabaseConnection,
  queueEmailProcessingJob,
  replaceNotesForEmail,
  retryEmailProcessingJob,
  storeNoteFeedback,
  storeAgentMailWebhookDelivery,
  TAXONOMY_TYPES,
  updateEmailProcessingJobState,
} from "./database.mjs";

async function withTempDatabase(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "inbox-database-"));
  const databasePath = path.join(tempDir, "newsletter.sqlite");

  try {
    await run(databasePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("initializeDatabase keeps shared links symmetric, supports combined overlap basis, and allows directional duplicate_of links", async () => {
  await withTempDatabase(async (databasePath) => {
    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 19);

    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const relationshipColumns = db
        .prepare("PRAGMA table_info(relationships)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(relationshipColumns, [
        "id",
        "note_id",
        "related_note_id",
        "relationship_type",
        "strength",
        "overlap_basis",
        "matched_value",
        "matched_terms_json",
        "overlap_source_metadata_json",
        "created_at",
        "updated_at",
      ]);

      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_relationship_schema", "{}").lastInsertRowid
      );
      const insertNote = db.prepare(`
        INSERT INTO notes (email_id, taxonomy_key, title, body)
        VALUES (?, 'fact', ?, ?)
      `);
      const noteId = Number(insertNote.run(emailId, "Note one", "Note one body").lastInsertRowid);
      const relatedNoteId = Number(
        insertNote.run(emailId, "Note two", "Note two body").lastInsertRowid
      );

      const insertRelationship = db.prepare(`
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

      insertRelationship.run(
        noteId,
        relatedNoteId,
        "shared_keyword",
        0.75,
        "both",
        "ai workflow",
        '["ai workflow","pricing automation"]',
        '{"source":"keyword_match"}'
      );

      assert.throws(
        () =>
          insertRelationship.run(
            noteId,
            relatedNoteId,
            "shared_keyword",
            0.75,
            "both",
            "ai workflow",
            '["ai workflow","pricing automation"]',
            '{"source":"keyword_match"}'
          ),
        /UNIQUE constraint failed: relationships\.note_id, relationships\.related_note_id, relationships\.relationship_type, relationships\.overlap_basis, relationships\.matched_value/
      );

      insertRelationship.run(
        relatedNoteId,
        noteId,
        "duplicate_of",
        0.99,
        "keyword",
        "ai workflow",
        '["ai workflow"]',
        '{"source":"duplicate_of"}'
      );

      assert.throws(
        () =>
          insertRelationship.run(
            relatedNoteId,
            noteId,
            "shared_keyword",
            0.75,
            "both",
            "ai workflow",
            '["ai workflow","pricing automation"]',
            '{"source":"keyword_match"}'
          ),
        /CHECK constraint failed:[\s\S]*note_id < related_note_id/
      );

      insertRelationship.run(
        noteId,
        relatedNoteId,
        "shared_keyword",
        0.75,
        "keyword",
        "renewal",
        '["renewal","pricing automation"]',
        '{"source":"keyword_match"}',
      );

      const relationshipCount = db
        .prepare("SELECT COUNT(*) AS count FROM relationships")
        .get().count;
      const duplicateRelationship = db
        .prepare(`
          SELECT note_id, related_note_id, relationship_type
          FROM relationships
          WHERE relationship_type = 'duplicate_of'
        `)
        .get();
      const combinedOverlapRelationship = db
        .prepare(`
          SELECT overlap_basis, matched_terms_json
          FROM relationships
          WHERE relationship_type = 'shared_keyword'
            AND overlap_basis = 'both'
        `)
        .get();

      assert.equal(relationshipCount, 3);
      assert.equal(duplicateRelationship.note_id, relatedNoteId);
      assert.equal(duplicateRelationship.related_note_id, noteId);
      assert.equal(duplicateRelationship.relationship_type, "duplicate_of");
      assert.equal(combinedOverlapRelationship.overlap_basis, "both");
      assert.equal(
        combinedOverlapRelationship.matched_terms_json,
        '["ai workflow","pricing automation"]'
      );
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase restores the canonical relationships schema for version 9 partial databases", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        PRAGMA user_version = 9;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 19);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const relationshipColumns = migratedDb
        .prepare("PRAGMA table_info(relationships)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(relationshipColumns, [
        "id",
        "note_id",
        "related_note_id",
        "relationship_type",
        "strength",
        "overlap_basis",
        "matched_value",
        "matched_terms_json",
        "overlap_source_metadata_json",
        "created_at",
        "updated_at",
      ]);
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase migrates version 13 relationships so duplicate_of can coexist with shared keyword evidence", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY,
          agentmail_message_id TEXT NOT NULL UNIQUE,
          raw_payload TEXT NOT NULL
        );

        CREATE TABLE notes (
          id INTEGER PRIMARY KEY,
          email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
          taxonomy_key TEXT NOT NULL REFERENCES taxonomy_types(key),
          title TEXT NOT NULL,
          body TEXT NOT NULL
        );

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
          UNIQUE (note_id, related_note_id, overlap_basis, matched_value),
          CHECK (note_id < related_note_id),
          CHECK (overlap_basis IN ('topic', 'keyword'))
        );

        PRAGMA user_version = 13;
      `);

      db.prepare(`
        INSERT INTO taxonomy_types (key, label, description)
        VALUES ('fact', 'Fact', 'A concrete, verifiable statement grounded in the source material.')
      `).run();
      db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?), (?, ?)
      `).run("msg_migrate_duplicate_1", "{}", "msg_migrate_duplicate_2", "{}");
      db.prepare(`
        INSERT INTO notes (email_id, taxonomy_key, title, body)
        VALUES (1, 'fact', 'Note one', 'Body one'), (2, 'fact', 'Note two', 'Body two')
      `).run();
      db.prepare(`
        INSERT INTO relationships (
          note_id,
          related_note_id,
          relationship_type,
          strength,
          overlap_basis,
          matched_value,
          overlap_source_metadata_json
        )
        VALUES (1, 2, 'shared_keyword', 2, 'keyword', 'ai copilot', '{}')
      `).run();
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 19);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      migratedDb.prepare(`
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
        VALUES (2, 1, 'duplicate_of', 0.99, 'keyword', 'ai copilot', '["ai copilot"]', '{}')
      `).run();

      const relationships = migratedDb.prepare(`
        SELECT note_id, related_note_id, relationship_type, matched_value, matched_terms_json
        FROM relationships
        ORDER BY relationship_type ASC
      `).all();

      assert.deepEqual(
        relationships.map((relationship) => ({ ...relationship })),
        [
          {
            note_id: 2,
            related_note_id: 1,
            relationship_type: "duplicate_of",
            matched_value: "ai copilot",
            matched_terms_json: '["ai copilot"]',
          },
          {
            note_id: 1,
            related_note_id: 2,
            relationship_type: "shared_keyword",
            matched_value: "ai copilot",
            matched_terms_json: '["ai copilot"]',
          },
        ]
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase collapses legacy duplicate_of rows to one persisted edge per pair and enforces pair uniqueness", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY,
          agentmail_message_id TEXT NOT NULL UNIQUE,
          raw_payload TEXT NOT NULL
        );

        CREATE TABLE notes (
          id INTEGER PRIMARY KEY,
          email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
          taxonomy_key TEXT NOT NULL REFERENCES taxonomy_types(key),
          title TEXT NOT NULL,
          body TEXT NOT NULL
        );

        CREATE TABLE relationships (
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

        PRAGMA user_version = 20;
      `);

      db.prepare(`
        INSERT INTO taxonomy_types (key, label, description)
        VALUES ('fact', 'Fact', 'A concrete, verifiable statement grounded in the source material.')
      `).run();
      db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?), (?, ?)
      `).run("msg_duplicate_migration_1", "{}", "msg_duplicate_migration_2", "{}");
      db.prepare(`
        INSERT INTO notes (email_id, taxonomy_key, title, body)
        VALUES
          (1, 'fact', 'Canonical note', 'AI copilots grew 42% year over year.'),
          (2, 'fact', 'Duplicate note', 'Across teams AI copilots grew 42 percent.')
      `).run();
      db.prepare(`
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
        VALUES
          (2, 1, 'duplicate_of', 0.99, 'keyword', 'ai copilot', '["ai copilot","42"]', '{"duplicateKind":"exact"}'),
          (2, 1, 'duplicate_of', 0.88, 'keyword', 'renewal', '["renewal"]', '{"duplicateKind":"near","matchedRules":["high_token_overlap"]}'),
          (1, 2, 'shared_keyword', 2, 'keyword', 'ai copilot', '["ai copilot"]', '{}')
      `).run();
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 21);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const duplicateRows = migratedDb.prepare(`
        SELECT
          note_id,
          related_note_id,
          matched_value,
          matched_terms_json,
          overlap_source_metadata_json
        FROM relationships
        WHERE relationship_type = 'duplicate_of'
      `).all();
      const sharedRows = migratedDb.prepare(`
        SELECT COUNT(*) AS count
        FROM relationships
        WHERE relationship_type = 'shared_keyword'
      `).get();

      assert.equal(duplicateRows.length, 1);
      assert.equal(sharedRows.count, 1);
      assert.equal(duplicateRows[0].note_id, 2);
      assert.equal(duplicateRows[0].related_note_id, 1);
      assert.deepEqual(
        JSON.parse(duplicateRows[0].matched_terms_json),
        ["ai copilot", "42", "renewal"]
      );
      assert.deepEqual(
        JSON.parse(duplicateRows[0].overlap_source_metadata_json).matchedRules,
        ["high_token_overlap"]
      );

      assert.throws(
        () =>
          migratedDb.prepare(`
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
            VALUES (2, 1, 'duplicate_of', 0.77, 'keyword', 'finance', '["finance"]', '{}')
          `).run(),
        /UNIQUE constraint failed/
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase adds email relevance_status with a pending default for existing rows", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY,
          agentmail_message_id TEXT NOT NULL UNIQUE,
          raw_payload TEXT NOT NULL,
          ingestion_status TEXT NOT NULL DEFAULT 'received',
          processing_error TEXT
        );

        INSERT INTO emails (
          agentmail_message_id,
          raw_payload,
          ingestion_status,
          processing_error
        )
        VALUES ('msg_relevance_status_1', '{}', 'processed', NULL);

        PRAGMA user_version = 14;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 15);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const emailColumns = migratedDb
        .prepare("PRAGMA table_info(emails)")
        .all()
        .map((column) => column.name);
      const migratedEmail = migratedDb.prepare(`
        SELECT relevance_status
        FROM emails
        WHERE agentmail_message_id = 'msg_relevance_status_1'
      `).get();

      assert.ok(emailColumns.includes("relevance_status"));
      assert.equal(migratedEmail.relevance_status, "pending");
    } finally {
      migratedDb.close();
    }
  });
});

test("replaceNotesForEmail stores validated classificationConfidence scores and rejects invalid values", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_confidence_validation", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, emailId, [
        {
          type: "fact",
          title: "Validated confidence note",
          content: "AI copilots grew 42% year over year across mid-market teams.",
          classificationConfidence: 0.83,
        },
      ]);

      let [storedNote] = listNotesByEmailId(db, emailId);
      const persistedNote = db.prepare(`
        SELECT confidence, classification_confidence
        FROM notes
        WHERE id = ?
      `).get(storedNote.id);

      assert.equal(storedNote.confidence, 0.83);
      assert.equal(storedNote.classificationConfidence, 0.83);
      assert.equal(persistedNote.confidence, 0.83);
      assert.equal(persistedNote.classification_confidence, 0.83);

      assert.throws(
        () =>
          replaceNotesForEmail(db, emailId, [
            {
              type: "fact",
              title: "Invalid confidence note",
              content: "This note should not replace the previously stored row.",
              classificationConfidence: 1.2,
            },
          ]),
        /Note confidence must be between 0 and 1/
      );

      [storedNote] = listNotesByEmailId(db, emailId);
      assert.equal(storedNote.title, "Validated confidence note");
      assert.equal(storedNote.confidence, 0.83);
      assert.equal(storedNote.classificationConfidence, 0.83);
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase creates notes with a constrained classification_confidence field on first run", async () => {
  await withTempDatabase(async (databasePath) => {
    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 19);

    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const noteColumns = db.prepare("PRAGMA table_info(notes)").all();
      const classificationConfidenceColumn = noteColumns.find(
        (column) => column.name === "classification_confidence"
      );
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_fresh_schema_confidence", "{}").lastInsertRowid
      );

      assert.ok(classificationConfidenceColumn);
      assert.equal(classificationConfidenceColumn.type, "REAL");

      replaceNotesForEmail(db, emailId, [
        {
          type: "fact",
          title: "LLM confidence alias",
          content: "A note written with the LLM confidence field alias.",
          confidence: 0.61,
        },
      ]);

      const persistedNote = db.prepare(`
        SELECT confidence, classification_confidence
        FROM notes
        WHERE email_id = ?
      `).get(emailId);

      assert.equal(persistedNote.confidence, 0.61);
      assert.equal(persistedNote.classification_confidence, 0.61);
      assert.throws(
        () =>
          db.prepare(`
            INSERT INTO notes (
              email_id,
              taxonomy_key,
              title,
              body,
              classification_confidence
            )
            VALUES (?, ?, ?, ?, ?)
          `).run(
            emailId,
            "fact",
            "Too confident",
            "This should fail the SQLite range check.",
            -0.01
          ),
        /CHECK constraint failed/
      );
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase backfills classification_confidence from legacy confidence values and enforces the SQLite range check", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE notes (
          id INTEGER PRIMARY KEY,
          email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
          taxonomy_key TEXT NOT NULL REFERENCES taxonomy_types(key),
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          summary TEXT,
          source_excerpt TEXT,
          confidence REAL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          source_timestamp TEXT
        );

        INSERT INTO taxonomy_types (key, label, description)
        VALUES ('fact', 'Fact', 'A concrete, verifiable statement.');

        INSERT INTO emails (id) VALUES (1);

        INSERT INTO notes (
          id,
          email_id,
          taxonomy_key,
          title,
          body,
          confidence,
          source_timestamp
        )
        VALUES
          (1, 1, 'fact', 'Valid confidence', 'This row keeps its confidence.', 0.72, '2026-03-09T17:00:00Z'),
          (2, 1, 'fact', 'Too high confidence', 'This row should be scrubbed.', 1.4, '2026-03-09T17:05:00Z'),
          (3, 1, 'fact', 'Negative confidence', 'This row should also be scrubbed.', -0.2, '2026-03-09T17:10:00Z');

        PRAGMA user_version = 12;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 17);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const noteColumns = migratedDb
        .prepare("PRAGMA table_info(notes)")
        .all()
        .map((column) => column.name);
      const notes = migratedDb.prepare(`
        SELECT id, confidence, classification_confidence
        FROM notes
        ORDER BY id ASC
      `).all();

      assert.ok(noteColumns.includes("classification_confidence"));
      assert.deepEqual(
        notes.map((note) => ({ ...note })),
        [
          { id: 1, confidence: 0.72, classification_confidence: 0.72 },
          { id: 2, confidence: null, classification_confidence: null },
          { id: 3, confidence: null, classification_confidence: null },
        ]
      );

      assert.throws(
        () =>
          migratedDb.prepare(`
            INSERT INTO notes (
              email_id,
              taxonomy_key,
              title,
              body,
              classification_confidence
            )
            VALUES (?, ?, ?, ?, ?)
          `).run(
            1,
            "fact",
            "Out-of-range classification confidence",
            "Should fail at the SQLite layer.",
            1.01
          ),
        /CHECK constraint failed/
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("replaceNotesForEmail persists detected relationships idempotently across reprocessing", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_relationship_write_1", "{}").lastInsertRowid);
      const secondEmailId = Number(
        insertEmail.run("msg_relationship_write_2", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "pattern_trend",
          title: "AI copilots spread through finance teams",
          content: "AI copilots are spreading through finance teams this quarter.",
        },
      ]);

      const firstStoredNote = listNotesByEmailId(db, firstEmailId)[0];

      replaceNotesForEmail(
        db,
        secondEmailId,
        [
          {
            type: "idea",
            title: "Operators standardize prompt reviews",
            content: "Operators are standardizing prompt reviews for AI copilots.",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              existingEmailId: firstEmailId,
              existingNoteType: firstStoredNote.taxonomy_key,
              existingNoteTitle: firstStoredNote.title,
              overlapBasis: "keyword",
              matchedValues: ["ai copilot", "finance"],
              score: 4,
            },
          ],
        }
      );

      let secondStoredNote = listNotesByEmailId(db, secondEmailId)[0];
      let relationships = listRelationships(db);

      assert.equal(relationships.length, 1);
      assert.equal(relationships[0].note_id, firstStoredNote.id);
      assert.equal(relationships[0].related_note_id, secondStoredNote.id);
      assert.equal(relationships[0].relationship_type, "shared_keyword");
      assert.equal(relationships[0].strength, 4);
      assert.deepEqual(relationships[0].overlap_terms, ["ai copilot", "finance"]);

      replaceNotesForEmail(
        db,
        secondEmailId,
        [
          {
            type: "idea",
            title: "Operators keep standardizing prompt reviews",
            content: "Operators are still standardizing prompt reviews for AI copilots.",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              existingEmailId: firstEmailId,
              existingNoteType: firstStoredNote.taxonomy_key,
              existingNoteTitle: firstStoredNote.title,
              overlapBasis: "keyword",
              matchedValues: ["ai copilot", "finance"],
              score: 6,
            },
          ],
        }
      );

      secondStoredNote = listNotesByEmailId(db, secondEmailId)[0];
      relationships = listRelationships(db);

      assert.equal(relationships.length, 1);
      assert.equal(relationships[0].note_id, firstStoredNote.id);
      assert.equal(relationships[0].related_note_id, secondStoredNote.id);
      assert.equal(relationships[0].relationship_type, "shared_keyword");
      assert.equal(relationships[0].strength, 6);
      assert.deepEqual(relationships[0].overlap_terms, ["ai copilot", "finance"]);
    } finally {
      db.close();
    }
  });
});

test("getNoteWithRelationshipsById exposes duplicate_of only on the duplicate note while preserving shared keyword links", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_duplicate_link_1", "{}").lastInsertRowid);
      const secondEmailId = Number(insertEmail.run("msg_duplicate_link_2", "{}").lastInsertRowid);

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Finance teams standardize on AI copilots",
          content: "Finance teams are standardizing on AI copilots for renewals.",
        },
      ]);

      const [firstStoredNote] = listNotesByEmailId(db, firstEmailId);

      replaceNotesForEmail(
        db,
        secondEmailId,
        [
          {
            type: "fact",
            title: "AI copilots drive finance renewals",
            content: "AI copilots are driving finance renewals this quarter.",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["ai copilot", "finance"],
              score: 2,
            },
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              relationshipType: "duplicate_of",
              overlapBasis: "keyword",
              matchedValue: "normalized duplicate",
              score: 0.99,
            },
          ],
        }
      );

      const [secondStoredNote] = listNotesByEmailId(db, secondEmailId);
      const canonicalNote = getNoteWithRelationshipsById(db, firstStoredNote.id);
      const duplicateNote = getNoteWithRelationshipsById(db, secondStoredNote.id);
      assert.ok(canonicalNote);
      assert.ok(duplicateNote);
      assert.equal(canonicalNote.relationships.length, 1);
      assert.equal(duplicateNote.relationships.length, 2);

      const duplicateRelationship = duplicateNote.relationships.find(
        (relationship) => relationship.relationship_type === "duplicate_of"
      );
      const sharedKeywordRelationship = duplicateNote.relationships.find(
        (relationship) => relationship.relationship_type === "shared_keyword"
      );

      assert.ok(duplicateRelationship);
      assert.ok(sharedKeywordRelationship);
      assert.deepEqual(duplicateRelationship.overlap_terms, ["normalized duplicate"]);
      assert.deepEqual(sharedKeywordRelationship.overlap_terms, ["ai copilot", "finance"]);
      assert.equal(duplicateRelationship.related_note.id, firstStoredNote.id);
      assert.equal(sharedKeywordRelationship.related_note.id, firstStoredNote.id);
      assert.equal(duplicateRelationship.related_note.classificationConfidence, null);
      assert.ok(
        canonicalNote.relationships.every(
          (relationship) => relationship.relationship_type !== "duplicate_of"
        )
      );
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail ignores same-email duplicate_of links and deduplicates cross-email edges for the same pair", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_duplicate_guard_1", "{}").lastInsertRowid);
      const secondEmailId = Number(insertEmail.run("msg_duplicate_guard_2", "{}").lastInsertRowid);

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Finance teams standardize on AI copilots",
          content: "Finance teams are standardizing on AI copilots for renewals.",
        },
      ]);

      const [firstStoredNote] = listNotesByEmailId(db, firstEmailId);

      replaceNotesForEmail(
        db,
        secondEmailId,
        [
          {
            type: "fact",
            title: "AI copilots drive finance renewals",
            content: "AI copilots are driving finance renewals this quarter.",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              existingEmailId: firstEmailId,
              relationshipType: "duplicate_of",
              overlapBasis: "keyword",
              matchedValues: ["ai copilot", "finance"],
              score: 0.99,
            },
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              existingEmailId: firstEmailId,
              relationshipType: "duplicate_of",
              overlapBasis: "keyword",
              matchedValues: ["finance", "renewal"],
              score: 0.99,
            },
            {
              newNoteIndex: 0,
              existingNoteId: firstStoredNote.id,
              existingEmailId: secondEmailId,
              relationshipType: "duplicate_of",
              overlapBasis: "keyword",
              matchedValues: ["should be skipped"],
              score: 0.99,
            },
          ],
        }
      );

      const relationships = listRelationships(db);
      const duplicateRows = db.prepare(`
        SELECT matched_value, matched_terms_json
        FROM relationships
        WHERE relationship_type = 'duplicate_of'
      `).all();

      assert.equal(relationships.length, 1);
      assert.equal(duplicateRows.length, 1);
      assert.equal(relationships[0].relationship_type, "duplicate_of");
      assert.equal(relationships[0].note_id, listNotesByEmailId(db, secondEmailId)[0].id);
      assert.equal(relationships[0].related_note_id, firstStoredNote.id);
      assert.deepEqual(relationships[0].overlap_terms, ["ai copilot", "finance", "renewal"]);
      assert.deepEqual(
        JSON.parse(duplicateRows[0].matched_terms_json),
        ["ai copilot", "finance", "renewal"]
      );
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail resolves duplicate_of links to the canonical note across duplicate chains", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_duplicate_chain_1", "{}").lastInsertRowid);
      const secondEmailId = Number(insertEmail.run("msg_duplicate_chain_2", "{}").lastInsertRowid);
      const thirdEmailId = Number(insertEmail.run("msg_duplicate_chain_3", "{}").lastInsertRowid);

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "fact",
          title: "AI copilots grew 42% year over year",
          content: "AI copilots grew 42% year over year across mid-market teams.",
        },
      ]);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "fact",
          title: "Across mid-market teams AI copilots grew 42 percent",
          content: "Across mid market teams, AI copilots grew 42 percent year over year.",
        },
      ]);

      const [firstStoredNote] = listNotesByEmailId(db, firstEmailId);
      const [secondStoredNote] = listNotesByEmailId(db, secondEmailId);

      replaceNotesForEmail(db, thirdEmailId, [
        {
          type: "fact",
          title: "Mid-market teams saw 42 percent copilot growth",
          content: "Across mid market teams, AI copilots grew 42 percent year over year.",
        },
      ]);

      const [thirdStoredNote] = listNotesByEmailId(db, thirdEmailId);
      const duplicateRelationships = listRelationships(db).filter(
        (relationship) => relationship.relationship_type === "duplicate_of"
      );

      assert.equal(duplicateRelationships.length, 2);
      assert.deepEqual(
        duplicateRelationships.map((relationship) => ({
          note_id: relationship.note_id,
          related_note_id: relationship.related_note_id,
        })),
        [
          {
            note_id: secondStoredNote.id,
            related_note_id: firstStoredNote.id,
          },
          {
            note_id: thirdStoredNote.id,
            related_note_id: firstStoredNote.id,
          },
        ]
      );
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail canonicalizes taxonomy labels and aliases to the 13 canonical keys", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_taxonomy_aliases", "{}").lastInsertRowid
      );

      const taxonomyInputs = [
        "Claim",
        "fact",
        "Idea",
        "opinion",
        "Task",
        "question",
        "Opportunity",
        "warning/risk",
        "Tool Update",
        "pattern trend",
        "Contradiction",
        "playbook candidate",
        "preference-candidate",
      ];

      replaceNotesForEmail(
        db,
        emailId,
        taxonomyInputs.map((type, index) => ({
          type,
          title: `Note ${index + 1}`,
          content: `Content ${index + 1}`,
        }))
      );

      const notes = listNotesByEmailId(db, emailId);

      assert.deepEqual(
        notes.map((note) => note.taxonomy_key),
        TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.key)
      );
    } finally {
      db.close();
    }
  });
});

test("storeNoteFeedback persists usefulness feedback and exposes it on hydrated notes", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_note_feedback", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, emailId, [
        {
          type: "idea",
          title: "Review workflow prompts weekly",
          content: "Operators should review workflow prompts every Monday.",
        },
      ]);

      const [storedNote] = listNotesByEmailId(db, emailId);
      const updatedNote = storeNoteFeedback(db, storedNote.id, {
        useful: false,
        comment: "Too generic to keep as a durable note.",
      });

      assert.equal(updatedNote.id, storedNote.id);
      assert.deepEqual(updatedNote.feedback, {
        useful: false,
        comment: "Too generic to keep as a durable note.",
        updated_at: updatedNote.feedback.updated_at,
      });
      assert.match(updatedNote.feedback.updated_at, /^\d{4}-\d{2}-\d{2}T/);

      const [rehydratedNote] = listNotesByEmailId(db, emailId);
      assert.deepEqual(rehydratedNote.feedback, updatedNote.feedback);

      const detailNote = getNoteWithRelationshipsById(db, storedNote.id);
      assert.deepEqual(detailNote.feedback, updatedNote.feedback);
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail auto-detects and refreshes relationships when notes change", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_relationship_auto_1", "{}").lastInsertRowid);
      const secondEmailId = Number(
        insertEmail.run("msg_relationship_auto_2", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Portfolio planning rhythm",
          content: "Founders tightened decision loops across holding companies.",
          topics: ["workflow automation"],
          keywords: ["prompt review cadence"],
        },
      ]);

      const firstStoredNote = listNotesByEmailId(db, firstEmailId)[0];

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "task",
          title: "Assign weekly review owners",
          content: "Operators should assign owners to each Monday checkpoint.",
          topics: ["workflow automation"],
          keywords: ["prompt review cadence"],
        },
      ]);

      let secondStoredNote = listNotesByEmailId(db, secondEmailId)[0];
      let relationships = listRelationships(db);

      assert.equal(relationships.length, 2);
      assert.deepEqual(
        relationships.map((relationship) => relationship.overlap_basis),
        ["keyword", "topic"]
      );
      assert.ok(relationships[0].overlap_terms.includes("prompt review cadence"));
      assert.deepEqual(relationships[1].overlap_terms, ["workflow automation"]);
      assert.equal(relationships[0].note_id, firstStoredNote.id);
      assert.equal(relationships[0].related_note_id, secondStoredNote.id);
      assert.equal(relationships[1].note_id, firstStoredNote.id);
      assert.equal(relationships[1].related_note_id, secondStoredNote.id);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "task",
          title: "Set staffing roster",
          content: "Operators should map on-call coverage for each Monday checkpoint.",
          topics: ["workflow automation"],
          keywords: ["staff matrix"],
        },
      ]);

      secondStoredNote = listNotesByEmailId(db, secondEmailId)[0];
      relationships = listRelationships(db);

      assert.equal(relationships.length, 1);
      assert.equal(relationships[0].overlap_basis, "topic");
      assert.deepEqual(relationships[0].overlap_terms, ["workflow automation"]);
      assert.equal(relationships[0].note_id, firstStoredNote.id);
      assert.equal(relationships[0].related_note_id, secondStoredNote.id);
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail links notes by derived overlap even when explicit keywords do not match", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(
        insertEmail.run("msg_relationship_derived_1", "{}").lastInsertRowid
      );
      const secondEmailId = Number(
        insertEmail.run("msg_relationship_derived_2", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "AI copilots improve finance renewals",
          content: "AI copilots improve renewals for finance operators this quarter.",
          keywords: ["workflow audit"],
        },
      ]);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "pattern_trend",
          title: "Finance teams expand AI copilot coverage",
          content: "Finance operators are expanding AI copilots to improve renewals.",
          keywords: ["staff handoff"],
        },
      ]);

      const relationships = listRelationships(db);

      assert.equal(relationships.length, 1);
      assert.equal(relationships[0].relationship_type, "shared_keyword");
      assert.equal(relationships[0].overlap_basis, "keyword");
      assert.ok(relationships[0].overlap_terms.includes("ai copilot"));
      assert.ok(relationships[0].overlap_terms.includes("finance operator"));
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail links overlapping notes created within the same email", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_relationship_same_email", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, emailId, [
        {
          type: "idea",
          title: "Formalize workflow reviews",
          content: "Operators are formalizing workflow reviews across finance teams.",
          topics: ["workflow automation"],
          keywords: ["prompt review cadence"],
        },
        {
          type: "task",
          title: "Run a Monday review cadence",
          content: "Assign owners to each workflow review and keep the cadence every Monday.",
          topics: ["workflow automation"],
          keywords: ["prompt review cadence"],
        },
        {
          type: "fact",
          title: "Warehouse rents rose",
          content: "Warehouse rents rose again in Phoenix this quarter.",
          topics: ["industrial real estate"],
          keywords: ["warehouse lease"],
        },
      ]);

      const storedNotes = listNotesByEmailId(db, emailId);
      const relationships = listRelationships(db);

      assert.equal(relationships.length, 2);
      assert.deepEqual(
        relationships.map((relationship) => relationship.overlap_basis),
        ["keyword", "topic"]
      );
      assert.equal(relationships[0].note_id, storedNotes[0].id);
      assert.equal(relationships[0].related_note_id, storedNotes[1].id);
      assert.equal(relationships[1].note_id, storedNotes[0].id);
      assert.equal(relationships[1].related_note_id, storedNotes[1].id);
      assert.ok(relationships[0].overlap_terms.includes("prompt review cadence"));
      assert.deepEqual(relationships[1].overlap_terms, ["workflow automation"]);
    } finally {
      db.close();
    }
  });
});

test("replaceNotesForEmail persists one topic link for mirrored note pairs and skips self-links", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_relationship_topic_guards", "{}").lastInsertRowid
      );

      replaceNotesForEmail(
        db,
        emailId,
        [
          {
            type: "idea",
            title: "Simplify portfolio approvals",
            content: "Leadership simplified approvals across the portfolio.",
          },
          {
            type: "task",
            title: "Assign Monday checkpoint owners",
            content: "Assign a single owner to each Monday checkpoint.",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              relatedNoteIndex: 1,
              overlapBasis: "topic",
              sharedTopics: ["workflow automation"],
              score: 3,
            },
            {
              newNoteIndex: 1,
              relatedNoteIndex: 0,
              overlapBasis: "topic",
              sharedTopics: ["workflow automation"],
              score: 3,
            },
            {
              newNoteIndex: 1,
              relatedNoteIndex: 1,
              overlapBasis: "topic",
              sharedTopics: ["workflow automation"],
              score: 3,
            },
          ],
        }
      );

      const storedNotes = listNotesByEmailId(db, emailId);
      const relationships = listRelationships(db);

      assert.equal(relationships.length, 1);
      assert.equal(relationships[0].overlap_basis, "topic");
      assert.equal(relationships[0].note_id, storedNotes[0].id);
      assert.equal(relationships[0].related_note_id, storedNotes[1].id);
      assert.deepEqual(relationships[0].overlap_terms, ["workflow automation"]);
    } finally {
      db.close();
    }
  });
});

test("openDatabaseConnection initializes the SQLite schema on first run", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db, schemaVersion, taxonomyTypeCount } = await openDatabaseConnection({
      databasePath,
    });

    try {
      assert.ok(schemaVersion >= 23);
      assert.equal(taxonomyTypeCount, 13);

      const tables = db
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'taxonomy_types',
              'emails',
              'notes',
              'relationships',
              'email_processing_jobs',
              'raw_emails',
              'sources',
              'digests'
            )
          ORDER BY name ASC
        `)
        .all()
        .map((row) => row.name);

      assert.deepEqual(tables, [
        "digests",
        "email_processing_jobs",
        "emails",
        "notes",
        "raw_emails",
        "relationships",
        "sources",
        "taxonomy_types",
      ]);

      const taxonomyCount = db.prepare("SELECT COUNT(*) AS count FROM taxonomy_types").get().count;
      assert.equal(taxonomyCount, 13);

      const sourceColumns = db
        .prepare("PRAGMA table_info(sources)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(sourceColumns, [
        "id",
        "sender_address",
        "display_name",
        "email_count",
        "first_seen_at",
        "last_seen_at",
        "created_at",
        "updated_at",
      ]);

      const digestColumns = db
        .prepare("PRAGMA table_info(digests)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(digestColumns, [
        "id",
        "range_start",
        "range_end",
        "digest_text",
        "generated_at",
      ]);
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase adds digests to existing schema version 22 databases and enforces unique digest ranges", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        PRAGMA user_version = 22;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 23);

    const { db: migratedDb } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      const digestColumns = migratedDb
        .prepare("PRAGMA table_info(digests)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(digestColumns, [
        "id",
        "range_start",
        "range_end",
        "digest_text",
        "generated_at",
      ]);

      const insertDigest = migratedDb.prepare(`
        INSERT INTO digests (
          range_start,
          range_end,
          digest_text,
          generated_at
        )
        VALUES (?, ?, ?, ?)
      `);

      insertDigest.run(
        "2026-03-01",
        "2026-03-07",
        "Weekly digest content",
        "2026-03-08T12:00:00.000Z"
      );

      assert.throws(
        () =>
          insertDigest.run(
            "2026-03-01",
            "2026-03-07",
            "Replacement weekly digest content",
            "2026-03-08T13:00:00.000Z"
          ),
        /UNIQUE constraint failed: digests\.range_start, digests\.range_end/
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("listSources returns persisted source rows with stored counts and last-seen timestamps", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      db.prepare(`
        INSERT INTO sources (
          sender_address,
          display_name,
          email_count,
          first_seen_at,
          last_seen_at
        )
        VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
      `).run(
        "editor@example.com",
        "Signals Weekly",
        4,
        "2026-03-08 17:00:05",
        "2026-03-10 18:00:05",
        "briefs@example.com",
        "Research Brief",
        1,
        "2026-03-09 17:30:05",
        "2026-03-09 17:30:05"
      );

      assert.deepEqual(listSources(db), [
        {
          sender_address: "editor@example.com",
          email_count: 4,
          last_seen_at: "2026-03-10T18:00:05Z",
        },
        {
          sender_address: "briefs@example.com",
          email_count: 1,
          last_seen_at: "2026-03-09T17:30:05Z",
        },
      ]);
    } finally {
      db.close();
    }
  });
});

test("getEmailIngestionSummary returns processed and skipped totals from terminal email statuses", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      db.prepare(`
        INSERT INTO emails (
          agentmail_message_id,
          raw_payload,
          ingestion_status
        )
        VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)
      `).run(
        "msg_ingestion_summary_1",
        "{}",
        "processed",
        "msg_ingestion_summary_2",
        "{}",
        "processed",
        "msg_ingestion_summary_3",
        "{}",
        "skipped",
        "msg_ingestion_summary_4",
        "{}",
        "failed",
        "msg_ingestion_summary_5",
        "{}",
        "received"
      );

      assert.deepEqual(getEmailIngestionSummary(db), {
        processed_email_count: 2,
        skipped_email_count: 1,
        total_classified_email_count: 3,
      });
    } finally {
      db.close();
    }
  });
});

test("getEmailIngestionSummary returns zero counts when no emails exist", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      assert.deepEqual(getEmailIngestionSummary(db), {
        processed_email_count: 0,
        skipped_email_count: 0,
        total_classified_email_count: 0,
      });
    } finally {
      db.close();
    }
  });
});

test("listTaxonomyTypeCounts returns all 13 taxonomy types with grouped note totals", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_taxonomy_counts_1", "{}").lastInsertRowid
      );
      const secondEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_taxonomy_counts_2", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Finance teams standardize copilots",
          content: "Finance teams are standardizing AI copilots across renewals.",
        },
        {
          type: "warning_risk",
          title: "Unchecked prompt drift",
          content: "Unchecked prompt drift can quietly degrade output quality.",
        },
      ]);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "idea",
          title: "Operators adopt weekly reviews",
          content: "Operators are adopting a weekly review cadence for agents.",
        },
        {
          type: "fact",
          title: "Copilot revenue grew 42%",
          content: "AI copilot revenue grew 42% year over year.",
        },
      ]);

      const counts = listTaxonomyTypeCounts(db);
      const countsByKey = new Map(
        counts.map((taxonomyTypeCount) => [taxonomyTypeCount.taxonomy_key, taxonomyTypeCount])
      );

      assert.equal(counts.length, TAXONOMY_TYPES.length);
      assert.deepEqual(
        counts.map((taxonomyTypeCount) => taxonomyTypeCount.taxonomy_key),
        TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.key)
      );
      assert.deepEqual(
        counts.map((taxonomyTypeCount) => taxonomyTypeCount.label),
        TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.label)
      );
      assert.deepEqual(countsByKey.get("idea"), {
        taxonomy_key: "idea",
        label: "Idea",
        note_count: 2,
      });
      assert.deepEqual(countsByKey.get("fact"), {
        taxonomy_key: "fact",
        label: "Fact",
        note_count: 1,
      });
      assert.deepEqual(countsByKey.get("warning_risk"), {
        taxonomy_key: "warning_risk",
        label: "Warning/Risk",
        note_count: 1,
      });
      assert.deepEqual(countsByKey.get("claim"), {
        taxonomy_key: "claim",
        label: "Claim",
        note_count: 0,
      });
      assert.deepEqual(countsByKey.get("tool_update"), {
        taxonomy_key: "tool_update",
        label: "Tool Update",
        note_count: 0,
      });
    } finally {
      db.close();
    }
  });
});

test("getDailyDigest groups a selected day into per-type sections across the full taxonomy", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_daily_digest_1", "{}").lastInsertRowid
      );
      const secondEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_daily_digest_2", "{}").lastInsertRowid
      );
      const thirdEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_daily_digest_3", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Morning workflow insight",
          content: "Teams are auditing workflow prompts every morning.",
          summary: "Morning prompt audits are becoming routine.",
          sourceTimestamp: "2026-03-09T08:15:00Z",
        },
      ]);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "fact",
          title: "Automation teams reduced manual tagging",
          content: "Automation teams reduced manual tagging in the evening batch.",
          summary: "Manual tagging fell in the latest evening batch.",
          sourceTimestamp: "2026-03-09T21:45:00Z",
        },
      ]);

      replaceNotesForEmail(db, thirdEmailId, [
        {
          type: "tool_update",
          title: "Tooling dashboard shipped overnight",
          content: "A new tooling dashboard shipped overnight for operators.",
          summary: "Operators have a new dashboard.",
          sourceTimestamp: "2026-03-10T06:30:00Z",
        },
      ]);

      const digest = getDailyDigest(db, "2026-03-09");
      const sectionsByKey = new Map(
        digest.sections.map((section) => [section.taxonomy_key, section])
      );

      assert.equal(digest.date, "2026-03-09");
      assert.equal(digest.total_notes, 2);
      assert.equal(
        digest.summary,
        "Manual tagging fell in the latest evening batch. Morning prompt audits are becoming routine."
      );
      assert.equal(digest.sections.length, TAXONOMY_TYPES.length);
      assert.deepEqual(
        digest.sections.map((section) => section.taxonomy_key),
        TAXONOMY_TYPES.map((taxonomyType) => taxonomyType.key)
      );
      assert.equal(sectionsByKey.get("idea").note_count, 1);
      assert.equal(sectionsByKey.get("idea").label, "Idea");
      assert.equal(
        sectionsByKey.get("idea").summary,
        "Morning prompt audits are becoming routine."
      );
      assert.equal(sectionsByKey.get("idea").notes[0].title, "Morning workflow insight");
      assert.equal(sectionsByKey.get("fact").note_count, 1);
      assert.equal(
        sectionsByKey.get("fact").summary,
        "Manual tagging fell in the latest evening batch."
      );
      assert.equal(
        sectionsByKey.get("fact").notes[0].title,
        "Automation teams reduced manual tagging"
      );
      assert.equal(sectionsByKey.get("tool_update").note_count, 0);
      assert.equal(sectionsByKey.get("tool_update").summary, null);
      assert.deepEqual(sectionsByKey.get("tool_update").notes, []);
      assert.equal(sectionsByKey.get("claim").note_count, 0);
      assert.equal(sectionsByKey.get("claim").summary, null);
      assert.deepEqual(sectionsByKey.get("claim").notes, []);
    } finally {
      db.close();
    }
  });
});

test("getDailyDigest highlights the day's top shared themes from topics and keywords", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_daily_theme_1", "{}").lastInsertRowid);
      const secondEmailId = Number(insertEmail.run("msg_daily_theme_2", "{}").lastInsertRowid);
      const thirdEmailId = Number(insertEmail.run("msg_daily_theme_3", "{}").lastInsertRowid);
      const nextDayEmailId = Number(insertEmail.run("msg_daily_theme_4", "{}").lastInsertRowid);

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Workflow audits are becoming a routine",
          content: "Teams are standardizing workflow audits before launch.",
          summary: "Workflow audits are becoming routine.",
          sourceTimestamp: "2026-03-09T08:15:00Z",
          topics: ["workflow automation"],
          keywords: ["prompt audit", "ops"],
        },
      ]);
      const [firstNote] = listNotesByEmailId(db, firstEmailId);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "fact",
          title: "Operators formalized workflow automation reviews",
          content: "Operators formalized workflow automation reviews this afternoon.",
          summary: "Workflow automation reviews were formalized.",
          sourceTimestamp: "2026-03-09T12:30:00Z",
          topics: ["workflow automation"],
          keywords: ["finance"],
        },
      ]);
      const [secondNote] = listNotesByEmailId(db, secondEmailId);

      replaceNotesForEmail(db, thirdEmailId, [
        {
          type: "task",
          title: "Run the prompt audit checklist",
          content: "Run the prompt audit checklist before tonight's deployment.",
          summary: "Run the prompt audit checklist before deployment.",
          sourceTimestamp: "2026-03-09T18:45:00Z",
          keywords: ["prompt audit", "checklist"],
        },
      ]);
      const [thirdNote] = listNotesByEmailId(db, thirdEmailId);

      replaceNotesForEmail(db, nextDayEmailId, [
        {
          type: "tool_update",
          title: "Next-day workflow automation update",
          content: "Workflow automation shipped a next-day dashboard update.",
          summary: "Workflow automation shipped a next-day dashboard update.",
          sourceTimestamp: "2026-03-10T06:30:00Z",
          topics: ["workflow automation"],
          keywords: ["prompt audit"],
        },
      ]);

      const digest = getDailyDigest(db, {
        date: "2026-03-09",
        topThemeLimit: 3,
      });

      assert.deepEqual(digest.top_themes, [
        {
          theme: "workflow automation",
          source: "topic",
          note_count: 2,
          note_ids: [firstNote.id, secondNote.id],
        },
        {
          theme: "prompt audit",
          source: "keyword",
          note_count: 2,
          note_ids: [firstNote.id, thirdNote.id],
        },
      ]);
    } finally {
      db.close();
    }
  });
});

test("getDailyDigest reuses an existing persisted digest for the same date instead of regenerating a duplicate", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const firstEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_daily_digest_reuse_1", "{}").lastInsertRowid
      );
      const secondEmailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_daily_digest_reuse_2", "{}").lastInsertRowid
      );

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "idea",
          title: "Morning workflow insight",
          content: "Teams are auditing workflow prompts every morning.",
          summary: "Morning prompt audits are becoming routine.",
          sourceTimestamp: "2026-03-09T08:15:00Z",
        },
      ]);

      replaceNotesForEmail(db, secondEmailId, [
        {
          type: "fact",
          title: "Automation teams reduced manual tagging",
          content: "Automation teams reduced manual tagging in the evening batch.",
          summary: "Manual tagging fell in the latest evening batch.",
          sourceTimestamp: "2026-03-09T21:45:00Z",
        },
      ]);

      const firstDigest = getDailyDigest(db, "2026-03-09");
      const storedDigestBeforeReuse = db.prepare(`
        SELECT range_start, range_end, digest_text
        FROM digests
        WHERE range_start = ?
          AND range_end = ?
      `).get("2026-03-09", "2026-03-09");

      assert.equal(
        firstDigest.summary,
        "Manual tagging fell in the latest evening batch. Morning prompt audits are becoming routine."
      );
      assert.deepEqual({ ...storedDigestBeforeReuse }, {
        range_start: "2026-03-09",
        range_end: "2026-03-09",
        digest_text:
          "Manual tagging fell in the latest evening batch. Morning prompt audits are becoming routine.",
      });

      db.prepare(`
        UPDATE digests
        SET digest_text = ?
        WHERE range_start = ?
          AND range_end = ?
      `).run(
        "Persisted digest text should be reused as-is.",
        "2026-03-09",
        "2026-03-09"
      );

      const secondDigest = getDailyDigest(db, "2026-03-09");
      const digestRowCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM digests
        WHERE range_start = ?
          AND range_end = ?
      `).get("2026-03-09", "2026-03-09");

      assert.equal(secondDigest.summary, "Persisted digest text should be reused as-is.");
      assert.equal(digestRowCount.count, 1);
    } finally {
      db.close();
    }
  });
});

test("getDailyDigest highlights ranked action items derived from that day's notes", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const firstEmailId = Number(insertEmail.run("msg_daily_action_1", "{}").lastInsertRowid);
      const secondEmailId = Number(insertEmail.run("msg_daily_action_2", "{}").lastInsertRowid);
      const thirdEmailId = Number(insertEmail.run("msg_daily_action_3", "{}").lastInsertRowid);
      const fourthEmailId = Number(insertEmail.run("msg_daily_action_4", "{}").lastInsertRowid);
      const nextDayEmailId = Number(insertEmail.run("msg_daily_action_5", "{}").lastInsertRowid);

      replaceNotesForEmail(db, firstEmailId, [
        {
          type: "task",
          title: "Review prompt audit backlog",
          content: "Review the prompt audit backlog before the daily launch.",
          summary: "Review the prompt audit backlog before the daily launch.",
          sourceTimestamp: "2026-03-09T09:00:00Z",
          confidence: 0.92,
          keywords: ["prompt audit", "ops"],
        },
      ]);
      const [taskNote] = listNotesByEmailId(db, firstEmailId);

      replaceNotesForEmail(
        db,
        secondEmailId,
        [
          {
            type: "playbook_candidate",
            title: "Codify a weekly audit checklist",
            content: "Create a reusable weekly prompt audit checklist for operators.",
            summary: "Create a reusable weekly prompt audit checklist.",
            sourceTimestamp: "2026-03-09T10:15:00Z",
            confidence: 0.8,
            keywords: ["prompt audit", "checklist"],
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: taskNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["prompt audit"],
              score: 1,
            },
          ],
        }
      );
      const [playbookNote] = listNotesByEmailId(db, secondEmailId);
      const feedbackNote = storeNoteFeedback(db, playbookNote.id, {
        useful: true,
        comment: "Worth operationalizing",
      });

      replaceNotesForEmail(db, thirdEmailId, [
        {
          type: "opportunity",
          title: "Pilot the finance renewal copilot",
          content: "Pilot the finance renewal copilot with one renewals pod.",
          summary: "Pilot the finance renewal copilot with one renewals pod.",
          sourceTimestamp: "2026-03-09T11:30:00Z",
          confidence: 0.74,
          keywords: ["finance", "pilot"],
        },
      ]);

      replaceNotesForEmail(db, fourthEmailId, [
        {
          type: "fact",
          title: "Manual tagging fell in the latest evening batch",
          content: "Automation teams reduced manual tagging in the evening batch.",
          summary: "Manual tagging fell in the latest evening batch.",
          sourceTimestamp: "2026-03-09T21:45:00Z",
          confidence: 0.82,
          keywords: ["automation", "tagging"],
        },
      ]);

      replaceNotesForEmail(db, nextDayEmailId, [
        {
          type: "task",
          title: "Review the next-day tooling launch checklist",
          content: "Review the next-day tooling launch checklist before rollout.",
          summary: "Review the next-day tooling launch checklist before rollout.",
          sourceTimestamp: "2026-03-10T06:30:00Z",
          confidence: 0.88,
          keywords: ["launch", "tooling"],
        },
      ]);

      const digest = getDailyDigest(db, {
        date: "2026-03-09",
        actionItemLimit: 3,
      });

      assert.deepEqual(
        digest.action_items.map((note) => ({
          title: note.title,
          taxonomy_key: note.taxonomy_key,
        })),
        [
          {
            title: "Review prompt audit backlog",
            taxonomy_key: "task",
          },
          {
            title: "Codify a weekly audit checklist",
            taxonomy_key: "playbook_candidate",
          },
          {
            title: "Pilot the finance renewal copilot",
            taxonomy_key: "opportunity",
          },
        ]
      );
      assert.ok(digest.action_items[0].connection_count >= 1);
      assert.ok(digest.action_items[1].connection_count >= 1);
      assert.equal(digest.action_items[1].feedback?.useful, true);
      assert.equal(digest.action_items[1].feedback?.comment, "Worth operationalizing");
      assert.equal(
        digest.action_items[1].feedback?.updated_at,
        feedbackNote.feedback.updated_at
      );
      assert.ok(digest.action_items[0].keywords.includes("prompt audit"));
      assert.ok(digest.action_items[0].keywords.includes("ops"));
      assert.equal(
        digest.action_items.some(
          (note) => note.title === "Review the next-day tooling launch checklist"
        ),
        false
      );
    } finally {
      db.close();
    }
  });
});

test("listMostConnectedNotes ranks notes by distinct linked neighbors and caps results at five", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailIds = Array.from({ length: 5 }, (_, index) =>
        Number(
          db.prepare(`
            INSERT INTO emails (agentmail_message_id, raw_payload)
            VALUES (?, ?)
          `).run(`msg_most_connected_${index + 1}`, "{}").lastInsertRowid
        )
      );

      replaceNotesForEmail(db, emailIds[0], [
        {
          type: "idea",
          title: "Finance teams standardize on AI copilots",
          content: "Finance teams are standardizing on AI copilots for renewals.",
          summary: "AI copilots are becoming standard in finance renewals.",
          sourceTimestamp: "2026-03-09T17:00:00Z",
        },
      ]);
      const [firstNote] = listNotesByEmailId(db, emailIds[0]);

      replaceNotesForEmail(
        db,
        emailIds[1],
        [
          {
            type: "fact",
            title: "AI copilots expand renewal efficiency",
            content: "AI copilots cut manual renewal work for finance teams.",
            summary: "Finance renewal work is becoming more efficient.",
            sourceTimestamp: "2026-03-09T17:01:00Z",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["finance"],
              score: 1,
            },
          ],
        }
      );
      const [secondNote] = listNotesByEmailId(db, emailIds[1]);

      replaceNotesForEmail(
        db,
        emailIds[2],
        [
          {
            type: "tool_update",
            title: "Vendor ships a finance copilot dashboard",
            content: "A vendor shipped a dashboard for finance copilot teams.",
            summary: "A finance-focused dashboard is now available.",
            sourceTimestamp: "2026-03-09T17:02:00Z",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["finance"],
              score: 1,
            },
            {
              newNoteIndex: 0,
              existingNoteId: secondNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["renewal"],
              score: 1,
            },
          ],
        }
      );
      const [thirdNote] = listNotesByEmailId(db, emailIds[2]);

      replaceNotesForEmail(
        db,
        emailIds[3],
        [
          {
            type: "pattern_trend",
            title: "Renewal workflows consolidate around copilots",
            content: "Renewal workflows are consolidating around copilots.",
            summary: "Copilot-led renewal workflows are consolidating.",
            sourceTimestamp: "2026-03-09T17:03:00Z",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["copilot"],
              score: 1,
            },
            {
              newNoteIndex: 0,
              existingNoteId: secondNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["renewal"],
              score: 1,
            },
          ],
        }
      );
      const [fourthNote] = listNotesByEmailId(db, emailIds[3]);

      replaceNotesForEmail(
        db,
        emailIds[4],
        [
          {
            type: "warning_risk",
            title: "Compliance reviews lag behind finance copilots",
            content: "Compliance reviews are lagging behind finance copilots.",
            summary: "Compliance review is trailing adoption.",
            sourceTimestamp: "2026-03-09T17:04:00Z",
          },
        ],
        {
          detectedRelationships: [
            {
              newNoteIndex: 0,
              existingNoteId: firstNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["finance"],
              score: 1,
            },
            {
              newNoteIndex: 0,
              existingNoteId: thirdNote.id,
              relationshipType: "shared_keyword",
              sharedKeywords: ["dashboard"],
              score: 1,
            },
          ],
        }
      );
      const [fifthNote] = listNotesByEmailId(db, emailIds[4]);

      assert.deepEqual(listMostConnectedNotes(db), [
        {
          id: firstNote.id,
          email_id: emailIds[0],
          taxonomy_key: "idea",
          title: "Finance teams standardize on AI copilots",
          body: "Finance teams are standardizing on AI copilots for renewals.",
          summary: "AI copilots are becoming standard in finance renewals.",
          source_excerpt: null,
          source_timestamp: "2026-03-09T17:00:00Z",
          confidence: null,
          classification_confidence: null,
          classificationConfidence: null,
          created_at: firstNote.created_at,
          updated_at: firstNote.updated_at,
          connection_count: 4,
        },
        {
          id: thirdNote.id,
          email_id: emailIds[2],
          taxonomy_key: "tool_update",
          title: "Vendor ships a finance copilot dashboard",
          body: "A vendor shipped a dashboard for finance copilot teams.",
          summary: "A finance-focused dashboard is now available.",
          source_excerpt: null,
          source_timestamp: "2026-03-09T17:02:00Z",
          confidence: null,
          classification_confidence: null,
          classificationConfidence: null,
          created_at: thirdNote.created_at,
          updated_at: thirdNote.updated_at,
          connection_count: 3,
        },
        {
          id: secondNote.id,
          email_id: emailIds[1],
          taxonomy_key: "fact",
          title: "AI copilots expand renewal efficiency",
          body: "AI copilots cut manual renewal work for finance teams.",
          summary: "Finance renewal work is becoming more efficient.",
          source_excerpt: null,
          source_timestamp: "2026-03-09T17:01:00Z",
          confidence: null,
          classification_confidence: null,
          classificationConfidence: null,
          created_at: secondNote.created_at,
          updated_at: secondNote.updated_at,
          connection_count: 3,
        },
        {
          id: fifthNote.id,
          email_id: emailIds[4],
          taxonomy_key: "warning_risk",
          title: "Compliance reviews lag behind finance copilots",
          body: "Compliance reviews are lagging behind finance copilots.",
          summary: "Compliance review is trailing adoption.",
          source_excerpt: null,
          source_timestamp: "2026-03-09T17:04:00Z",
          confidence: null,
          classification_confidence: null,
          classificationConfidence: null,
          created_at: fifthNote.created_at,
          updated_at: fifthNote.updated_at,
          connection_count: 2,
        },
        {
          id: fourthNote.id,
          email_id: emailIds[3],
          taxonomy_key: "pattern_trend",
          title: "Renewal workflows consolidate around copilots",
          body: "Renewal workflows are consolidating around copilots.",
          summary: "Copilot-led renewal workflows are consolidating.",
          source_excerpt: null,
          source_timestamp: "2026-03-09T17:03:00Z",
          confidence: null,
          classification_confidence: null,
          classificationConfidence: null,
          created_at: fourthNote.created_at,
          updated_at: fourthNote.updated_at,
          connection_count: 2,
        },
      ]);
    } finally {
      db.close();
    }
  });
});

test("listMostConnectedNotes keeps sparse notes in the result set with a zero connection count", async () => {
  await withTempDatabase(async (databasePath) => {
    await initializeDatabase({ databasePath });
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const insertEmail = db.prepare(`
        INSERT INTO emails (agentmail_message_id, raw_payload)
        VALUES (?, ?)
      `);
      const insertNote = db.prepare(`
        INSERT INTO notes (
          email_id,
          taxonomy_key,
          title,
          body,
          summary,
          source_timestamp,
          confidence,
          classification_confidence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const firstEmailId = Number(insertEmail.run("msg_sparse_top_1", "{}").lastInsertRowid);
      const secondEmailId = Number(insertEmail.run("msg_sparse_top_2", "{}").lastInsertRowid);
      const firstNoteId = Number(
        insertNote.run(
          firstEmailId,
          "fact",
          "Older sparse note",
          "Older sparse body",
          "Older sparse summary",
          "2026-03-10T12:00:00Z",
          0.61,
          0.61
        ).lastInsertRowid
      );
      const secondNoteId = Number(
        insertNote.run(
          secondEmailId,
          "idea",
          "Newer sparse note",
          "Newer sparse body",
          "Newer sparse summary",
          "2026-03-11T12:00:00Z",
          0.72,
          0.72
        ).lastInsertRowid
      );

      const mostConnectedNotes = listMostConnectedNotes(db);

      assert.deepEqual(
        mostConnectedNotes.map((note) => ({
          id: note.id,
          title: note.title,
          connection_count: note.connection_count,
        })),
        [
          {
            id: secondNoteId,
            title: "Newer sparse note",
            connection_count: 0,
          },
          {
            id: firstNoteId,
            title: "Older sparse note",
            connection_count: 0,
          },
        ]
      );
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase expands the raw_emails store on a legacy schema", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE webhook_deliveries (
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

        PRAGMA user_version = 6;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 10);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const columns = migratedDb
        .prepare("PRAGMA table_info(raw_emails)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(columns, [
        "id",
        "webhook_delivery_id",
        "provider",
        "delivery_id",
        "event_type",
        "agentmail_message_id",
        "raw_payload",
        "received_at",
        "agentmail_inbox_id",
        "message_id_header",
        "subject",
        "from_name",
        "from_address",
        "sender_address",
        "sent_at",
        "created_at",
        "updated_at",
        "text_content",
        "html_content",
      ]);
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase expands webhook_deliveries with receipt metadata on a legacy schema", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    const payload = JSON.stringify({
      event_id: "evt_legacy_webhook_1",
      event_type: "message.received",
      message: {
        message_id: "msg_legacy_webhook_1",
      },
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE webhook_deliveries (
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

        INSERT INTO webhook_deliveries (
          delivery_id,
          event_type,
          payload,
          status,
          received_at
        )
        VALUES (
          'svix-legacy-webhook-1',
          'message.received',
          '${payload.replace(/'/g, "''")}',
          'stored',
          '2026-03-09 17:00:05'
        );

        PRAGMA user_version = 9;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 10);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const columns = migratedDb
        .prepare("PRAGMA table_info(webhook_deliveries)")
        .all()
        .map((column) => column.name);

      assert.deepEqual(columns, [
        "id",
        "provider",
        "delivery_id",
        "event_id",
        "event_type",
        "webhook_path",
        "content_type",
        "body_bytes",
        "payload_sha256",
        "headers_json",
        "svix_signature",
        "svix_timestamp",
        "user_agent",
        "source_ip",
        "payload",
        "status",
        "received_at",
        "processed_at",
        "error_message",
      ]);

      const delivery = migratedDb.prepare(`
        SELECT
          delivery_id,
          event_id,
          event_type,
          body_bytes,
          payload_sha256,
          headers_json,
          payload,
          status,
          received_at
        FROM webhook_deliveries
        WHERE delivery_id = 'svix-legacy-webhook-1'
      `).get();

      assert.deepEqual(
        {
          delivery_id: delivery.delivery_id,
          event_id: delivery.event_id,
          event_type: delivery.event_type,
          body_bytes: delivery.body_bytes,
          payload_sha256: delivery.payload_sha256,
          headers_json: delivery.headers_json,
          payload: delivery.payload,
          status: delivery.status,
          received_at: delivery.received_at,
        },
        {
          delivery_id: "svix-legacy-webhook-1",
          event_id: "evt_legacy_webhook_1",
          event_type: "message.received",
          body_bytes: Buffer.byteLength(payload, "utf8"),
          payload_sha256: createHash("sha256").update(payload).digest("hex"),
          headers_json: "{}",
          payload,
          status: "stored",
          received_at: "2026-03-09 17:00:05",
        }
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("storeAgentMailWebhookDelivery persists an enriched raw_emails row", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const payload = {
        event_id: "evt_raw_email_1",
        event_type: "message.received",
        message: {
          message_id: "msg_raw_email_1",
          inbox_id: "inbox_news",
          subject: "Raw payload capture",
          from: "Signals Weekly <editor@example.com>",
          timestamp: "2026-03-09T17:00:00Z",
          extracted_text: "Capture the raw AgentMail webhook before processing.",
          headers: {
            "message-id": "<msg_raw_email_1@example.com>",
          },
        },
        thread: {
          inbox_id: "inbox_news",
          subject: "Raw payload capture",
          received_timestamp: "2026-03-09T17:00:05Z",
        },
      };
      const rawPayload = JSON.stringify(payload);
      const headers = {
        "content-type": "application/json; charset=utf-8",
        "svix-id": "svix-raw-email-1",
        "svix-signature": "v1,test-signature",
        "svix-timestamp": "1710000000",
        "user-agent": "AgentMail-Test/1.0",
        "x-forwarded-for": "203.0.113.10, 203.0.113.11",
      };
      const result = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-raw-email-1",
        eventType: payload.event_type,
        rawPayload,
        payload,
        receipt: {
          webhookPath: "/webhooks/agentmail",
          headers,
          contentType: headers["content-type"],
          userAgent: headers["user-agent"],
          signature: headers["svix-signature"],
          timestamp: headers["svix-timestamp"],
          sourceIp: "203.0.113.10",
          bodyBytes: Buffer.byteLength(rawPayload, "utf8"),
        },
      });

      const rawEmail = db.prepare(`
        SELECT
          id,
          webhook_delivery_id,
          provider,
          delivery_id,
          event_type,
          agentmail_message_id,
          agentmail_inbox_id,
          message_id_header,
          subject,
          from_name,
          from_address,
          sender_address,
          sent_at,
          received_at,
          text_content,
          raw_payload,
          created_at,
          updated_at
        FROM raw_emails
        ORDER BY id DESC
        LIMIT 1
      `).get();
      const delivery = db.prepare(`
        SELECT
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
        FROM webhook_deliveries
        WHERE id = ?
      `).get(result.webhookDeliveryId);

      assert.deepEqual(
        {
          id: rawEmail.id,
          webhook_delivery_id: rawEmail.webhook_delivery_id,
          provider: rawEmail.provider,
          delivery_id: rawEmail.delivery_id,
          event_type: rawEmail.event_type,
          agentmail_message_id: rawEmail.agentmail_message_id,
          agentmail_inbox_id: rawEmail.agentmail_inbox_id,
          message_id_header: rawEmail.message_id_header,
          subject: rawEmail.subject,
          from_name: rawEmail.from_name,
          from_address: rawEmail.from_address,
          sender_address: rawEmail.sender_address,
          sent_at: rawEmail.sent_at,
          text_content: rawEmail.text_content,
          raw_payload: rawEmail.raw_payload,
        },
        {
          id: result.rawEmailId,
          webhook_delivery_id: result.webhookDeliveryId,
          provider: "agentmail",
          delivery_id: "svix-raw-email-1",
          event_type: "message.received",
          agentmail_message_id: "msg_raw_email_1",
          agentmail_inbox_id: "inbox_news",
          message_id_header: "<msg_raw_email_1@example.com>",
          subject: "Raw payload capture",
          from_name: "Signals Weekly",
          from_address: "editor@example.com",
          sender_address: "editor@example.com",
          sent_at: "2026-03-09T17:00:00Z",
          text_content: "Capture the raw AgentMail webhook before processing.",
          raw_payload: rawPayload,
        }
      );
      assert.equal(rawEmail.received_at, "2026-03-09T17:00:05Z");
      assert.match(rawEmail.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.match(rawEmail.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.deepEqual(
        {
          delivery_id: delivery.delivery_id,
          event_id: delivery.event_id,
          event_type: delivery.event_type,
          webhook_path: delivery.webhook_path,
          content_type: delivery.content_type,
          body_bytes: delivery.body_bytes,
          payload_sha256: delivery.payload_sha256,
          headers_json: JSON.parse(delivery.headers_json),
          svix_signature: delivery.svix_signature,
          svix_timestamp: delivery.svix_timestamp,
          user_agent: delivery.user_agent,
          source_ip: delivery.source_ip,
          payload: delivery.payload,
          status: delivery.status,
        },
        {
          delivery_id: "svix-raw-email-1",
          event_id: "evt_raw_email_1",
          event_type: "message.received",
          webhook_path: "/webhooks/agentmail",
          content_type: "application/json; charset=utf-8",
          body_bytes: Buffer.byteLength(rawPayload, "utf8"),
          payload_sha256: createHash("sha256").update(rawPayload).digest("hex"),
          headers_json: headers,
          svix_signature: "v1,test-signature",
          svix_timestamp: "1710000000",
          user_agent: "AgentMail-Test/1.0",
          source_ip: "203.0.113.10",
          payload: rawPayload,
          status: "stored",
        }
      );
    } finally {
      db.close();
    }
  });
});

test("storeAgentMailWebhookDelivery upserts sources and does not double-count redeliveries", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({ databasePath });

    const buildPayload = ({
      eventId,
      messageId,
      subject,
      sentAt,
      receivedAt,
    }) => ({
      event_id: eventId,
      event_type: "message.received",
      message: {
        message_id: messageId,
        inbox_id: "inbox_news",
        subject,
        from: "Signals Weekly <editor@example.com>",
        timestamp: sentAt,
        extracted_text: `${subject} body`,
        headers: {
          "message-id": `<${messageId}@example.com>`,
        },
      },
      thread: {
        inbox_id: "inbox_news",
        subject,
        received_timestamp: receivedAt,
      },
    });

    try {
      const firstPayload = buildPayload({
        eventId: "evt_source_1",
        messageId: "msg_source_1",
        subject: "Signals one",
        sentAt: "2026-03-09T17:00:00Z",
        receivedAt: "2026-03-09T17:00:05Z",
      });
      const secondPayload = buildPayload({
        eventId: "evt_source_2",
        messageId: "msg_source_2",
        subject: "Signals two",
        sentAt: "2026-03-10T18:10:00Z",
        receivedAt: "2026-03-10T18:10:05Z",
      });

      const firstResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-source-1",
        eventType: firstPayload.event_type,
        rawPayload: JSON.stringify(firstPayload),
        payload: firstPayload,
      });
      const firstSource = {
        ...db.prepare(`
        SELECT
          id,
          sender_address,
          display_name,
          email_count,
          first_seen_at,
          last_seen_at
        FROM sources
        WHERE sender_address = 'editor@example.com'
      `).get(),
      };

      assert.deepEqual(firstSource, {
        id: firstSource.id,
        sender_address: "editor@example.com",
        display_name: "Signals Weekly",
        email_count: 1,
        first_seen_at: "2026-03-09 17:00:05",
        last_seen_at: "2026-03-09 17:00:05",
      });

      const secondResult = storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-source-2",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify(secondPayload),
        payload: secondPayload,
      });
      const afterSecondSource = {
        ...db.prepare(`
        SELECT
          id,
          sender_address,
          display_name,
          email_count,
          first_seen_at,
          last_seen_at
        FROM sources
        WHERE sender_address = 'editor@example.com'
      `).get(),
      };

      assert.deepEqual(afterSecondSource, {
        id: firstSource.id,
        sender_address: "editor@example.com",
        display_name: "Signals Weekly",
        email_count: 2,
        first_seen_at: "2026-03-09 17:00:05",
        last_seen_at: "2026-03-10 18:10:05",
      });

      storeAgentMailWebhookDelivery(db, {
        deliveryId: "svix-source-2-redelivery",
        eventType: secondPayload.event_type,
        rawPayload: JSON.stringify({
          ...secondPayload,
          event_id: "evt_source_2_redelivery",
        }),
        payload: {
          ...secondPayload,
          event_id: "evt_source_2_redelivery",
        },
      });

      const afterRedeliverySource = {
        ...db.prepare(`
        SELECT
          id,
          sender_address,
          display_name,
          email_count,
          first_seen_at,
          last_seen_at
        FROM sources
        WHERE sender_address = 'editor@example.com'
      `).get(),
      };
      const emails = db.prepare(`
        SELECT id, agentmail_message_id, source_id
        FROM emails
        ORDER BY agentmail_message_id ASC
      `).all();

      assert.deepEqual(afterRedeliverySource, {
        id: firstSource.id,
        sender_address: "editor@example.com",
        display_name: "Signals Weekly",
        email_count: 2,
        first_seen_at: "2026-03-09 17:00:05",
        last_seen_at: "2026-03-10 18:10:05",
      });
      assert.equal(firstResult.emailId > 0, true);
      assert.equal(secondResult.emailId > 0, true);
      assert.deepEqual(
        emails.map((email) => ({
          agentmail_message_id: email.agentmail_message_id,
          source_id: email.source_id,
        })),
        [
          {
            agentmail_message_id: "msg_source_1",
            source_id: firstSource.id,
          },
          {
            agentmail_message_id: "msg_source_2",
            source_id: firstSource.id,
          },
        ]
      );
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase migrates legacy note_links rows into basis-value relationship rows", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE notes (
          id INTEGER PRIMARY KEY,
          taxonomy_key TEXT
        );

        CREATE TABLE note_links (
          source_note_id INTEGER NOT NULL,
          target_note_id INTEGER NOT NULL,
          relationship_type TEXT NOT NULL DEFAULT 'shared_keyword',
          strength REAL NOT NULL DEFAULT 0,
          shared_keywords_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (source_note_id, target_note_id),
          CHECK (source_note_id < target_note_id)
        );

        INSERT INTO notes (id) VALUES (1), (2);
        INSERT INTO note_links (
          source_note_id,
          target_note_id,
          relationship_type,
          strength,
          shared_keywords_json
        )
        VALUES (1, 2, 'shared_keyword', 0.82, '["agents","email"]');

        PRAGMA user_version = 2;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 10);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const relationships = migratedDb.prepare(`
        SELECT
          note_id,
          related_note_id,
          relationship_type,
          strength,
          overlap_basis,
          matched_value,
          overlap_source_metadata_json
        FROM relationships
        ORDER BY matched_value ASC
      `).all();

      assert.deepEqual(
        relationships.map((relationship) => ({ ...relationship })),
        [
          {
            note_id: 1,
            related_note_id: 2,
            relationship_type: "shared_keyword",
            strength: 0.82,
            overlap_basis: "keyword",
            matched_value: "agents",
            overlap_source_metadata_json: '{"migratedFrom":"note_links"}',
          },
          {
            note_id: 1,
            related_note_id: 2,
            relationship_type: "shared_keyword",
            strength: 0.82,
            overlap_basis: "keyword",
            matched_value: "email",
            overlap_source_metadata_json: '{"migratedFrom":"note_links"}',
          },
        ]
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase adds failed_at to email processing jobs and backfills failed rows", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE webhook_deliveries (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE email_processing_jobs (
          id INTEGER PRIMARY KEY,
          email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
          webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO emails (id) VALUES (1);
        INSERT INTO email_processing_jobs (
          email_id,
          status,
          attempts,
          error_message,
          started_at,
          completed_at
        )
        VALUES (
          1,
          'failed',
          2,
          'Claude extraction timed out',
          '2026-03-09 17:00:01',
          '2026-03-09 17:00:05'
        );

        PRAGMA user_version = 5;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 10);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const columns = migratedDb
        .prepare("PRAGMA table_info(email_processing_jobs)")
        .all()
        .map((column) => column.name);

      assert.ok(columns.includes("failed_at"));

      const failedJob = migratedDb.prepare(`
        SELECT status, attempts, error_message, completed_at, failed_at
        FROM email_processing_jobs
        WHERE email_id = 1
      `).get();

      assert.deepEqual({ ...failedJob }, {
        status: "failed",
        attempts: 2,
        error_message: "Claude extraction timed out",
        completed_at: "2026-03-09 17:00:05",
        failed_at: "2026-03-09 17:00:05",
      });
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase links legacy email processing jobs to persisted raw email payloads", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    const rawPayload = JSON.stringify({
      event_type: "message.received",
      message: {
        message_id: "msg_job_payload_migration",
      },
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE webhook_deliveries (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY,
          agentmail_message_id TEXT NOT NULL UNIQUE,
          raw_payload TEXT NOT NULL
        );

        CREATE TABLE raw_emails (
          id INTEGER PRIMARY KEY,
          agentmail_message_id TEXT UNIQUE,
          raw_payload TEXT NOT NULL
        );

        CREATE TABLE email_processing_jobs (
          id INTEGER PRIMARY KEY,
          email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
          webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT,
          failed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO emails (id, agentmail_message_id, raw_payload)
        VALUES (1, 'msg_job_payload_migration', '${rawPayload.replace(/'/g, "''")}');

        INSERT INTO raw_emails (id, agentmail_message_id, raw_payload)
        VALUES (7, 'msg_job_payload_migration', '${rawPayload.replace(/'/g, "''")}');

        INSERT INTO email_processing_jobs (
          id,
          email_id,
          status,
          attempts
        )
        VALUES (11, 1, 'pending', 0);

        PRAGMA user_version = 15;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 20);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const columns = migratedDb
        .prepare("PRAGMA table_info(email_processing_jobs)")
        .all()
        .map((column) => column.name);

      assert.ok(columns.includes("raw_email_id"));

      const job = getEmailProcessingJobById(migratedDb, 11);
      assert.deepEqual(
        {
          raw_email_id: job.raw_email_id,
          raw_email_agentmail_message_id: job.raw_email_agentmail_message_id,
          raw_email_payload: job.raw_email_payload,
          status: job.status,
        },
        {
          raw_email_id: 7,
          raw_email_agentmail_message_id: "msg_job_payload_migration",
          raw_email_payload: rawPayload,
          status: "queued",
        }
      );
    } finally {
      migratedDb.close();
    }
  });
});

test("initializeDatabase upgrades pending email processing state snapshots to queued", async () => {
  await withTempDatabase(async (databasePath) => {
    const { db } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    try {
      db.exec(`
        CREATE TABLE taxonomy_types (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL
        );

        CREATE TABLE emails (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE raw_emails (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE webhook_deliveries (
          id INTEGER PRIMARY KEY
        );

        CREATE TABLE email_processing_jobs (
          id INTEGER PRIMARY KEY,
          email_id INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
          webhook_delivery_id INTEGER REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE email_processing_events (
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

        INSERT INTO emails (id) VALUES (1);

        INSERT INTO email_processing_jobs (
          id,
          email_id,
          status,
          attempts
        )
        VALUES (5, 1, 'pending', 2);

        INSERT INTO email_processing_events (
          email_id,
          processing_job_id,
          event_type,
          job_status
        )
        VALUES (1, 5, 'queued', 'pending');

        PRAGMA user_version = 19;
      `);
    } finally {
      db.close();
    }

    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 20);

    const { db: migratedDb } = await openDatabaseConnection({ databasePath });

    try {
      const statusColumn = migratedDb
        .prepare("PRAGMA table_info(email_processing_jobs)")
        .all()
        .find((column) => column.name === "status");

      assert.equal(statusColumn?.dflt_value, "'queued'");

      const job = getEmailProcessingJobById(migratedDb, 5);
      assert.equal(job?.status, "queued");

      const [event] = listEmailProcessingEvents(migratedDb, {
        processingJobId: 5,
      });
      assert.equal(event?.job_status, "queued");
    } finally {
      migratedDb.close();
    }
  });
});

test("retryEmailProcessingJob requeues failed jobs without resetting attempt history", async () => {
  await withTempDatabase(async (databasePath) => {
    const state = await initializeDatabase({ databasePath });
    assert.ok(state.schemaVersion >= 20);

    const { db } = await openDatabaseConnection({ databasePath });

    try {
      const emailId = Number(
        db.prepare(`
          INSERT INTO emails (agentmail_message_id, raw_payload)
          VALUES (?, ?)
        `).run("msg_retry_job_1", "{}").lastInsertRowid
      );
      const queuedJob = queueEmailProcessingJob(db, { emailId });

      updateEmailProcessingJobState(db, queuedJob.id, { status: "processing" });
      updateEmailProcessingJobState(db, queuedJob.id, {
        status: "failed",
        errorMessage: "simulated retryable failure",
      });

      const retriedJob = retryEmailProcessingJob(db, queuedJob.id);

      assert.deepEqual(
        {
          id: retriedJob?.id,
          status: retriedJob?.status,
          attempts: retriedJob?.attempts,
          error_message: retriedJob?.error_message,
          started_at: retriedJob?.started_at,
          completed_at: retriedJob?.completed_at,
          failed_at: retriedJob?.failed_at,
        },
        {
          id: queuedJob.id,
          status: "queued",
          attempts: 1,
          error_message: null,
          started_at: null,
          completed_at: null,
          failed_at: null,
        }
      );

      const events = listEmailProcessingEvents(db, {
        processingJobId: queuedJob.id,
      }).map((event) => ({
        event_type: event.event_type,
        job_status: event.job_status,
        error_message: event.error_message,
      }));

      assert.deepEqual(events, [
        {
          event_type: "queued",
          job_status: "queued",
          error_message: null,
        },
        {
          event_type: "processing_started",
          job_status: "processing",
          error_message: null,
        },
        {
          event_type: "processing_failed",
          job_status: "failed",
          error_message: "simulated retryable failure",
        },
        {
          event_type: "requeued",
          job_status: "queued",
          error_message: null,
        },
      ]);
    } finally {
      db.close();
    }
  });
});
