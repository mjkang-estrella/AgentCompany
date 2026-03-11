function trimToNull(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function getObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizeAgentMailRawEmail({
  deliveryId = null,
  eventType = null,
  rawPayload,
  payload,
  webhookDeliveryId = null,
}) {
  const normalizedEventType = pickFirstString(eventType, payload?.event_type);

  if (normalizedEventType !== "message.received") {
    throw new Error(
      `Raw email persistence only supports AgentMail message.received events (received ${normalizedEventType ?? "null"})`
    );
  }

  const message = getObject(payload?.message);
  const thread = getObject(payload?.thread);

  if (!message) {
    throw new Error("AgentMail message.received payload is missing the message object");
  }

  const agentmailMessageId = trimToNull(message.message_id);

  if (!agentmailMessageId) {
    throw new Error("AgentMail message.received payload is missing message.message_id");
  }

  const { name: fromName, address: fromAddress } = parseMailbox(message.from);
  const { address: senderHeaderAddress } = parseMailbox(
    getMessageHeader(message.headers, "sender")
  );

  return {
    webhook_delivery_id: Number.isInteger(webhookDeliveryId) ? webhookDeliveryId : null,
    provider: "agentmail",
    delivery_id: trimToNull(deliveryId),
    event_type: normalizedEventType,
    agentmail_message_id: agentmailMessageId,
    agentmail_inbox_id: pickFirstString(message.inbox_id, thread?.inbox_id),
    message_id_header: getMessageHeader(message.headers, "message-id"),
    subject: pickFirstString(message.subject, thread?.subject),
    from_name: fromName,
    from_address: fromAddress,
    sender_address: pickFirstString(senderHeaderAddress, fromAddress),
    sent_at: pickFirstString(message.timestamp, thread?.sent_timestamp, message.created_at),
    received_at: pickFirstString(
      thread?.received_timestamp,
      message.created_at,
      message.updated_at,
      message.timestamp
    ),
    text_content: pickFirstString(message.extracted_text, message.text, message.preview),
    html_content: pickFirstString(message.extracted_html, message.html),
    raw_payload:
      typeof rawPayload === "string" && rawPayload.length > 0
        ? rawPayload
        : JSON.stringify(payload),
  };
}

export function getRawEmailById(db, rawEmailId) {
  return (
    db
      .prepare(`
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
          html_content,
          raw_payload,
          created_at,
          updated_at
        FROM raw_emails
        WHERE id = ?
      `)
      .get(rawEmailId) ?? null
  );
}

export function getRawEmailByMessageId(db, agentmailMessageId) {
  return (
    db
      .prepare(`
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
          html_content,
          raw_payload,
          created_at,
          updated_at
        FROM raw_emails
        WHERE agentmail_message_id = ?
      `)
      .get(agentmailMessageId) ?? null
  );
}

export function insertRawEmail(
  db,
  { deliveryId = null, eventType = null, rawPayload, payload, webhookDeliveryId = null }
) {
  const normalized = normalizeAgentMailRawEmail({
    deliveryId,
    eventType,
    rawPayload,
    payload,
    webhookDeliveryId,
  });

  db.prepare(`
    INSERT INTO raw_emails (
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
      html_content,
      raw_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(agentmail_message_id) DO UPDATE SET
      webhook_delivery_id = COALESCE(excluded.webhook_delivery_id, raw_emails.webhook_delivery_id),
      provider = excluded.provider,
      delivery_id = COALESCE(excluded.delivery_id, raw_emails.delivery_id),
      event_type = excluded.event_type,
      agentmail_inbox_id = excluded.agentmail_inbox_id,
      message_id_header = excluded.message_id_header,
      subject = excluded.subject,
      from_name = excluded.from_name,
      from_address = excluded.from_address,
      sender_address = excluded.sender_address,
      sent_at = excluded.sent_at,
      received_at = excluded.received_at,
      text_content = excluded.text_content,
      html_content = excluded.html_content,
      raw_payload = excluded.raw_payload,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    normalized.webhook_delivery_id,
    normalized.provider,
    normalized.delivery_id,
    normalized.event_type,
    normalized.agentmail_message_id,
    normalized.agentmail_inbox_id,
    normalized.message_id_header,
    normalized.subject,
    normalized.from_name,
    normalized.from_address,
    normalized.sender_address,
    normalized.sent_at,
    normalized.received_at,
    normalized.text_content,
    normalized.html_content,
    normalized.raw_payload
  );

  return getRawEmailByMessageId(db, normalized.agentmail_message_id);
}
