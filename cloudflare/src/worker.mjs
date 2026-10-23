import { DurableObject } from "cloudflare:workers";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

const nowMs = () => Date.now();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...extra } });
}
function error(code, status = 400, detail = undefined) {
  return json({ ok: false, error: code, ...(detail ? { detail } : {}) }, status);
}
function boundedString(value, min, max, code) {
  if (typeof value !== "string") throw new HttpError(code, 400);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new HttpError(code, 400);
  return normalized;
}
class HttpError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }

function base64(bytes) {
  let binary = "";
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < array.length; i += 0x8000) binary += String.fromCharCode(...array.subarray(i, i + 0x8000));
  return btoa(binary);
}
function unbase64(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function randomId(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return prefix + [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function randomToken() { return base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
async function sha256Hex(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error("NON_CANONICAL_NUMBER");
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value).replaceAll("\\/", "/");
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${canonicalize(k)}:${canonicalize(value[k])}`).join(",")}}`;
  throw new Error("UNSUPPORTED_CANONICAL_JSON_TYPE");
}
function parseBearer(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (match) return match[1];
  const cookie = request.headers.get("cookie") || "";
  const pair = cookie.split(";").map((v) => v.trim()).find((v) => v.startsWith("zungun_session="));
  return pair ? decodeURIComponent(pair.slice("zungun_session=".length)) : null;
}
async function readJson(request, maxBytes = 64_000) {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > maxBytes) throw new HttpError("BODY_TOO_LARGE", 413);
  const text = await request.text();
  if (encoder.encode(text).length > maxBytes) throw new HttpError("BODY_TOO_LARGE", 413);
  try { return JSON.parse(text); } catch { throw new HttpError("INVALID_JSON", 400); }
}
function ipFingerprint(request) { return request.headers.get("cf-connecting-ip") || "unknown"; }
async function rateLimit(env, key, limit, windowMs) {
  const now = nowMs();
  const row = await env.DB.prepare(`INSERT INTO rate_limits(rate_key,count,reset_at_ms) VALUES(?,1,?)
    ON CONFLICT(rate_key) DO UPDATE SET
      count=CASE WHEN reset_at_ms<=? THEN 1 ELSE count+1 END,
      reset_at_ms=CASE WHEN reset_at_ms<=? THEN excluded.reset_at_ms ELSE reset_at_ms END
    RETURNING count,reset_at_ms`).bind(key, now + windowMs, now, now).first();
  if (!row || Number(row.count) > limit) throw new HttpError("RATE_LIMITED", 429);
}

async function authenticate(request, env) {
  const token = parseBearer(request);
  if (!token || token.length < 24 || token.length > 256) throw new HttpError("UNAUTHORIZED", 401);
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT i.user_id,i.display_name,i.pairing_code
    FROM sessions s JOIN identities i ON i.user_id=s.user_id
    WHERE s.session_hash=? AND s.revoked_at_ms IS NULL AND i.revoked_at_ms IS NULL`).bind(hash).first();
  if (!row) throw new HttpError("UNAUTHORIZED", 401);
  return { ...row, sessionHash: hash };
}
async function isPilot(request, env) {
  const key = request.headers.get("x-zungun-order083-key");
  return Boolean(key && env.ZUNGUN_PILOT_TOKEN && key === env.ZUNGUN_PILOT_TOKEN);
}
async function requirePilot(request, env) { if (!(await isPilot(request, env))) throw new HttpError("PILOT_UNAUTHORIZED", 401); }
async function setOrder083Fault(request, env) { await requirePilot(request, env); const body=await readJson(request,4096); const subjectId=boundedString(body.subjectId,8,180,"SUBJECT_ID_INVALID"); const faultType=body.faultType; if(faultType!=="DROP_AFTER_DURABLE_ACCEPT") throw new HttpError("FAULT_TYPE_INVALID",400); await env.DB.prepare("INSERT OR REPLACE INTO order083_faults(subject_id,fault_type,expires_at_ms) VALUES(?,?,?)").bind(subjectId,faultType,nowMs()+15*60_000).run(); return json({ok:true,subjectId,faultType}); }
async function consumeOrder083Fault(env,subjectId,type){const row=await env.DB.prepare("SELECT fault_type,expires_at_ms FROM order083_faults WHERE subject_id=?").bind(subjectId).first();if(!row||row.fault_type!==type||Number(row.expires_at_ms)<nowMs())return false;await env.DB.prepare("DELETE FROM order083_faults WHERE subject_id=?").bind(subjectId).run();return true}
async function expireOrder083Work(request,env,id){await requirePilot(request,env);const result=await env.DB.prepare("UPDATE work_orders SET expires_at_ms=?,revision=revision+1,updated_at_ms=? WHERE work_order_id=? AND status='OPEN'").bind(nowMs()-1,nowMs(),id).run();if(!result.meta?.changes)throw new HttpError("WORK_ORDER_NOT_FOUND_OR_TERMINAL",404);return json({ok:true,workOrderId:id})}
async function order083Diagnostics(request,env,subjectId){await requirePilot(request,env);const field=await env.DB.prepare("SELECT COUNT(*) AS n FROM field_operations WHERE operation_id=?").bind(subjectId).first();const effects=await env.DB.prepare("SELECT COUNT(*) AS n FROM work_orders WHERE effect_operation_id=?").bind(subjectId).first();let messageCount=0,deliveryAckCount=0;const convs=(await env.DB.prepare("SELECT conversation_id FROM conversations ORDER BY created_at_ms DESC LIMIT 100").all()).results||[];for(const c of convs){const m=await env.CONVERSATIONS.getByName(c.conversation_id).getMessage(subjectId);if(m){messageCount++;if(m.deliveredAtMs!=null)deliveryAckCount++}}return json({ok:true,subjectId,fieldOperationCount:Number(field?.n||0),fieldEffectCount:Number(effects?.n||0),messageCount,deliveryAckCount})}
async function pairingCode(env) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    const exists = await env.DB.prepare("SELECT 1 AS ok FROM identities WHERE pairing_code=?").bind(code).first();
    if (!exists) return code;
  }
  throw new HttpError("PAIRING_CODE_EXHAUSTED", 503);
}

async function createIdentity(request, env) {
  const ipHash = await sha256Hex(ipFingerprint(request));
  await rateLimit(env, `identity:${ipHash}`, 20, 60 * 60_000);
  const body = await readJson(request, 4_096);
  const displayName = boundedString(body.displayName, 1, 80, "DISPLAY_NAME_INVALID");
  const userId = randomId("usr_");
  const code = await pairingCode(env);
  const token = randomToken();
  const sessionHash = await sha256Hex(token);
  const now = nowMs();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO identities(user_id,display_name,pairing_code,created_at_ms) VALUES(?,?,?,?)").bind(userId, displayName, code, now),
    env.DB.prepare("INSERT INTO sessions(session_hash,user_id,created_at_ms) VALUES(?,?,?)").bind(sessionHash, userId, now),
  ]);
  const headers = { "set-cookie": `zungun_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000` };
  const browser = body.client === "browser";
  return json({ ok: true, identity: { userId, displayName, pairingCode: code }, ...(browser ? {} : { sessionToken: token }) }, 201, headers);
}
async function me(request, env) {
  const user = await authenticate(request, env);
  return json({ ok: true, identity: { userId: user.user_id, displayName: user.display_name, pairingCode: user.pairing_code } });
}
async function revoke(request, env) {
  const user = await authenticate(request, env);
  await env.DB.prepare("UPDATE sessions SET revoked_at_ms=? WHERE session_hash=?").bind(nowMs(), user.sessionHash).run();
  return json({ ok: true }, 200, { "set-cookie": "zungun_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" });
}
async function lookupPairing(request, env, code) {
  const user = await authenticate(request, env);
  await rateLimit(env, `pairing:${user.sessionHash}`, 60, 60_000);
  if (!/^[A-Z2-9]{6,12}$/.test(code)) throw new HttpError("PAIRING_CODE_INVALID", 400);
  const row = await env.DB.prepare("SELECT user_id,display_name,pairing_code FROM identities WHERE pairing_code=? AND revoked_at_ms IS NULL").bind(code).first();
  if (!row) throw new HttpError("IDENTITY_NOT_FOUND", 404);
  return json({ ok: true, identity: { userId: row.user_id, displayName: row.display_name, pairingCode: row.pairing_code } });
}

async function createWorkOrder(request, env) {
  const user = await authenticate(request, env);
  await rateLimit(env, `work-create:${user.sessionHash}`, 30, 60_000);
  const body = await readJson(request, 8_192);
  const title = boundedString(body.title, 1, 120, "TITLE_INVALID");
  const description = typeof body.description === "string" && body.description.length <= 1000 ? body.description.trim() : (() => { throw new HttpError("DESCRIPTION_INVALID", 400); })();
  const location = body.locationText == null || body.locationText === "" ? null : boundedString(body.locationText, 1, 240, "LOCATION_INVALID");
  const assigneeCode = boundedString(body.assigneeCode, 6, 12, "ASSIGNEE_CODE_INVALID").toUpperCase();
  const expiresAtMs = Number(body.expiresAtMs);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs() + 30_000 || expiresAtMs > nowMs() + 30 * 86400_000) throw new HttpError("EXPIRY_INVALID", 400);
  const assignee = await env.DB.prepare("SELECT user_id FROM identities WHERE pairing_code=? AND revoked_at_ms IS NULL").bind(assigneeCode).first();
  if (!assignee) throw new HttpError("ASSIGNEE_NOT_FOUND", 404);
  const id = randomId("wo_"); const now = nowMs();
  await env.DB.prepare(`INSERT INTO work_orders(work_order_id,creator_user_id,assignee_user_id,title,description,location_text,expires_at_ms,status,revision,created_at_ms,updated_at_ms)
    VALUES(?,?,?,?,?,?,?,'OPEN',1,?,?)`).bind(id, user.user_id, assignee.user_id, title, description, location, expiresAtMs, now, now).run();
  return json({ ok: true, workOrder: { workOrderId: id, title, description, locationText: location, assigneeUserId: assignee.user_id, expiresAtMs, status: "OPEN", revision: 1 } }, 201);
}
async function listWorkOrders(request, env, mode) {
  const user = await authenticate(request, env);
  const now = nowMs();
  await env.DB.prepare("UPDATE work_orders SET status='EXPIRED',updated_at_ms=? WHERE status='OPEN' AND expires_at_ms<=?").bind(now, now).run();
  const column = mode === "created" ? "creator_user_id" : "assignee_user_id";
  const rows = (await env.DB.prepare(`SELECT work_order_id,title,description,location_text,expires_at_ms,status,revision,terminal_note,effect_operation_id,created_at_ms,updated_at_ms FROM work_orders WHERE ${column}=? ORDER BY created_at_ms DESC LIMIT 100`).bind(user.user_id).all()).results || [];
  return json({ ok: true, items: rows.map(workOrderJson) });
}
function workOrderJson(row) {
  return { workOrderId: row.work_order_id, title: row.title, description: row.description, locationText: row.location_text, expiresAtMs: Number(row.expires_at_ms), status: row.status, revision: Number(row.revision), terminalNote: row.terminal_note, effectOperationId: row.effect_operation_id, createdAtMs: Number(row.created_at_ms), updatedAtMs: Number(row.updated_at_ms) };
}
async function getWorkOrder(request, env, id) {
  const user = await authenticate(request, env);
  const row = await env.DB.prepare("SELECT * FROM work_orders WHERE work_order_id=?").bind(id).first();
  if (!row) throw new HttpError("WORK_ORDER_NOT_FOUND", 404);
  if (row.creator_user_id !== user.user_id && row.assignee_user_id !== user.user_id) throw new HttpError("FORBIDDEN", 403);
  return json({ ok: true, workOrder: workOrderJson(row) });
}

function decodeFieldPayload(envelope) {
  let raw;
  try { raw = decoder.decode(unbase64(envelope.payloadBase64)); } catch { throw new HttpError("PAYLOAD_INVALID", 400); }
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new HttpError("PAYLOAD_INVALID", 400); }
  if (payload.kind !== "ZUNGUN_FIELD_ACTION_V1") throw new HttpError("FIELD_PAYLOAD_KIND_INVALID", 400);
  if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 1) throw new HttpError("EXPECTED_REVISION_INVALID", 400);
  if (!['COMPLETE','COULD_NOT_COMPLETE'].includes(payload.action)) throw new HttpError("FIELD_ACTION_INVALID", 400);
  const note = payload.note == null ? "" : String(payload.note).trim();
  if (note.length > 500 || (payload.action === "COULD_NOT_COMPLETE" && note.length < 1)) throw new HttpError("FIELD_NOTE_INVALID", 400);
  return { action: payload.action, note, expectedRevision: payload.expectedRevision };
}
function validateEnvelope(body) {
  if (body?.protocol !== "zungun.operation.v1" || body?.wireVersion !== 1) throw new HttpError("OPERATION_PROTOCOL_INVALID", 400);
  for (const key of ["operationId","idempotencyKey","tenantId","scopeType","scopeId","workOrderId","messageId","messageCommitment","payloadBase64","contentType","replayNonce"]) boundedString(body[key], 1, key === "payloadBase64" ? 90_000 : 256, `OPERATION_${key.toUpperCase()}_INVALID`);
  if (body.contentType !== "application/vnd.zungun.field-action+json") throw new HttpError("CONTENT_TYPE_INVALID", 415);
  const p = body.policy || {};
  for (const key of ["createdAtMs","expiresAtMs","retryBudget","maxPayloadBytes"]) if (!Number.isSafeInteger(Number(p[key]))) throw new HttpError("POLICY_INVALID", 400);
  const priority=Number(p.priority), createdAtMs=Number(p.createdAtMs), expiresAtMs=Number(p.expiresAtMs), retryBudget=Number(p.retryBudget), maxPayloadBytes=Number(p.maxPayloadBytes);
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 100 || typeof p.cancellationAllowed !== "boolean" || expiresAtMs <= createdAtMs || createdAtMs > nowMs() + 300_000 || expiresAtMs <= nowMs() || retryBudget < 0 || retryBudget > 100 || maxPayloadBytes < 1 || maxPayloadBytes > 64_000 || p.semanticRevalidationRequired !== true) throw new HttpError("POLICY_INVALID", 400);
  return body;
}
async function receiptFor(env, envelope, applicationOutcome, applicationReference, issuedAtMs) {
  if (!env.ZUNGUN_SIGNING_PRIVATE_KEY || !env.ZUNGUN_SIGNING_KEY_ID) throw new HttpError("SIGNING_KEY_UNAVAILABLE", 503);
  const keyRow = await env.DB.prepare("SELECT * FROM receipt_keys WHERE key_id=? AND revoked_at_ms IS NULL").bind(env.ZUNGUN_SIGNING_KEY_ID).first();
  if (!keyRow) throw new HttpError("SIGNING_KEY_NOT_REGISTERED", 503);
  const payload = {
    schema: "zungun.execution-receipt.v1", protocolVersion: 1,
    operationId: envelope.operationId, messageCommitment: envelope.messageCommitment,
    receiverId: "zungun-cloudflare-order083", applicationOutcome, applicationReference,
    scopeType: envelope.scopeType, scopeId: envelope.scopeId, issuedAtMs,
    validFromMs: issuedAtMs - 1, validUntilMs: Math.min(issuedAtMs + 86_400_000, Number(keyRow.valid_until_ms)), replayNonce: envelope.replayNonce,
  };
  const payloadJson = canonicalize(payload);
  const payloadSha256 = await sha256Hex(payloadJson);
  const key = await crypto.subtle.importKey("pkcs8", unbase64(env.ZUNGUN_SIGNING_PRIVATE_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signatureRaw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(payloadJson)));
  const signatureDer = signatureRaw.length === 64 ? p1363ToDer(signatureRaw) : signatureRaw;
  return { keyId: env.ZUNGUN_SIGNING_KEY_ID, algorithm: "ECDSA_P256_SHA256", payload, signatureBase64: base64(signatureDer), payloadSha256 };
}
function p1363ToDer(sig) {
  const encodeInt = (part) => {
    let i = 0; while (i < part.length - 1 && part[i] === 0) i++;
    let body = part.slice(i); if (body[0] & 0x80) body = Uint8Array.from([0, ...body]);
    return Uint8Array.from([0x02, body.length, ...body]);
  };
  const r = encodeInt(sig.slice(0, 32)); const s = encodeInt(sig.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}
async function proof(env, operationId, subjectType, kind, evidenceClass, reference, detail) {
  const at = nowMs(); const detailJson = canonicalize(detail); const hash = await sha256Hex(`${operationId}|${subjectType}|${kind}|${evidenceClass}|${at}|${reference}|${detailJson}`);
  await env.DB.prepare("INSERT OR IGNORE INTO proof_events(operation_id,subject_type,kind,evidence_class,occurred_at_ms,reference,detail_json,sha256) VALUES(?,?,?,?,?,?,?,?)").bind(operationId, subjectType, kind, evidenceClass, at, reference, detailJson, hash).run();
}
function validateWitnessChain(operationId, chain) {
  if (!Array.isArray(chain) || chain.length !== 3) throw new HttpError("WITNESS_CHAIN_INVALID", 400);
  const requiredStates = ["DETECTED", "COMMITTED_LOCAL", "CUSTODY_ACCEPTED"];
  let previousHash = null; let previousState = null; let previousPosition = -1; let previousMonotonic = -1;
  return chain.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new HttpError("WITNESS_EVENT_INVALID", 400);
    const event = structuredClone(entry);
    const evidenceHash = boundedString(event.evidenceHash, 71, 71, "WITNESS_HASH_INVALID");
    delete event.evidenceHash;
    if (event.schemaVersion !== "zungun-witness/1" || event.incidentId !== operationId) throw new HttpError("WITNESS_SCOPE_MISMATCH", 409);
    const evidenceId = boundedString(event.evidenceId, 8, 220, "WITNESS_EVIDENCE_ID_INVALID");
    const state = boundedString(event.state, 1, 64, "WITNESS_STATE_INVALID");
    if (state !== requiredStates[previousPosition + 1] || event.evidenceClass !== "MACHINE_ASSERTION") throw new HttpError("WITNESS_CLASS_INVALID", 400);
    boundedString(event.emitterId, 3, 220, "WITNESS_EMITTER_INVALID");
    boundedString(event.authorizationScope, 3, 120, "WITNESS_AUTH_SCOPE_INVALID");
    boundedString(event.provenance, 3, 120, "WITNESS_PROVENANCE_INVALID");
    boundedString(event.reasonCode, 3, 120, "WITNESS_REASON_INVALID");
    if (!event.claims || typeof event.claims !== "object" || Array.isArray(event.claims)) throw new HttpError("WITNESS_CLAIMS_INVALID", 400);
    const observedAtMs = Number(event.observedAtMs), monotonicMs = Number(event.monotonicMs), position = Number(event.chainPosition);
    if (![observedAtMs, monotonicMs, position].every(Number.isSafeInteger) || observedAtMs < 0 || monotonicMs < 0 || position !== previousPosition + 1 || monotonicMs <= previousMonotonic) throw new HttpError("WITNESS_ORDER_INVALID", 409);
    const claimedPrevious = event.previousHash ?? null, claimedPreviousState = event.previousState ?? null;
    if (claimedPrevious !== previousHash) throw new HttpError("WITNESS_PREVIOUS_HASH_MISMATCH", 409);
    if (claimedPreviousState !== previousState) throw new HttpError("WITNESS_PREVIOUS_STATE_MISMATCH", 409);
    if (!/^sha256:[0-9a-f]{64}$/.test(evidenceHash)) throw new HttpError("WITNESS_HASH_INVALID", 400);
    previousHash = evidenceHash; previousState = state; previousPosition = position; previousMonotonic = monotonicMs;
    return { event, evidenceId, evidenceHash, state, observedAtMs, position };
  });
}
async function ingestWitnessChain(request, env, operationId) {
  const user = await authenticate(request, env);
  await rateLimit(env, `witness:${user.sessionHash}`, 120, 60_000);
  const field = await env.DB.prepare("SELECT f.user_id,w.assignee_user_id FROM field_operations f JOIN work_orders w ON w.work_order_id=f.work_order_id WHERE f.operation_id=?").bind(operationId).first();
  if (!field) throw new HttpError("OPERATION_NOT_FOUND", 404);
  if (field.user_id !== user.user_id || field.assignee_user_id !== user.user_id) throw new HttpError("FORBIDDEN", 403);
  const body = await readJson(request, 64_000);
  const events = validateWitnessChain(operationId, body.chain);
  const suppliedNow = Number(body.nowMs);
  if (!Number.isSafeInteger(suppliedNow) || suppliedNow < 0 || events.some((item) => item.observedAtMs > nowMs() + 300_000)) throw new HttpError("WITNESS_TIME_INVALID", 400);
  for (const item of events) {
    const canonicalBody = canonicalize(item.event);
    if (`sha256:${await sha256Hex(canonicalBody)}` !== item.evidenceHash) throw new HttpError("WITNESS_HASH_MISMATCH", 409);
    const canonicalWitness = canonicalize({ ...item.event, evidenceHash: item.evidenceHash });
    const stableHash = await sha256Hex(canonicalWitness);
    const detail = canonicalize({
      schemaVersion: "zungun-witness/1",
      sourceEvidenceClass: "MACHINE_ASSERTION",
      state: item.state,
      chainPosition: item.position,
      evidenceHash: item.evidenceHash,
      emitterId: item.event.emitterId,
      authorizationScope: item.event.authorizationScope,
      provenance: item.event.provenance,
      reasonCode: item.event.reasonCode,
      claims: item.event.claims,
    });
    await env.DB.prepare("INSERT OR IGNORE INTO proof_events(operation_id,subject_type,kind,evidence_class,occurred_at_ms,reference,detail_json,sha256) VALUES(?,?,?,?,?,?,?,?)")
      .bind(operationId, "FIELD", `ANDROID_WITNESS_${item.state}`, "OBSERVED", item.observedAtMs, item.evidenceId, detail, stableHash).run();
  }
  return json({ ok: true, operationId, accepted: events.length, evidenceClass: "OBSERVED" }, 200);
}
async function applyFieldOperation(request, env) {
  const user = await authenticate(request, env);
  await rateLimit(env, `field:${user.sessionHash}`, 60, 60_000);
  const envelope = validateEnvelope(await readJson(request, 96_000));
  const field = decodeFieldPayload(envelope);
  let exactPayload; try { exactPayload=unbase64(envelope.payloadBase64); } catch { throw new HttpError("PAYLOAD_INVALID",400); }
  if (exactPayload.length > Number(envelope.policy.maxPayloadBytes)) throw new HttpError("BODY_TOO_LARGE",413);
  if (await sha256Hex(exactPayload) !== envelope.messageCommitment) throw new HttpError("MESSAGE_COMMITMENT_MISMATCH",409);
  const envelopeHash = await sha256Hex(canonicalize(envelope));
  const existing = await env.DB.prepare("SELECT * FROM field_operations WHERE operation_id=?").bind(envelope.operationId).first();
  if (existing) {
    if (existing.envelope_hash !== envelopeHash) throw new HttpError("IDEMPOTENCY_CONFLICT", 409);
    return json({ ok: true, duplicate: true, state: existing.state, receipt: existing.receipt_json ? JSON.parse(existing.receipt_json) : null }, 202);
  }
  const work = await env.DB.prepare("SELECT * FROM work_orders WHERE work_order_id=?").bind(envelope.workOrderId).first();
  if (!work) throw new HttpError("WORK_ORDER_NOT_FOUND", 404);
  if (work.assignee_user_id !== user.user_id) throw new HttpError("FORBIDDEN", 403);
  if (envelope.scopeType !== "WORK_ORDER" || envelope.scopeId !== work.work_order_id) throw new HttpError("SCOPE_MISMATCH", 409);
  const now = nowMs();
  if (Number(work.expires_at_ms) <= now) {
    await env.DB.prepare("UPDATE work_orders SET status='EXPIRED',updated_at_ms=? WHERE work_order_id=? AND status='OPEN'").bind(now, work.work_order_id).run();
    throw new HttpError("WORK_ORDER_EXPIRED", 410);
  }
  if (work.status !== "OPEN" || Number(work.revision) !== field.expectedRevision) throw new HttpError("SEMANTIC_REVALIDATION_FAILED", 409);
  const applicationOutcome = field.action === "COMPLETE" ? "EFFECT_APPLIED" : "REJECTED";
  const applicationReference = `wo:${work.work_order_id}:revision:${Number(work.revision) + 1}`;
  const receipt = await receiptFor(env, envelope, applicationOutcome, applicationReference, now);
  const nextStatus = field.action === "COMPLETE" ? "COMPLETED" : "COULD_NOT_COMPLETE";
  const opState = field.action === "COMPLETE" ? "COMPLETED" : "REJECTED";
  try {
    await env.DB.prepare(`INSERT INTO field_operations(operation_id,idempotency_key,work_order_id,user_id,envelope_hash,message_commitment,replay_nonce,action,note,expected_revision,state,application_outcome,receipt_json,accepted_at_ms,applied_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(envelope.operationId,envelope.idempotencyKey,work.work_order_id,user.user_id,envelopeHash,envelope.messageCommitment,envelope.replayNonce,field.action,field.note,field.expectedRevision,opState,applicationOutcome,JSON.stringify(receipt),now,now).run();
  } catch (e) {
    const raced = await env.DB.prepare("SELECT * FROM field_operations WHERE operation_id=? OR idempotency_key=? OR replay_nonce=?").bind(envelope.operationId,envelope.idempotencyKey,envelope.replayNonce).first();
    if (raced?.operation_id === envelope.operationId && raced.envelope_hash === envelopeHash) return json({ ok:true,duplicate:true,state:raced.state,receipt:raced.receipt_json?JSON.parse(raced.receipt_json):null },202);
    if (raced) throw new HttpError("IDEMPOTENCY_CONFLICT",409);
    if (String(e?.message||e).includes("SEMANTIC_REVALIDATION_FAILED")) throw new HttpError("SEMANTIC_REVALIDATION_FAILED",409);
    throw e;
  }
  const applied = await env.DB.prepare("SELECT effect_operation_id,status FROM work_orders WHERE work_order_id=?").bind(work.work_order_id).first();
  if (!applied || applied.effect_operation_id !== envelope.operationId) throw new HttpError("FIELD_EFFECT_NOT_APPLIED", 409);
  await proof(env, envelope.operationId, "FIELD", "DURABLE_ACCEPT", "VERIFIED", work.work_order_id, { state: opState });
  await proof(env, envelope.operationId, "FIELD", "BUSINESS_EFFECT", "VERIFIED", applicationReference, { status: nextStatus });
  if (await consumeOrder083Fault(env, envelope.operationId, "DROP_AFTER_DURABLE_ACCEPT")) {
    throw new Error("ORDER083_DROP_AFTER_DURABLE_ACCEPT");
  }
  return json({ ok: true, duplicate: false, state: opState, receipt }, 202);
}
async function getFieldOperation(request, env, operationId) {
  const user = await authenticate(request, env);
  const row = await env.DB.prepare(`SELECT f.*,w.creator_user_id,w.assignee_user_id FROM field_operations f JOIN work_orders w ON w.work_order_id=f.work_order_id WHERE f.operation_id=?`).bind(operationId).first();
  if (!row) throw new HttpError("OPERATION_NOT_FOUND", 404);
  if (![row.user_id,row.creator_user_id,row.assignee_user_id].includes(user.user_id)) throw new HttpError("FORBIDDEN",403);
  return json({ ok:true, operation:{ operation_id:row.operation_id,state:row.state,application_outcome:row.application_outcome,work_order_id:row.work_order_id,accepted_at_ms:Number(row.accepted_at_ms),applied_at_ms:Number(row.applied_at_ms) }, receipt: row.receipt_json ? JSON.parse(row.receipt_json) : null });
}
async function keys(request, env) {
  await authenticate(request, env);
  const rows = (await env.DB.prepare("SELECT key_id,public_key_pem,valid_from_ms,valid_until_ms,revoked_at_ms FROM receipt_keys ORDER BY valid_from_ms DESC LIMIT 20").all()).results || [];
  return json({ items: rows.map((r) => ({ keyId:r.key_id, publicKeyPem:r.public_key_pem, validFromMs:Number(r.valid_from_ms), validUntilMs:Number(r.valid_until_ms), revokedAtMs:r.revoked_at_ms == null ? null : Number(r.revoked_at_ms) })) });
}
async function proofTimeline(request, env, operationId) {
  const user = await authenticate(request, env);
  const field = await env.DB.prepare("SELECT f.operation_id,w.creator_user_id,w.assignee_user_id FROM field_operations f JOIN work_orders w ON w.work_order_id=f.work_order_id WHERE f.operation_id=?").bind(operationId).first();
  let allowed = Boolean(field && [field.creator_user_id,field.assignee_user_id].includes(user.user_id));
  if (!allowed) {
    const hint = await env.DB.prepare("SELECT subject_type,reference FROM proof_events WHERE operation_id=? ORDER BY id ASC LIMIT 1").bind(operationId).first();
    if (hint?.subject_type === "MESSAGE") { await requireConversation(env,user.user_id,String(hint.reference)); allowed = true; }
  }
  if (!allowed) throw new HttpError("FORBIDDEN",403);
  const rows = (await env.DB.prepare("SELECT subject_type,kind,evidence_class,occurred_at_ms,reference,detail_json,sha256 FROM proof_events WHERE operation_id=? ORDER BY id ASC").bind(operationId).all()).results || [];
  return json({ ok:true, operationId, events:rows.map((r)=>({ subjectType:r.subject_type,kind:r.kind,evidenceClass:r.evidence_class,occurredAtMs:Number(r.occurred_at_ms),reference:r.reference,detail:JSON.parse(r.detail_json),sha256:r.sha256 })) });
}

async function conversationFor(request, env, pairing) {
  const user = await authenticate(request, env); await rateLimit(env,`conv-create:${user.sessionHash}`,30,60_000);
  const pairingCode = boundedString(pairing,6,12,"PAIRING_CODE_INVALID").toUpperCase();
  if(!/^[A-Z2-9]+$/.test(pairingCode)) throw new HttpError("PAIRING_CODE_INVALID",400);
  const peer = await env.DB.prepare("SELECT user_id,display_name,pairing_code FROM identities WHERE pairing_code=? AND revoked_at_ms IS NULL").bind(pairingCode).first();
  if (!peer) throw new HttpError("IDENTITY_NOT_FOUND",404); if (peer.user_id === user.user_id) throw new HttpError("SELF_CONVERSATION_NOT_ALLOWED",409);
  const [a,b] = [user.user_id,peer.user_id].sort(); const id = `cv_${(await sha256Hex(`${a}|${b}`)).slice(0,40)}`; const now=nowMs();
  await env.DB.prepare("INSERT OR IGNORE INTO conversations(conversation_id,member_a,member_b,created_at_ms) VALUES(?,?,?,?)").bind(id,a,b,now).run();
  return json({ok:true,conversation:{conversationId:id,peer:{userId:peer.user_id,displayName:peer.display_name,pairingCode:peer.pairing_code}}},201);
}
async function requireConversation(env,userId,id){const row=await env.DB.prepare("SELECT * FROM conversations WHERE conversation_id=?").bind(id).first();if(!row)throw new HttpError("CONVERSATION_NOT_FOUND",404);if(row.member_a!==userId&&row.member_b!==userId)throw new HttpError("FORBIDDEN",403);return row}
async function listConversations(request,env){const user=await authenticate(request,env);const rows=(await env.DB.prepare(`SELECT c.conversation_id,c.member_a,c.member_b,c.created_at_ms,ia.display_name AS a_name,ib.display_name AS b_name,ia.pairing_code AS a_code,ib.pairing_code AS b_code FROM conversations c JOIN identities ia ON ia.user_id=c.member_a JOIN identities ib ON ib.user_id=c.member_b WHERE c.member_a=? OR c.member_b=? ORDER BY c.created_at_ms DESC LIMIT 100`).bind(user.user_id,user.user_id).all()).results||[];return json({ok:true,items:rows.map(r=>({conversationId:r.conversation_id,createdAtMs:Number(r.created_at_ms),peer:r.member_a===user.user_id?{userId:r.member_b,displayName:r.b_name,pairingCode:r.b_code}:{userId:r.member_a,displayName:r.a_name,pairingCode:r.a_code}}))})}
async function sendMessage(request,env,id){const user=await authenticate(request,env);await requireConversation(env,user.user_id,id);await rateLimit(env,`msg:${user.sessionHash}`,120,60_000);const body=await readJson(request,12_000);const messageId=boundedString(body.messageId,8,128,"MESSAGE_ID_INVALID");const text=body.body;if(typeof text!=="string"||text.length<1||text.length>2000)throw new HttpError("MESSAGE_BODY_INVALID",400);const clientCreatedAtMs=Number(body.clientCreatedAtMs);if(!Number.isSafeInteger(clientCreatedAtMs)||Math.abs(nowMs()-clientCreatedAtMs)>30*86400_000)throw new HttpError("MESSAGE_TIME_INVALID",400);const bodyHash=await sha256Hex(text);const result=await env.CONVERSATIONS.getByName(id).sendMessage({messageId,senderId:user.user_id,body:text,bodyHash,clientCreatedAtMs,acceptedAtMs:nowMs()});if(result.conflict)throw new HttpError("MESSAGE_ID_CONFLICT",409);await proof(env,messageId,"MESSAGE","DURABLE_ACCEPT","VERIFIED",id,{sequence:result.message.sequence,state:"SENT"});if(await consumeOrder083Fault(env,messageId,"DROP_AFTER_DURABLE_ACCEPT"))throw new Error("ORDER083_DROP_AFTER_DURABLE_ACCEPT");return json({ok:true,duplicate:result.duplicate,state:result.message.deliveredAtMs?"DELIVERED":"SENT",message:result.message},result.duplicate?200:201)}
async function history(request,env,id){const user=await authenticate(request,env);await requireConversation(env,user.user_id,id);const url=new URL(request.url);const after=Math.max(0,Number(url.searchParams.get("after")||0));const items=await env.CONVERSATIONS.getByName(id).history(after,200);return json({ok:true,items})}
async function getMessage(request,env,id,messageId){const user=await authenticate(request,env);await requireConversation(env,user.user_id,id);const msg=await env.CONVERSATIONS.getByName(id).getMessage(messageId);if(!msg)throw new HttpError("MESSAGE_NOT_FOUND",404);return json({ok:true,state:msg.deliveredAtMs?"DELIVERED":"SENT",message:msg})}
async function ackMessage(request,env,id,messageId){const user=await authenticate(request,env);await requireConversation(env,user.user_id,id);const result=await env.CONVERSATIONS.getByName(id).ackMessage(messageId,user.user_id,nowMs());if(result.notFound)throw new HttpError("MESSAGE_NOT_FOUND",404);if(result.forbidden)throw new HttpError("SENDER_CANNOT_DELIVERY_ACK",403);await proof(env,messageId,"MESSAGE","RECIPIENT_DELIVERY_ACK","VERIFIED",id,{recipientId:user.user_id,deliveredAtMs:result.message.deliveredAtMs});return json({ok:true,duplicate:result.duplicate,state:"DELIVERED",message:result.message})}
async function websocket(request,env,id){const user=await authenticate(request,env);await requireConversation(env,user.user_id,id);const stub=env.CONVERSATIONS.getByName(id);const headers=new Headers(request.headers);headers.set("x-zungun-user-id",user.user_id);return stub.fetch(new Request("https://do/ws",{headers}));}

async function asset(request,env,path){const url=new URL(request.url);url.pathname=path;const response=await env.ASSETS.fetch(new Request(url,request));const headers=new Headers(response.headers);for(const [k,v] of Object.entries(SECURITY_HEADERS))headers.set(k,v);return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
async function route(request,env){const url=new URL(request.url);const path=url.pathname;let m; if(url.protocol!=="https:"&&url.hostname!=="localhost")throw new HttpError("HTTPS_REQUIRED",400);
  if(request.method==="GET"&&path==="/health")return json({ok:true,service:"zungun",order:"ORDER-083",environment:env.ZUNGUN_ENVIRONMENT||"production"});
  if(request.method==="GET"&&path==="/version")return json({ok:true,order:env.ZUNGUN_ORDER||"ORDER-083",sourceBundleSha256:env.ZUNGUN_SOURCE_BUNDLE_SHA256,staticAssetManifestSha256:env.ZUNGUN_STATIC_ASSET_MANIFEST_SHA256,migrationManifestSha256:env.ZUNGUN_MIGRATION_MANIFEST_SHA256,worker:"zungun"});
  if(request.method==="POST"&&path==="/api/v1/_order083/faults")return setOrder083Fault(request,env);
  if(request.method==="POST"&&(m=/^\/api\/v1\/_order083\/work-orders\/(wo_[a-f0-9]{32})\/expire$/.exec(path)))return expireOrder083Work(request,env,m[1]);
  if(request.method==="GET"&&(m=/^\/api\/v1\/_order083\/diagnostics\/([^/]+)$/.exec(path)))return order083Diagnostics(request,env,decodeURIComponent(m[1]));
  if(request.method==="POST"&&path==="/api/v1/identity")return createIdentity(request,env);
  if(request.method==="GET"&&path==="/api/v1/me")return me(request,env);
  if(request.method==="POST"&&path==="/api/v1/session/revoke")return revoke(request,env);
  if(request.method==="GET"&&(m=/^\/api\/v1\/pairing\/([A-Z2-9]{6,12})$/.exec(path)))return lookupPairing(request,env,m[1]);
  if(request.method==="POST"&&path==="/api/v1/work-orders")return createWorkOrder(request,env);
  if(request.method==="GET"&&path==="/api/v1/work-orders")return listWorkOrders(request,env,url.searchParams.get("mode")==="created"?"created":"assigned");
  if(request.method==="GET"&&(m=/^\/api\/v1\/work-orders\/(wo_[a-f0-9]{32})$/.exec(path)))return getWorkOrder(request,env,m[1]);
  if(request.method==="POST"&&path==="/api/v1/operations")return applyFieldOperation(request,env);
  if(request.method==="POST"&&(m=/^\/api\/v1\/operations\/([^/]+)\/witness\/ingest$/.exec(path)))return ingestWitnessChain(request,env,decodeURIComponent(m[1]));
  if(request.method==="GET"&&(m=/^\/api\/v1\/operations\/([^/]+)$/.exec(path)))return getFieldOperation(request,env,decodeURIComponent(m[1]));
  if(request.method==="GET"&&path==="/api/v1/keys")return keys(request,env);
  if(request.method==="GET"&&(m=/^\/api\/v1\/proof\/([^/]+)$/.exec(path)))return proofTimeline(request,env,decodeURIComponent(m[1]));
  if(request.method==="POST"&&path==="/api/v1/conversations") { const b=await readJson(request,4096);return conversationFor(request,env,b.pairingCode||""); }
  if(request.method==="GET"&&path==="/api/v1/conversations")return listConversations(request,env);
  if((m=/^\/api\/v1\/conversations\/(cv_[a-f0-9]{40})(?:\/(.*))?$/.exec(path))){const id=m[1],rest=m[2]||"";if(request.method==="GET"&&rest==="messages")return history(request,env,id);if(request.method==="POST"&&rest==="messages")return sendMessage(request,env,id);if(request.method==="GET"&&rest==="ws")return websocket(request,env,id);let mm;if((mm=/^messages\/([^/]+)$/.exec(rest))&&request.method==="GET")return getMessage(request,env,id,decodeURIComponent(mm[1]));if((mm=/^messages\/([^/]+)\/ack$/.exec(rest))&&request.method==="POST")return ackMessage(request,env,id,decodeURIComponent(mm[1]));}
  if(request.method==="GET"&&path==="/chat")return Response.redirect(new URL("/chat/",url).toString(),308);
  if(request.method==="GET"&&path==="/chat/")return asset(request,env,"/chat/index.html");
  if(request.method==="GET"&&path==="/")return asset(request,env,"/index.html");
  if(request.method==="GET"&&path==="/control")return asset(request,env,"/control/index.html");
  if(request.method==="GET"&&path==="/messages")return asset(request,env,"/messages/index.html");
  if(request.method==="GET"&&path==="/developers")return asset(request,env,"/developers/index.html");
  if(request.method==="GET"&&path==="/ops")return asset(request,env,"/ops/index.html");
  if(request.method==="GET"&&path==="/ops/legacy")return asset(request,env,"/ops/legacy/index.html");
  return asset(request,env,path);
}

export default { async fetch(request,env){try{return await route(request,env)}catch(e){if(e instanceof HttpError)return error(e.code,e.status);console.error("zungun-request-failed",{name:e?.name||"Error",code:e?.code||"UNEXPECTED"});throw e;}} };

export class ConversationDurableObject extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;ctx.blockConcurrencyWhile(async()=>{ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS messages(sequence INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT NOT NULL UNIQUE,sender_id TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,client_created_at_ms INTEGER NOT NULL,accepted_at_ms INTEGER NOT NULL,delivered_at_ms INTEGER,delivered_by TEXT)`);ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS messages_accepted_idx ON messages(accepted_at_ms)`);});}
  row(r){return r?{sequence:Number(r.sequence),messageId:r.message_id,senderId:r.sender_id,body:r.body,bodyHash:r.body_hash,clientCreatedAtMs:Number(r.client_created_at_ms),acceptedAtMs:Number(r.accepted_at_ms),deliveredAtMs:r.delivered_at_ms==null?null:Number(r.delivered_at_ms),deliveredBy:r.delivered_by||null}:null}
  async sendMessage(input){const existing=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE message_id=?",input.messageId).toArray()[0];if(existing){if(existing.body_hash!==input.bodyHash||existing.sender_id!==input.senderId)return{conflict:true};return{conflict:false,duplicate:true,message:this.row(existing)}};this.ctx.storage.sql.exec("INSERT INTO messages(message_id,sender_id,body,body_hash,client_created_at_ms,accepted_at_ms) VALUES(?,?,?,?,?,?)",input.messageId,input.senderId,input.body,input.bodyHash,input.clientCreatedAtMs,input.acceptedAtMs);const created=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE message_id=?",input.messageId).toArray()[0];this.broadcast({type:"message",message:this.row(created)});return{conflict:false,duplicate:false,message:this.row(created)}}
  async history(after=0,limit=200){return this.ctx.storage.sql.exec("SELECT * FROM messages WHERE sequence>? ORDER BY sequence ASC LIMIT ?",after,Math.min(200,Math.max(1,limit))).toArray().map(r=>this.row(r))}
  async getMessage(messageId){return this.row(this.ctx.storage.sql.exec("SELECT * FROM messages WHERE message_id=?",messageId).toArray()[0])}
  async ackMessage(messageId,userId,at){const row=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE message_id=?",messageId).toArray()[0];if(!row)return{notFound:true};if(row.sender_id===userId)return{forbidden:true};if(row.delivered_at_ms!=null)return{duplicate:true,message:this.row(row)};this.ctx.storage.sql.exec("UPDATE messages SET delivered_at_ms=?,delivered_by=? WHERE message_id=? AND delivered_at_ms IS NULL",at,userId,messageId);const updated=this.ctx.storage.sql.exec("SELECT * FROM messages WHERE message_id=?",messageId).toArray()[0];this.broadcast({type:"delivery_ack",messageId,deliveredAtMs:Number(updated.delivered_at_ms),deliveredBy:updated.delivered_by});return{duplicate:false,message:this.row(updated)}}
  async fetch(request){if(request.headers.get("upgrade")?.toLowerCase()!=="websocket")return new Response("upgrade required",{status:426});const userId=request.headers.get("x-zungun-user-id");if(!userId)return new Response("unauthorized",{status:401});const pair=new WebSocketPair();const client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server,[`user:${userId}`]);server.send(JSON.stringify({type:"ready"}));return new Response(null,{status:101,webSocket:client})}
  webSocketMessage(ws,message){if(message==="ping")ws.send("pong")}
  webSocketError(ws){try{ws.close(1011,"socket error")}catch{}}
  broadcast(payload){const text=JSON.stringify(payload);for(const ws of this.ctx.getWebSockets()){try{ws.send(text)}catch{}}}
}

export const __test = { canonicalize, p1363ToDer, decodeFieldPayload, validateEnvelope, sha256Hex };
