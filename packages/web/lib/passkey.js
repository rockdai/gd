'use strict';

function parseCredentialEntries(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    err.message = `PASSKEY_CREDENTIALS_JSON is not valid JSON: ${err.message}`;
    throw err;
  }

  const list = Array.isArray(parsed) ? parsed : [ parsed ];
  return list.map((entry, index) => normalizeCredentialEntry(entry, index));
}

function normalizeCredentialEntry(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`PASSKEY_CREDENTIALS_JSON[${index}] must be an object`);
  }

  const normalized = {
    id: readRequiredString(entry.id, `PASSKEY_CREDENTIALS_JSON[${index}].id`),
    publicKey: readRequiredString(entry.publicKey, `PASSKEY_CREDENTIALS_JSON[${index}].publicKey`),
    counter: readOptionalCounter(entry.counter, `PASSKEY_CREDENTIALS_JSON[${index}].counter`),
  };

  if (Array.isArray(entry.transports)) {
    normalized.transports = entry.transports
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof entry.deviceType === 'string' && entry.deviceType.trim()) {
    normalized.deviceType = entry.deviceType.trim();
  }

  if (typeof entry.createdAt === 'string' && entry.createdAt.trim()) {
    normalized.createdAt = entry.createdAt.trim();
  }

  if (typeof entry.label === 'string' && entry.label.trim()) {
    normalized.label = entry.label.trim();
  }

  if (typeof entry.backedUp === 'boolean') {
    normalized.backedUp = entry.backedUp;
  }

  return normalized;
}

function readRequiredString(value, fieldName) {
  const str = String(value || '').trim();
  if (!str) {
    throw new Error(`${fieldName} is required`);
  }
  return str;
}

function readOptionalCounter(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const counter = Number(value);
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return counter;
}

function toVerificationCredential(entry) {
  return {
    id: entry.id,
    publicKey: Buffer.from(entry.publicKey, 'base64url'),
    counter: entry.counter,
    transports: entry.transports,
  };
}

function buildCredentialEntryFromRegistrationInfo(registrationInfo) {
  const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;

  return {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    createdAt: new Date().toISOString(),
  };
}

function mergeCredentialEntries(existingEntries, nextEntry) {
  const merged = [];
  let replaced = false;

  for (const entry of existingEntries) {
    if (entry.id === nextEntry.id) {
      merged.push({
        ...entry,
        ...nextEntry,
      });
      replaced = true;
    } else {
      merged.push(entry);
    }
  }

  if (!replaced) {
    merged.push(nextEntry);
  }

  return merged;
}

function serializeCredentialEntries(entries) {
  return JSON.stringify(entries);
}

module.exports = {
  buildCredentialEntryFromRegistrationInfo,
  mergeCredentialEntries,
  parseCredentialEntries,
  serializeCredentialEntries,
  toVerificationCredential,
};
