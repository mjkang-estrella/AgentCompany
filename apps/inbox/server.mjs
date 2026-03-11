import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDailyDigest,
  getEmailIngestionSummary,
  getNoteWithRelationshipsById,
  listMostConnectedNotes,
  listSources,
  listTaxonomyTypeCounts,
  openDatabaseConnection,
  recordEmailProcessingEvent,
  storeAgentMailWebhookDelivery,
  storeNoteFeedback,
} from "./database.mjs";
import { createEmailProcessingWorker } from "./email-worker.mjs";
import { normalizeAgentMailRawEmail } from "./raw-email-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const indexPath = path.join(__dirname, "index.html");
const PORT = Number.parseInt(process.env.PORT || "3210", 10);
const AGENTMAIL_API_BASE = "https://api.agentmail.to/v0";
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024 * 2;
const AGENTMAIL_WEBHOOK_PATHS = new Set(["/webhooks", "/webhooks/agentmail"]);
const DEFAULT_NOTES_PAGE = 1;
const DEFAULT_NOTES_LIMIT = 50;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function html(res, status, content) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(content);
}

function getHeaderValue(headers, name) {
  const headerValue = headers[name.toLowerCase()];

  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return typeof headerValue === "string" ? headerValue : null;
}

function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentMailEventType(value) {
  const normalized = trimToNull(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeAgentMailWebhookPayload({ deliveryId = null, rawPayload, payload }) {
  if (!isPlainObject(payload)) {
    throw new HttpError(400, "AgentMail webhook payload must be a JSON object");
  }

  const eventType = normalizeAgentMailEventType(payload.event_type);

  if (!eventType) {
    throw new HttpError(400, "AgentMail webhook payload is missing event_type");
  }

  const normalizedPayload = {
    ...payload,
    event_type: eventType,
  };

  if (eventType === "message.received") {
    try {
      normalizeAgentMailRawEmail({
        deliveryId,
        eventType,
        rawPayload,
        payload: normalizedPayload,
      });
    } catch (error) {
      throw new HttpError(
        400,
        error?.message || "Invalid AgentMail message.received payload"
      );
    }
  }

  return {
    deliveryId: trimToNull(deliveryId),
    eventType,
    payload: normalizedPayload,
  };
}

async function readRequestBody(req, { maxBytes = MAX_WEBHOOK_BODY_BYTES } = {}) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;

    if (totalBytes > maxBytes) {
      throw new HttpError(413, `Request body exceeds ${maxBytes} bytes`);
    }

    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readAgentMailApiKeyFromFile(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    const match = content.match(/^AGENTMAIL_API_KEY=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function getAgentMailApiKey() {
  if (process.env.AGENTMAIL_API_KEY) {
    return process.env.AGENTMAIL_API_KEY;
  }

  const candidates = [
    path.join(__dirname, ".env"),
    path.join(repoRoot, ".env"),
  ];

  for (const filePath of candidates) {
    const apiKey = await readAgentMailApiKeyFromFile(filePath);
    if (apiKey) {
      return apiKey;
    }
  }

  throw new Error("AGENTMAIL_API_KEY is not configured");
}

function buildAgentMailUrl(pathname, searchParams) {
  const url = new URL(`${AGENTMAIL_API_BASE}${pathname}`);

  if (searchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.append(key, value);
    }
  }

  return url.toString();
}

async function agentmailFetch(pathname, searchParams) {
  const response = await fetch(buildAgentMailUrl(pathname, searchParams), {
    headers: {
      Authorization: `Bearer ${await getAgentMailApiKey()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = await response.text();
  let parsed;

  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = { error: payload };
  }

  if (!response.ok) {
    const errorText = typeof parsed.error === "string" ? parsed.error : payload.slice(0, 300);
    throw new Error(`AgentMail request failed (${response.status}): ${errorText}`);
  }

  return parsed;
}

function normalizeTopicKeyword(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeTypeFilter(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

function parsePositiveInteger(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }

  return Number.parseInt(normalized, 10);
}

function parseCalendarDate(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [year, month, day] = normalized.split("-").map((part) => Number.parseInt(part, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return normalized;
}

async function readJsonObjectRequestBody(
  req,
  {
    emptyMessage = "Request body is required",
    invalidJsonMessage = "Invalid JSON payload",
    invalidObjectMessage = "Request body must be a JSON object",
  } = {}
) {
  const rawPayload = await readRequestBody(req);

  if (trimToNull(rawPayload) === null) {
    throw new HttpError(400, emptyMessage);
  }

  let payload;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    throw new HttpError(400, invalidJsonMessage);
  }

  if (!isPlainObject(payload)) {
    throw new HttpError(400, invalidObjectMessage);
  }

  return payload;
}

function parseNotesPagination(searchParams) {
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");
  const page = pageParam === null ? DEFAULT_NOTES_PAGE : parsePositiveInteger(pageParam);
  const limit = limitParam === null ? DEFAULT_NOTES_LIMIT : parsePositiveInteger(limitParam);

  if (page === null) {
    throw new HttpError(400, "The page query parameter must be a positive integer");
  }

  if (limit === null) {
    throw new HttpError(400, "The limit query parameter must be a positive integer");
  }

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
}

function normalizeFeedbackUseful(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  return null;
}

function normalizeFeedbackUpdatedAt(value) {
  const normalized = trimToNull(value);

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized.replace(" ", "T")}Z`;
  }

  return normalized;
}

function serializeFeedbackPayload(note) {
  if (isPlainObject(note.feedback)) {
    return {
      useful: Boolean(note.feedback.useful),
      comment: trimToNull(note.feedback.comment ?? null),
      updated_at: normalizeFeedbackUpdatedAt(note.feedback.updated_at ?? note.feedback.updatedAt),
    };
  }

  const useful = normalizeFeedbackUseful(note.feedback_useful ?? note.feedbackUseful);

  if (useful === null) {
    return null;
  }

  return {
    useful,
    comment: trimToNull(note.feedback_comment ?? note.feedbackComment ?? null),
    updated_at: normalizeFeedbackUpdatedAt(
      note.feedback_updated_at ?? note.feedbackUpdatedAt ?? null
    ),
  };
}

function serializeRelationshipPayload(relationship) {
  return {
    ...relationship,
    related_note: serializeNotePayload(relationship.related_note),
  };
}

function serializeNotePayload(note) {
  const {
    feedback,
    feedback_useful,
    feedbackUseful,
    feedback_comment,
    feedbackComment,
    feedback_updated_at,
    feedbackUpdatedAt,
    ...notePayload
  } = note;
  const classificationConfidence =
    note.classificationConfidence ?? note.classification_confidence ?? note.confidence ?? null;
  const serializedNote = {
    ...notePayload,
    confidence: classificationConfidence,
    classification_confidence: classificationConfidence,
    classificationConfidence,
  };
  const serializedFeedback = serializeFeedbackPayload({
    feedback,
    feedback_useful,
    feedbackUseful,
    feedback_comment,
    feedbackComment,
    feedback_updated_at,
    feedbackUpdatedAt,
  });

  if (serializedFeedback !== null) {
    serializedNote.feedback = serializedFeedback;
  }

  if (Array.isArray(note.relationships)) {
    serializedNote.relationships = note.relationships.map((relationship) =>
      serializeRelationshipPayload(relationship)
    );
  }

  return serializedNote;
}

function serializeConnectedNoteSummaryPayload(note) {
  const serializedNote = serializeNotePayload(note);

  return {
    id: serializedNote.id,
    email_id: serializedNote.email_id,
    taxonomy_key: serializedNote.taxonomy_key,
    title: serializedNote.title,
    summary: serializedNote.summary ?? null,
    source_timestamp: serializedNote.source_timestamp ?? null,
    confidence: serializedNote.confidence ?? null,
    classificationConfidence: serializedNote.classificationConfidence ?? null,
    connection_count: Number(serializedNote.connection_count ?? 0),
    created_at: serializedNote.created_at,
    updated_at: serializedNote.updated_at,
  };
}

function serializeDigestActionItemPayload(note) {
  const serializedNote = serializeNotePayload(note);
  const payload = {
    id: serializedNote.id,
    email_id: serializedNote.email_id,
    taxonomy_key: serializedNote.taxonomy_key,
    title: serializedNote.title,
    summary: serializedNote.summary ?? null,
    action: serializedNote.summary ?? serializedNote.title ?? serializedNote.body,
    source_timestamp: serializedNote.source_timestamp ?? null,
    confidence: serializedNote.confidence ?? null,
    classificationConfidence: serializedNote.classificationConfidence ?? null,
    connection_count: Number(serializedNote.connection_count ?? 0),
    keywords: Array.isArray(note.keywords) ? [...note.keywords] : [],
  };

  if (serializedNote.feedback) {
    payload.feedback = serializedNote.feedback;
  }

  return payload;
}

function serializeDigestSectionPayload(section) {
  return {
    taxonomy_key: section.taxonomy_key,
    label: section.label,
    note_count: Number(section.note_count ?? 0),
    summary: trimToNull(section.summary),
    notes: Array.isArray(section.notes)
      ? section.notes.map((note) => serializeNotePayload(note))
      : [],
  };
}

function serializeDigestThemePayload(theme) {
  const noteCount = Number(theme.note_count ?? 0);
  const noteIds = Array.isArray(theme.note_ids) ? [...theme.note_ids] : [];

  return {
    theme: trimToNull(theme.theme),
    source: trimToNull(theme.source),
    note_count: noteCount,
    count: noteCount,
    note_ids: noteIds,
  };
}

function countNotes(database) {
  return Number(database.prepare("SELECT COUNT(*) AS count FROM notes").get()?.count ?? 0);
}

function countNotesByTopic(database, topic) {
  return Number(
    database
      .prepare(`
        SELECT COUNT(DISTINCT notes.id) AS count
        FROM notes
        INNER JOIN note_keywords
          ON note_keywords.note_id = notes.id
        INNER JOIN keywords
          ON keywords.id = note_keywords.keyword_id
        WHERE keywords.normalized_keyword = ?
      `)
      .get(topic)?.count ?? 0
  );
}

function countNotesByType(database, taxonomyKey) {
  return Number(
    database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM notes
        WHERE notes.taxonomy_key = ?
      `)
      .get(taxonomyKey)?.count ?? 0
  );
}

function listNotesByTopic(database, topic, pagination = null) {
  const bindings = [topic];
  let sql = `
      SELECT DISTINCT
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
        notes.updated_at
      FROM notes
      INNER JOIN note_keywords
        ON note_keywords.note_id = notes.id
      INNER JOIN keywords
        ON keywords.id = note_keywords.keyword_id
      WHERE keywords.normalized_keyword = ?
      ORDER BY COALESCE(notes.source_timestamp, notes.created_at) DESC, notes.id DESC
    `;

  if (pagination) {
    sql += `
      LIMIT ? OFFSET ?
    `;
    bindings.push(pagination.limit, pagination.offset);
  }

  return database.prepare(sql).all(...bindings);
}

function listNotesByType(database, taxonomyKey, pagination = null) {
  const bindings = [taxonomyKey];
  let sql = `
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
        notes.updated_at
      FROM notes
      WHERE notes.taxonomy_key = ?
      ORDER BY COALESCE(notes.source_timestamp, notes.created_at) DESC, notes.id DESC
    `;

  if (pagination) {
    sql += `
      LIMIT ? OFFSET ?
    `;
    bindings.push(pagination.limit, pagination.offset);
  }

  return database.prepare(sql).all(...bindings);
}

function listNotesWithRelationships(database, pagination = null) {
  const bindings = [];
  let sql = `
      SELECT id
      FROM notes
      ORDER BY COALESCE(source_timestamp, created_at) DESC, id DESC
    `;

  if (pagination) {
    sql += `
      LIMIT ? OFFSET ?
    `;
    bindings.push(pagination.limit, pagination.offset);
  }

  return database
    .prepare(sql)
    .all(...bindings)
    .map(({ id }) => getNoteWithRelationshipsById(database, id));
}

function listNotesForCalendarDate(database, calendarDate) {
  return database
    .prepare(`
      SELECT id
      FROM notes
      WHERE date(COALESCE(source_timestamp, created_at)) = ?
      ORDER BY COALESCE(source_timestamp, created_at) DESC, id DESC
    `)
    .all(calendarDate)
    .map(({ id }) => getNoteWithRelationshipsById(database, id));
}

async function handleApi(req, res, url) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/api/agentmail/inboxes") {
    const payload = await agentmailFetch("/inboxes", url.searchParams);
    json(res, 200, payload);
    return;
  }

  const messageDetailMatch = url.pathname.match(
    /^\/api\/agentmail\/inboxes\/([^/]+)\/messages\/([^/]+)$/
  );

  if (messageDetailMatch) {
    const inboxId = decodeURIComponent(messageDetailMatch[1]);
    const messageId = decodeURIComponent(messageDetailMatch[2]);
    const payload = await agentmailFetch(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      url.searchParams
    );
    json(res, 200, payload);
    return;
  }

  const messageListMatch = url.pathname.match(
    /^\/api\/agentmail\/inboxes\/([^/]+)\/messages$/
  );

  if (messageListMatch) {
    const inboxId = decodeURIComponent(messageListMatch[1]);
    const payload = await agentmailFetch(
      `/inboxes/${encodeURIComponent(inboxId)}/messages`,
      url.searchParams
    );
    json(res, 200, payload);
    return;
  }

  json(res, 404, { error: "Not found" });
}

function assertWebhookStorageResult(result) {
  if (!isPlainObject(result)) {
    throw new HttpError(500, "AgentMail webhook persistence did not return a result");
  }

  if (result.status === "stored" || result.status === "ignored") {
    return;
  }

  if (result.status === "failed") {
    throw new HttpError(500, "Failed to persist AgentMail webhook payload");
  }

  throw new HttpError(
    500,
    `Unexpected AgentMail webhook persistence status: ${String(result.status ?? "unknown")}`
  );
}

async function handleNotesRoute(req, res, url, database) {
  const noteFeedbackMatch = url.pathname.match(/^\/notes\/([^/]+)\/feedback$/);

  if (noteFeedbackMatch) {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }

    const noteId = parsePositiveInteger(decodeURIComponent(noteFeedbackMatch[1]));

    if (noteId === null) {
      json(res, 400, {
        error: "The note id path parameter must be a positive integer",
      });
      return;
    }

    const payload = await readJsonObjectRequestBody(req, {
      invalidObjectMessage: "Note feedback payload must be a JSON object",
    });

    if (typeof payload.useful !== "boolean") {
      json(res, 400, {
        error: "The useful field is required and must be a boolean",
      });
      return;
    }

    if (
      payload.comment !== undefined &&
      payload.comment !== null &&
      typeof payload.comment !== "string"
    ) {
      json(res, 400, {
        error: "The comment field must be a string when provided",
      });
      return;
    }

    const note = storeNoteFeedback(database, noteId, {
      useful: payload.useful,
      comment: payload.comment,
    });

    if (!note) {
      json(res, 404, { error: "Note not found" });
      return;
    }

    json(res, 200, { note: serializeNotePayload(note) });
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const noteDetailMatch = url.pathname.match(/^\/notes\/([^/]+)$/);

  if (noteDetailMatch) {
    const noteId = parsePositiveInteger(decodeURIComponent(noteDetailMatch[1]));

    if (noteId === null) {
      json(res, 400, {
        error: "The note id path parameter must be a positive integer",
      });
      return;
    }

    const note = getNoteWithRelationshipsById(database, noteId);

    if (!note) {
      json(res, 404, { error: "Note not found" });
      return;
    }

    json(res, 200, { note: serializeNotePayload(note) });
    return;
  }

  const type = normalizeTypeFilter(url.searchParams.get("type"));
  const topic = normalizeTopicKeyword(url.searchParams.get("topic"));
  const pagination = parseNotesPagination(url.searchParams);

  if (type) {
    json(res, 200, {
      type,
      page: pagination.page,
      limit: pagination.limit,
      total: countNotesByType(database, type),
      notes: listNotesByType(database, type, pagination).map((note) => serializeNotePayload(note)),
    });
    return;
  }

  if (url.searchParams.has("type")) {
    json(res, 400, { error: "The type query parameter is required" });
    return;
  }

  if (topic) {
    json(res, 200, {
      topic,
      page: pagination.page,
      limit: pagination.limit,
      total: countNotesByTopic(database, topic),
      notes: listNotesByTopic(database, topic, pagination).map((note) =>
        serializeNotePayload(note)
      ),
    });
    return;
  }

  if (url.searchParams.has("topic")) {
    json(res, 400, { error: "The topic query parameter is required" });
    return;
  }

  json(res, 200, {
    page: pagination.page,
    limit: pagination.limit,
    total: countNotes(database),
    notes: listNotesWithRelationships(database, pagination).map((note) =>
      serializeNotePayload(note)
    ),
  });
}

function handleSourcesRoute(req, res, database) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  json(res, 200, {
    sources: listSources(database),
  });
}

function handleStatsRoute(req, res, database) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const emailCounts = getEmailIngestionSummary(database);

  json(res, 200, {
    note_counts_by_type: listTaxonomyTypeCounts(database).map((taxonomyTypeCount) => ({
      taxonomy_key: taxonomyTypeCount.taxonomy_key,
      label: taxonomyTypeCount.label,
      count: taxonomyTypeCount.note_count,
    })),
    email_counts: {
      processed: emailCounts.processed_email_count,
      skipped: emailCounts.skipped_email_count,
    },
    top_connected_notes: listMostConnectedNotes(database).map((note) =>
      serializeConnectedNoteSummaryPayload(note)
    ),
  });
}

function handleDailyDigestRoute(req, res, url, database) {
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const calendarDate = parseCalendarDate(url.searchParams.get("date"));

  if (calendarDate === null) {
    json(res, 400, {
      error: url.searchParams.has("date")
        ? "The date query parameter must use YYYY-MM-DD format"
        : "The date query parameter is required",
    });
    return;
  }

  const digest = getDailyDigest(database, calendarDate);
  const notes = listNotesForCalendarDate(database, calendarDate).map((note) =>
    serializeNotePayload(note)
  );
  const serializedNotesById = new Map(notes.map((note) => [note.id, note]));
  const sections = digest.sections.map((section) => ({
    ...serializeDigestSectionPayload(section),
    notes: section.notes.map((note) => serializedNotesById.get(note.id) ?? serializeNotePayload(note)),
  }));

  json(res, 200, {
    date: calendarDate,
    note_count: notes.length,
    summary: trimToNull(digest.summary),
    top_themes: Array.isArray(digest.top_themes)
      ? digest.top_themes.map((theme) => serializeDigestThemePayload(theme))
      : [],
    notes,
    sections,
    action_items: digest.action_items.map((note) => serializeDigestActionItemPayload(note)),
  });
}

async function handleAgentMailWebhook(req, res, database, webhookPath, storeWebhookDelivery) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const rawPayload = await readRequestBody(req);

  if (trimToNull(rawPayload) === null) {
    json(res, 400, { error: "Request body is required" });
    return;
  }

  let payload;

  try {
    payload = JSON.parse(rawPayload);
  } catch {
    json(res, 400, { error: "Invalid JSON payload" });
    return;
  }

  const normalizedRequest = normalizeAgentMailWebhookPayload({
    deliveryId: getHeaderValue(req.headers, "svix-id"),
    rawPayload,
    payload,
  });

  const result = storeWebhookDelivery(database, {
    deliveryId: normalizedRequest.deliveryId,
    eventType: normalizedRequest.eventType,
    rawPayload,
    payload: normalizedRequest.payload,
    receipt: {
      webhookPath,
      headers: req.headers,
      contentType: getHeaderValue(req.headers, "content-type"),
      userAgent: getHeaderValue(req.headers, "user-agent"),
      signature: getHeaderValue(req.headers, "svix-signature"),
      timestamp: getHeaderValue(req.headers, "svix-timestamp"),
      sourceIp: req.socket?.remoteAddress ?? null,
      bodyBytes: Buffer.byteLength(rawPayload, "utf8"),
    },
  });
  assertWebhookStorageResult(result);

  json(res, 200, {
    ok: true,
    eventType: normalizedRequest.eventType,
    deliveryId: normalizedRequest.deliveryId,
    webhookDeliveryId: result.webhookDeliveryId,
    rawEmailId: result.rawEmailId,
    emailId: result.emailId,
    status: result.status,
    processingJobId: result.processingJobId,
    jobStatus: result.jobStatus,
  });

  return result;
}

export function createInboxHandler(options) {
  const {
    database,
    htmlPath = indexPath,
    jobWorker = null,
    logger = console,
    storeWebhookDelivery = storeAgentMailWebhookDelivery,
  } = options;

  return async function inboxHandler(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        html(res, 200, await readFile(htmlPath, "utf8"));
        return;
      }

      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (AGENTMAIL_WEBHOOK_PATHS.has(url.pathname)) {
        const result = await handleAgentMailWebhook(
          req,
          res,
          database,
          url.pathname,
          storeWebhookDelivery
        );

        if (result?.storedEmail && result.emailId && result.processingJobId) {
          setImmediate(() => {
            function recordDeferredProcessingEvent(eventType, error = null, metadata = null) {
              try {
                recordEmailProcessingEvent(database, {
                  emailId: result.emailId,
                  processingJobId: result.processingJobId,
                  webhookDeliveryId: result.webhookDeliveryId,
                  eventType,
                  jobStatus: result.jobStatus,
                  errorMessage: error?.message ?? null,
                  metadata,
                });
              } catch (recordError) {
                logger.error?.(
                  `[inbox server] failed to record async processing event for job ${result.processingJobId}:`,
                  recordError
                );
              }
            }

            try {
              if (jobWorker?.signal) {
                const signalResult = jobWorker.signal();

                if (typeof signalResult?.catch === "function") {
                  void signalResult.catch((error) => {
                    recordDeferredProcessingEvent("worker_signal_failed", error, {
                      phase: "dispatch",
                    });
                    logger.error?.(
                      `[inbox server] failed to signal background worker for job ${result.processingJobId}:`,
                      error
                    );
                  });
                }

                return;
              }

              recordDeferredProcessingEvent("worker_unavailable", null, {
                phase: "dispatch",
              });
              logger.warn?.(
                `[inbox server] queued email ${result.emailId} but no background worker is attached; job ${result.processingJobId} remains queued`
              );
            } catch (error) {
              recordDeferredProcessingEvent("worker_signal_failed", error, {
                phase: "dispatch",
              });
              logger.error?.(
                `[inbox server] failed to signal background worker for job ${result.processingJobId}:`,
                error
              );
            }
          });
        }

        return;
      }

      if (url.pathname === "/notes" || url.pathname.startsWith("/notes/")) {
        await handleNotesRoute(req, res, url, database);
        return;
      }

      if (url.pathname === "/sources") {
        handleSourcesRoute(req, res, database);
        return;
      }

      if (url.pathname === "/stats") {
        handleStatsRoute(req, res, database);
        return;
      }

      if (url.pathname === "/digests/daily") {
        handleDailyDigestRoute(req, res, url, database);
        return;
      }

      if (url.pathname.startsWith("/api/agentmail/")) {
        await handleApi(req, res, url);
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      const statusCode =
        Number.isInteger(error?.statusCode) && error.statusCode >= 400
          ? error.statusCode
          : 500;

      if (statusCode >= 500) {
        logger.error?.("[inbox server]", error);
      } else {
        logger.warn?.("[inbox server]", error.message || "Request failed");
      }

      json(res, statusCode, { error: error.message || "Internal server error" });
    }
  };
}

export async function openInboxDatabases(options = {}) {
  const {
    db,
    databasePath,
    schemaVersion,
    taxonomyTypeCount,
  } = await openDatabaseConnection({
    databasePath: options.databasePath,
  });

  try {
    const { db: workerDatabase } = await openDatabaseConnection({
      databasePath,
      initializeSchema: false,
    });

    return {
      db,
      workerDatabase,
      databaseState: {
        databasePath,
        schemaVersion,
        taxonomyTypeCount,
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function startInboxServer(options = {}) {
  const logger = options.logger ?? console;
  const { db, workerDatabase, databaseState } = await openInboxDatabases({
    databasePath: options.databasePath,
  });
  const jobWorker = createEmailProcessingWorker({
    database: workerDatabase,
    logger,
    noteProcessor: options.noteProcessor,
    pollIntervalMs: options.workerPollIntervalMs,
  });
  jobWorker.start();
  const server = createServer(
    createInboxHandler({
      database: db,
      htmlPath: options.htmlPath,
      jobWorker,
      logger,
    })
  );
  let cleanupPromise = null;
  let stopPromise = null;

  function closeDatabaseSafely(databaseHandle, label) {
    try {
      databaseHandle.close();
    } catch (error) {
      logger.error?.(`[inbox server] failed to close ${label}:`, error);
    }
  }

  function cleanupResources() {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        try {
          await jobWorker.stop();
        } catch (error) {
          logger.error?.("[inbox server] failed to stop email worker:", error);
        } finally {
          closeDatabaseSafely(workerDatabase, "worker database");
          closeDatabaseSafely(db, "request database");
        }
      })();
    }

    return cleanupPromise;
  }

  server.once("close", () => {
    void cleanupResources();
  });

  await new Promise((resolve) => {
    server.listen(options.port ?? PORT, resolve);
  });
  const address = server.address();
  const listeningPort =
    typeof address === "object" && address !== null ? address.port : options.port ?? PORT;

  const info = logger.info?.bind(logger) ?? console.log;

  info(
    `SQLite ready at ${databaseState.databasePath} (schema v${databaseState.schemaVersion}, ${databaseState.taxonomyTypeCount} taxonomy types)`
  );
  info(`Inbox server running at http://localhost:${listeningPort}`);

  async function stop() {
    if (!stopPromise) {
      stopPromise = (async () => {
        if (server.listening) {
          await new Promise((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            });
          });
        }

        await cleanupResources();
      })();
    }

    return stopPromise;
  }

  return { server, databaseState, jobWorker, port: listeningPort, stop };
}

function isMainModule(metaUrl) {
  return path.resolve(process.argv[1] || "") === fileURLToPath(metaUrl);
}

if (isMainModule(import.meta.url)) {
  await startInboxServer();
}
