/**
 * FX13 T-08 — duplicating a notebook.
 *
 * The two things D-2 asked for are the two things worth testing, and neither is the
 * happy path: the copy must not inherit the original's deploy state, and its name must
 * be one nobody else has. The second is not cosmetic — nothing in the schema stops two
 * notebooks sharing a name, but `findByIdOrName` answers `"ambiguous"` when two do, so a
 * careless copy makes both notebooks unreachable by name to every agent at once.
 *
 * Notebooks it creates are prefixed `zz-dup-` and deleted at the end.
 *
 *   pnpm --filter @zaa-tool/engine exec tsx tests/notebook-duplicate.test.ts
 */
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { NotebookJson } from '@zaa-tool/shared';
import { notebooksService } from '../src/services/notebooks.service.js';
import { pool } from '../src/db/connection.js';

describe('NotebooksService.duplicate (T-08)', () => {
  const createdIds: string[] = [];

  const cleanup = async () => {
    for (const id of createdIds) {
      await notebooksService.delete(id).catch(() => {});
    }
    await pool.query("DELETE FROM notebooks WHERE name LIKE 'zz-dup-%'");
  };

  before(cleanup);
  after(cleanup);

  const source = (): NotebookJson => ({
    version: '1.0',
    id: randomUUID(),
    name: 'zz-dup-source',
    runtime: 'node' as const,
    steps: [
      {
        id: 'cell-1',
        kind: 'cell' as const,
        note: '# Source note',
        code: 'return { val: 42 };',
      },
    ],
  });

  test('the copy is a new notebook named `<original>-copy`, cells intact', async () => {
    const original = await notebooksService.save(source());
    createdIds.push(original.id);

    const duplicated = await notebooksService.duplicate(original.id, 'tester');
    assert.ok(duplicated, 'duplicate returned null for a notebook that exists');
    createdIds.push(duplicated.id);

    assert.notEqual(duplicated.id, original.id);
    assert.equal(duplicated.name, 'zz-dup-source-copy');

    const dupRecord = await notebooksService.getById(duplicated.id);
    assert.ok(dupRecord);
    const dupDoc = notebooksService.parseDocument(dupRecord);
    assert.equal(dupDoc.name, 'zz-dup-source-copy');
    assert.equal(dupDoc.steps?.length, 1);
    assert.equal((dupDoc.steps?.[0] as { code: string }).code, 'return { val: 42 };');
  });

  test('the original is untouched by the copy', async () => {
    const original = await notebooksService.getById(createdIds[0]);
    assert.ok(original);
    assert.equal(notebooksService.parseDocument(original).name, 'zz-dup-source');
  });

  test('a second copy does not reuse the first copy name', async () => {
    const again = await notebooksService.duplicate(createdIds[0], 'tester');
    assert.ok(again);
    createdIds.push(again.id);

    assert.equal(again.name, 'zz-dup-source-copy-2');

    // The point of the suffix: both copies stay addressable by name.
    const first = await notebooksService.findByIdOrName('zz-dup-source-copy');
    const second = await notebooksService.findByIdOrName('zz-dup-source-copy-2');
    assert.notEqual(first, 'ambiguous', 'the first copy became unreachable by name');
    assert.notEqual(second, 'ambiguous', 'the second copy became unreachable by name');
  });

  test('copying a deployed notebook produces a draft, not a second deployed thing', async () => {
    const deployed = await notebooksService.save({
      ...source(),
      name: 'zz-dup-deployed',
    });
    createdIds.push(deployed.id);

    const version = await notebooksService.deploy(deployed.id, 'tester');
    assert.ok(version, 'the fixture did not deploy, so this test proves nothing');

    const copy = await notebooksService.duplicate(deployed.id, 'tester');
    assert.ok(copy);
    createdIds.push(copy.id);

    const state = await notebooksService.getDeployState(copy.id);
    assert.ok(
      !state?.isDeployed,
      'the copy came out deployed, so it answers the original triggers too'
    );
  });
});
