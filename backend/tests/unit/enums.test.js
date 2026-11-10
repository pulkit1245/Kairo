import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as frontend from '../../../frontend/src/types/enums.js';
import * as types from '../../src/types/index.js';

// The enums live in three places by hand: src/types, schema.prisma and the
// frontend copy. This test is what keeps them equal.

// src/types constant -> Prisma enum
const PRISMA_ENUM = {
  DEPLOYMENT_STATUSES: 'DeploymentStatus',
  STACKS: 'Stack',
  APP_HEALTH: 'AppHealth',
  PR_STATES: 'PrState',
  FILE_KINDS: 'GeneratedFileKind',
  FILE_ORIGINS: 'FileOrigin',
  RELEASE_SOURCES: 'ReleaseSource',
  RELEASE_STATUSES: 'ReleaseStatus',
  REMEDIATION_ACTIONS: 'RemediationAction',
  INCIDENT_STATUSES: 'IncidentStatus',
  ATTEMPT_TRIGGERS: 'AttemptTrigger',
  ATTEMPT_RESULTS: 'AttemptResult',
};

function prismaEnums() {
  const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
  const enums = {};
  for (const [, name, body] of schema.matchAll(/^enum (\w+) \{([^}]*)\}/gm)) {
    enums[name] = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, '').trim())
      .filter(Boolean);
  }
  return enums;
}

describe('shared enums', () => {
  const enums = prismaEnums();

  for (const [constant, enumName] of Object.entries(PRISMA_ENUM)) {
    it(`${constant} matches the Prisma enum ${enumName}`, () => {
      assert.deepEqual([...types[constant]], enums[enumName]);
    });
  }

  it('every Prisma enum has a constant in src/types', () => {
    assert.deepEqual(Object.keys(enums).sort(), Object.values(PRISMA_ENUM).sort());
  });

  it('the frontend copy is identical to src/types', () => {
    const backendArrays = Object.fromEntries(
      Object.entries(types).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, [...v]]),
    );
    const frontendArrays = Object.fromEntries(
      Object.entries(frontend).map(([k, v]) => [k, [...v]]),
    );
    assert.deepEqual(frontendArrays, backendArrays);
  });

  it('the remediation rules cover exactly the fixed alert names', async () => {
    const { RULES } = await import('../../src/remediation/action/decision.service.js');
    assert.deepEqual(Object.keys(RULES).sort(), [...types.ALERT_NAMES].sort());
  });

  it('every in-progress status is a pipeline status', () => {
    for (const s of types.IN_PROGRESS_STATUSES) assert.ok(types.DEPLOYMENT_STATUSES.includes(s));
  });
});
