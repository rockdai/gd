'use strict';

const assert = require('assert');

const {
  buildCredentialEntryFromRegistrationInfo,
  mergeCredentialEntries,
  parseCredentialEntries,
  serializeCredentialEntries,
  toVerificationCredential,
} = require('../../lib/passkey');

describe('lib/passkey', () => {
  it('parses a single credential object from env JSON', () => {
    const credentials = parseCredentialEntries(JSON.stringify({
      id: 'cred-1',
      publicKey: 'AQID',
      counter: 3,
      transports: [ 'internal' ],
    }));

    assert.deepStrictEqual(credentials, [ {
      id: 'cred-1',
      publicKey: 'AQID',
      counter: 3,
      transports: [ 'internal' ],
    } ]);
  });

  it('merges a new credential by id', () => {
    const merged = mergeCredentialEntries(
      [ { id: 'cred-1', publicKey: 'old', counter: 1 } ],
      { id: 'cred-1', publicKey: 'new', counter: 2 }
    );

    assert.deepStrictEqual(merged, [ {
      id: 'cred-1',
      publicKey: 'new',
      counter: 2,
    } ]);
  });

  it('builds a stored credential entry from registration info', () => {
    const entry = buildCredentialEntryFromRegistrationInfo({
      credential: {
        id: 'cred-1',
        publicKey: Uint8Array.from([ 1, 2, 3 ]),
        counter: 7,
        transports: [ 'internal' ],
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    });

    assert.strictEqual(entry.id, 'cred-1');
    assert.strictEqual(entry.publicKey, 'AQID');
    assert.strictEqual(entry.counter, 7);
    assert.deepStrictEqual(entry.transports, [ 'internal' ]);
    assert.strictEqual(entry.deviceType, 'multiDevice');
    assert.strictEqual(entry.backedUp, true);
    assert(entry.createdAt);
  });

  it('converts a stored credential to verification format', () => {
    const credential = toVerificationCredential({
      id: 'cred-1',
      publicKey: 'AQID',
      counter: 9,
      transports: [ 'internal' ],
    });

    assert.strictEqual(credential.id, 'cred-1');
    assert.strictEqual(Buffer.from(credential.publicKey).toString('base64url'), 'AQID');
    assert.strictEqual(credential.counter, 9);
    assert.deepStrictEqual(credential.transports, [ 'internal' ]);
  });

  it('serializes credentials back to env JSON', () => {
    const json = serializeCredentialEntries([ {
      id: 'cred-1',
      publicKey: 'AQID',
      counter: 0,
    } ]);

    assert.strictEqual(json, '[{"id":"cred-1","publicKey":"AQID","counter":0}]');
  });
});
