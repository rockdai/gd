'use strict';

const assert = require('assert');
const {
  matchesEntry,
  selectMachines,
  findMissingEntries,
  primarySecurityGroupId,
  withSecurityGroup,
} = require('../src/machines');

const MACHINES = [
  { product: 'ecs', instanceId: 'i-1', instanceName: 'nas-hk', regionId: 'cn-hongkong', securityGroupIds: [ 'sg-b', 'sg-a' ] },
  { product: 'swas-open', instanceId: 'swas-1', instanceName: 'blog', regionId: 'cn-hangzhou' },
  { product: 'swas-open', instanceId: 'swas-2', instanceName: 'prod', regionId: 'us-west-1' },
];

describe('job machines matching', () => {
  it('matches by instanceId or instanceName', () => {
    assert.strictEqual(matchesEntry(MACHINES[0], 'i-1'), true);
    assert.strictEqual(matchesEntry(MACHINES[0], 'nas-hk'), true);
    assert.strictEqual(matchesEntry(MACHINES[0], 'nope'), false);
  });
});

describe('job machines selection', () => {
  it('returns everything when both lists are empty', () => {
    assert.deepStrictEqual(selectMachines(MACHINES, { allow: [], deny: [] }), MACHINES);
  });

  it('keeps only allow entries when allow is set', () => {
    const selected = selectMachines(MACHINES, { allow: [ 'nas-hk', 'swas-2' ], deny: [] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1', 'swas-2' ]);
  });

  it('drops deny entries when only deny is set', () => {
    const selected = selectMachines(MACHINES, { allow: [], deny: [ 'prod' ] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1', 'swas-1' ]);
  });

  it('applies allow first, then removes deny from that subset', () => {
    const selected = selectMachines(MACHINES, { allow: [ 'nas-hk', 'blog' ], deny: [ 'blog' ] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1' ]);
  });

  it('silently skips entries that match no machine', () => {
    const selected = selectMachines(MACHINES, { allow: [ 'nas-hk', 'released-box' ], deny: [] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1' ]);
    assert.deepStrictEqual(findMissingEntries(MACHINES, [ 'nas-hk', 'released-box' ]), [ 'released-box' ]);
    assert.deepStrictEqual(findMissingEntries(MACHINES, []), []);
  });
});

describe('job machines security group selection', () => {
  it('picks the first security group after sorting, so the choice is deterministic', () => {
    assert.strictEqual(primarySecurityGroupId(MACHINES[0]), 'sg-a');
    // 阿里云返回顺序颠倒也选中同一个
    assert.strictEqual(primarySecurityGroupId({ securityGroupIds: [ 'sg-a', 'sg-b' ] }), 'sg-a');
    assert.strictEqual(primarySecurityGroupId({ securityGroupIds: [] }), undefined);
    assert.strictEqual(primarySecurityGroupId({}), undefined);
  });

  it('attaches securityGroupId for ECS and leaves SWAS untouched', () => {
    assert.strictEqual(withSecurityGroup(MACHINES[0]).securityGroupId, 'sg-a');
    assert.strictEqual(withSecurityGroup(MACHINES[1]).securityGroupId, undefined);
    assert.strictEqual(withSecurityGroup(MACHINES[1]), MACHINES[1]);
  });
});
