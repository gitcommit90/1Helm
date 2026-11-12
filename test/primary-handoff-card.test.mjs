// A Primary browser handoff keeps its Take control card in the saved task while the task waits on the person in the browser.
import {world,assert} from './deploy-harness.mjs';
const W=world({env:{}});const R=W.R;
const session=R.newSession('Amazon');
assert.equal(R.workerBrowserView(session),null,'no handoff, no card');
R.put('handoff:'+session,JSON.stringify({url:'https://www.amazon.com/ap/cvf',text:'Enter the code Amazon texted you.'}));
assert.equal(R.workerBrowserView(session),null,'a stored handoff without the waiting flag shows no card');
R.sql.exec("UPDATE sessions SET waiting='browser' WHERE id=?",session);
assert.deepEqual(R.workerBrowserView(session),{url:'https://www.amazon.com/ap/cvf',text:'Enter the code Amazon texted you.'},'waiting on the browser shows the card');
assert.deepEqual((await R.sessionDetail(session)).worker_browser,{url:'https://www.amazon.com/ap/cvf',text:'Enter the code Amazon texted you.'},'the task detail carries it, so a reload or another device shows it');
const other=R.newSession('Other');R.sql.exec("UPDATE sessions SET waiting='browser' WHERE id=?",other);
assert.equal(R.workerBrowserView(other),null,'another task never shows this task\'s handoff');
R.sql.exec("UPDATE sessions SET waiting=NULL WHERE id=?",session);
assert.equal(R.workerBrowserView(session),null,'handed back: the card is gone');
console.log('primary handoff card: saved with the task while waiting, gone after hand back');
process.exit(0);
