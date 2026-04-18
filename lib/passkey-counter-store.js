'use strict';

const fs = require('fs/promises');
const path = require('path');

const counterStoreQueues = new Map();
const credentialAssertionQueues = new Map();

function serializeQueue(queueMap, key, workFn) {
  const previous = queueMap.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(workFn);

  let tracked = null;
  tracked = current
    .then(
      () => undefined,
      () => undefined
    )
    .finally(() => {
      if (queueMap.get(key) === tracked) {
        queueMap.delete(key);
      }
    });

  queueMap.set(key, tracked);
  return current;
}

async function readCounterStore(filePath) {
  let raw;

  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }

  const text = String(raw || '').trim();
  if (!text) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    err.message = `Invalid passkey counter store JSON: ${err.message}`;
    throw err;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Passkey counter store must be a JSON object');
  }

  const normalized = {};
  for (const [credentialId, value] of Object.entries(parsed)) {
    const counter = Number(value);
    if (!Number.isInteger(counter) || counter < 0) {
      throw new Error(`Passkey counter for ${credentialId} must be a non-negative integer`);
    }
    normalized[credentialId] = counter;
  }

  return normalized;
}

async function writeCounterStore(filePath, counters) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, JSON.stringify(counters), 'utf8');
  await fs.rename(tempFilePath, filePath);
}

function serializeCounterStoreUpdate(filePath, updateFn) {
  return serializeQueue(counterStoreQueues, filePath, updateFn);
}

function serializeCredentialAssertion(filePath, credentialId, workFn) {
  return serializeQueue(credentialAssertionQueues, `${filePath}:${credentialId}`, workFn);
}

async function persistCredentialCounter(filePath, credentialId, nextCounter) {
  return await serializeCounterStoreUpdate(filePath, async () => {
    const counters = await readCounterStore(filePath);
    const currentCounter = Number.isInteger(counters[credentialId]) ? counters[credentialId] : 0;

    if (currentCounter >= nextCounter) {
      return currentCounter;
    }

    counters[credentialId] = nextCounter;
    await writeCounterStore(filePath, counters);
    return nextCounter;
  });
}

module.exports = {
  persistCredentialCounter,
  readCounterStore,
  serializeCredentialAssertion,
  serializeCounterStoreUpdate,
  writeCounterStore,
};
