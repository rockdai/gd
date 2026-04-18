'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  persistCredentialCounter,
  readCounterStore,
  writeCounterStore,
} = require('../../lib/passkey-counter-store');

describe('lib/passkey-counter-store', () => {
  it('reads a missing counter store as empty', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-passkey-store-'));
    const filePath = path.join(tempDir, 'counters.json');

    try {
      const counters = await readCounterStore(filePath);
      assert.deepStrictEqual(counters, {});
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('persists counters and keeps the highest value for a credential', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-passkey-store-'));
    const filePath = path.join(tempDir, 'counters.json');

    try {
      await writeCounterStore(filePath, { credA: 3 });
      await persistCredentialCounter(filePath, 'credA', 5);
      await persistCredentialCounter(filePath, 'credA', 4);
      await persistCredentialCounter(filePath, 'credB', 2);

      const counters = await readCounterStore(filePath);
      assert.deepStrictEqual(counters, {
        credA: 5,
        credB: 2,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('serializes concurrent updates so newer counters are not overwritten', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-passkey-store-'));
    const filePath = path.join(tempDir, 'counters.json');

    try {
      await writeCounterStore(filePath, {
        credA: 1,
        credB: 4,
      });

      await Promise.all([
        persistCredentialCounter(filePath, 'credA', 6),
        persistCredentialCounter(filePath, 'credB', 7),
        persistCredentialCounter(filePath, 'credA', 8),
      ]);

      const counters = await readCounterStore(filePath);
      assert.deepStrictEqual(counters, {
        credA: 8,
        credB: 7,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
