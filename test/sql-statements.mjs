// Splits a SQL script into statements the way SQLite reads it: a ';' ends a statement except inside quotes, comments,
// and a CREATE TRIGGER body (BEGIN ... END), where ';' ends each inner statement. CASE ... END inside a trigger is not its end.
export function sqlStatements(sql) {
  const out = []; let cur = '', i = 0, words = [], trigger = false, inBody = false, caseDepth = 0;
  const flush = () => { const s = cur.replace(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)+/, '').trim(); if (s) out.push(s); cur = ''; words = []; trigger = false; inBody = false; caseDepth = 0; };
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { const e = sql.indexOf('\n', i); const j = e < 0 ? sql.length : e; cur += sql.slice(i, j); i = j; continue; }
    if (c === '/' && n === '*') { const e = sql.indexOf('*/', i + 2); const j = e < 0 ? sql.length : e + 2; cur += sql.slice(i, j); i = j; continue; }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c; let j = i + 1;
      for (; j < sql.length; j++) { if (sql[j] === close) { if (close !== ']' && sql[j + 1] === close) { j++; continue; } break; } }
      cur += sql.slice(i, j + 1); i = j + 1; words.push('?'); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const w = sql.slice(i, j).toUpperCase(); cur += sql.slice(i, j); i = j; words.push(w);
      if (words.length <= 4 && w === 'TRIGGER' && words[0] === 'CREATE') trigger = true;
      if (trigger && w === 'BEGIN') inBody = true;
      else if (inBody && w === 'CASE') caseDepth++;
      else if (inBody && w === 'END') { if (caseDepth) caseDepth--; else { inBody = false; trigger = false; } }
      continue;
    }
    if (c === ';' && !inBody) { cur += c; flush(); i++; continue; }
    cur += c; i++;
  }
  flush(); return out;
}
