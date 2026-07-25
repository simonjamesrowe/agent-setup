'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { copyDirAtomic, dirsEqual } = require('../fsx.js');

const STATUS_MAP = { new: 'installed', updated: 'updated', unchanged: 'unchanged' };

function provisionSkills({ home, adapters, componentsDir, check }) {
  const skillsRoot = path.join(componentsDir, 'skills');
  const skills = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const results = [];
  for (const adapter of adapters) {
    for (const skill of skills) {
      const src = path.join(skillsRoot, skill);
      const dest = path.join(adapter.skillsDir(home), skill);
      try {
        if (check) {
          if (!fs.existsSync(dest)) {
            results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: 'missing' });
          } else if (dirsEqual(src, dest)) {
            results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: 'unchanged' });
          } else {
            results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: 'missing', note: 'out of date' });
          }
        } else {
          results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: STATUS_MAP[copyDirAtomic(src, dest)] });
        }
      } catch (err) {
        results.push({ provisioner: 'skills', item: skill, tool: adapter.key, status: 'failed', note: err.message });
      }
    }
  }
  return results;
}

module.exports = { provisionSkills };
