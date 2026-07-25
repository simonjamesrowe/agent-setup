'use strict';

function pad(str, width) {
  return str + ' '.repeat(Math.max(0, width - str.length));
}

function renderTable(results) {
  const rows = results.map((r) => ({
    item: r.item,
    tool: r.tool,
    status: r.status === 'failed' ? 'FAILED' : r.status,
    note: r.note || '',
  }));
  const widths = {
    item: Math.max('item'.length, ...rows.map((r) => r.item.length)),
    tool: Math.max('tool'.length, ...rows.map((r) => r.tool.length)),
    status: Math.max('status'.length, ...rows.map((r) => r.status.length)),
  };
  const lines = rows.map((r) => {
    const base = `${pad(r.item, widths.item)}  ${pad(r.tool, widths.tool)}  ${pad(r.status, widths.status)}`;
    return r.note ? `${base}  ${r.note}` : base.replace(/\s+$/, '');
  });

  const totals = new Map();
  for (const r of results) totals.set(r.status, (totals.get(r.status) || 0) + 1);
  const totalsLine = [...totals.entries()].map(([status, count]) => `${count} ${status}`).join(', ');

  return [...lines, '', totalsLine].join('\n');
}

function exitCode(results, { strictMissing = false } = {}) {
  return results.some((r) => r.status === 'failed' || (strictMissing && r.status === 'missing')) ? 1 : 0;
}

module.exports = { renderTable, exitCode };
