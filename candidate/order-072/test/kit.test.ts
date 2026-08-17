// PROVENANCE: RECONSTRUCTED_FROM_ORDER.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { generateControlRoomKit, verifyControlRoomKit } from '../src/extensions/index.js';
const base = path.resolve('.generated/test-kit');
const expected = ['EXACT_FILE_SET','MANIFEST_SCHEMA','PACKAGE_IDENTITY','GENERATION_MODE','FICTIONAL_DATA','ROUTE_COUNT','ROUTES_EXACT','HASH_COUNT','HASH_INDEX','HASH_PROOF','HASH_EVIDENCE_MANIFEST','HASH_SCRIPT','HASH_README','PROOF_SCHEMA','VERDICT','ACTION','EMBEDDED_PROOF','NO_EXTERNAL_REFERENCES','LIMITATIONS'];
for (const checkName of expected) test(`verify-kit ${checkName}`, () => {
  fs.rmSync(base, { recursive: true, force: true }); generateControlRoomKit(base);
  const result = verifyControlRoomKit(base); const check = result.checks.find((x: any) => x.name === checkName);
  assert.equal(check?.ok, true); assert.equal(result.passed, 19);
});
