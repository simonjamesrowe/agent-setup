'use strict';
const START = '<!-- AGENT-SETUP:SIMONJAMESROWE START -->';
const END = '<!-- AGENT-SETUP:SIMONJAMESROWE END -->';
const BLOCK_RE = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\n?`);

function renderBlock(blockBody) {
  return `${START}\n${blockBody.trim()}\n${END}\n`;
}

function mergeMarkerBlock(existing, blockBody) {
  const block = renderBlock(blockBody);
  if (existing == null || existing.trim() === '') return block;
  if (BLOCK_RE.test(existing)) return existing.replace(BLOCK_RE, block);
  return existing.replace(/\s*$/, '\n\n') + block;
}

function hasMarkerBlock(content) {
  return typeof content === 'string' && content.includes(START) && content.includes(END);
}

module.exports = { mergeMarkerBlock, hasMarkerBlock, START, END };
