import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { notebooksService } from '../src/services/notebooks.service.js';

describe('NotebooksService.duplicate (T-08)', () => {
  const createdIds: string[] = [];

  const cleanup = async () => {
    for (const id of createdIds) {
      await notebooksService.delete(id).catch(() => {});
    }
  };

  before(cleanup);
  after(cleanup);

  test('duplicates a notebook with "Copy of" prefix name and copied cells', async () => {
    const original = await notebooksService.save({
      name: 'zz-dup-source',
      runtime: 'node',
      steps: [
        {
          id: 'cell-1',
          kind: 'cell',
          note: '# Source note',
          code: 'return { val: 42 };',
        },
      ],
    });
    createdIds.push(original.id);

    const duplicated = await notebooksService.duplicate(original.id, 'tester');
    assert.notEqual(duplicated, null);
    if (!duplicated) return;

    createdIds.push(duplicated.id);

    assert.notEqual(duplicated.id, original.id);
    assert.equal(duplicated.name, 'Copy of zz-dup-source');

    const dupRecord = await notebooksService.getById(duplicated.id);
    assert.notEqual(dupRecord, null);
    if (!dupRecord) return;

    const dupDoc = notebooksService.parseDocument(dupRecord);
    assert.equal(dupDoc.name, 'Copy of zz-dup-source');
    assert.equal(dupDoc.steps?.length, 1);
  });
});
