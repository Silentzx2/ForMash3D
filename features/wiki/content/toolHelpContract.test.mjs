import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mappedArticleIds = ['18', '24', '29', '30', '32', '47'];
const mappingSource = readFileSync(new URL('../components/ToolContextHelp.tsx', import.meta.url), 'utf8');

test('every active tool-help mapping has a markdown article served by /api/wiki/[id]', () => {
  for (const id of mappedArticleIds) {
    assert.match(mappingSource, new RegExp(`id:\\s*['"]${id}['"]`), `expected tool help to map article ${id}`);
    const article = readFileSync(new URL(`./content/${id}.md`, import.meta.url), 'utf8').trim();
    assert.ok(article.startsWith('# '), `article ${id} should have a Markdown title`);
    assert.ok(article.length > 80, `article ${id} should not be empty or a placeholder`);
  }
});
