'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { mergeMarkerBlock, hasMarkerBlock } = require('../markers.js');

function provisionInstructions({ home, adapters, componentsDir, check }) {
  const body = fs.readFileSync(path.join(componentsDir, 'instructions', 'global.md'), 'utf8');
  const results = [];
  for (const adapter of adapters) {
    const file = adapter.instructionsFile(home);
    try {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const merged = mergeMarkerBlock(existing, body);
      if (check) {
        const status = existing === null || !hasMarkerBlock(existing) ? 'missing' : merged === existing ? 'unchanged' : 'missing';
        results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status, note: status === 'missing' ? `block absent or stale in ${file}` : undefined });
      } else if (merged === existing) {
        results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status: 'unchanged' });
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, merged);
        results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status: existing !== null && hasMarkerBlock(existing) ? 'updated' : 'installed' });
      }
    } catch (err) {
      results.push({ provisioner: 'instructions', item: 'instructions', tool: adapter.key, status: 'failed', note: err.message });
    }
  }
  return results;
}
module.exports = { provisionInstructions };
