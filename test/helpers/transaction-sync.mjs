// Stand-in for Durable Object storage.transactionSync on a node:sqlite database: run fn inside a savepoint, roll back if it throws.
let n = 0;
export const transactionSyncFor = (db) => (fn) => {
  const name = `tx${++n}`;
  db.exec(`SAVEPOINT ${name}`);
  try { const r = fn(); db.exec(`RELEASE ${name}`); return r; }
  catch (e) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw e; }
};
