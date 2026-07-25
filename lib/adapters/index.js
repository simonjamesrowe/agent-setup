'use strict';
const ADAPTERS = [require('./claude.js'), require('./gemini.js'), require('./codex.js')];
function detectTools({ toolsFlag, isOnPath }) {
  if (toolsFlag && toolsFlag.length) return ADAPTERS.filter((a) => toolsFlag.includes(a.key));
  return ADAPTERS.filter((a) => isOnPath(a.binary));
}
module.exports = { ADAPTERS, detectTools };
