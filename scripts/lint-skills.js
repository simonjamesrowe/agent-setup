#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('../lib/frontmatter.js');

function lintSkills(skillsRoot) {
  const errors = [];
  const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (dirs.length === 0) errors.push(`no skills found under ${skillsRoot}`);
  for (const d of dirs) {
    const skillFile = path.join(skillsRoot, d.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) { errors.push(`${d.name}: missing SKILL.md`); continue; }
    const { attrs } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
    if (!attrs.name) errors.push(`${d.name}: missing frontmatter 'name'`);
    else if (attrs.name !== d.name) errors.push(`${d.name}: frontmatter name '${attrs.name}' != directory '${d.name}'`);
    if (!attrs.description) errors.push(`${d.name}: missing frontmatter 'description'`);
    else if (!attrs.description.includes('Use when')) errors.push(`${d.name}: description must contain 'Use when'`);
    const extraKeys = Object.keys(attrs).filter((k) => k !== 'name' && k !== 'description');
    if (extraKeys.length) errors.push(`${d.name}: only name+description allowed, found: ${extraKeys.join(', ')}`);
  }
  return errors;
}

module.exports = { lintSkills };
if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, '..', 'components', 'skills');
  const errors = lintSkills(root);
  for (const e of errors) console.error(`LINT: ${e}`);
  console.log(errors.length ? `${errors.length} error(s)` : 'skills lint: OK');
  process.exit(errors.length ? 1 : 0);
}
