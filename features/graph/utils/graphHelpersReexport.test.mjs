import test from 'node:test';
import assert from 'node:assert/strict';
import * as shim from './graphHelpers.js';
import * as canonical from '../../utils/graphHelpers.js';

// P0-1 regression guard: features/graph/utils/graphHelpers.js must remain a
// compatibility re-export of the canonical features/utils/graphHelpers.js.
// The former standalone copy pointed at sibling modules (./workflowFileInputs,
// ./ids) that do not exist in features/graph/utils, which broke module
// resolution for GraphPage.jsx, which imports through this path.

test('graph shim re-exports every symbol from the canonical graphHelpers module', () => {
  const shimExports = Object.keys(shim).sort();
  const canonicalExports = Object.keys(canonical).sort();
  assert.deepEqual(shimExports, canonicalExports);
  assert.ok(shimExports.length > 0, 'canonical graphHelpers must export symbols');
});

test('graph-critical symbols remain importable through both paths', () => {
  for (const symbol of [
    'DEFAULT_OUTPUT_ID',
    'DEFAULT_INPUT_ID',
    'IMAGE_COMPARE_INPUT_IDS',
    'getHitemResolutionOptions',
    'normalizeCustomApiType',
    'resolveWorkflowParameterValue',
    'toBaseFlowNode',
    'toFlowEdge',
    'createComfyExecutionId',
  ]) {
    assert.ok(symbol in shim, `${symbol} must be re-exported by the graph shim`);
    assert.equal(shim[symbol], canonical[symbol], `${symbol} must come from the canonical module`);
  }
});
