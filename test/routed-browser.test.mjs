// Scripted model output drives real Resident tools; assertions concern app state only.
import {world,tick,assert,never} from './deploy-harness.mjs';
import {seedSettings,ID} from './helpers/seed-settings.mjs';
const settings=seedSettings(),ids=[ID.DEEPSEEK,ID.HAIKU,ID.SOL],choices=ids.map(model=>({model,effort:settings.catalog[model].efforts[0]}));
const chains=()=>Object.fromEntries(['unrestricted','no_training','zdr'].map(level=>[level,structuredClone(choices)]));
settings.version=3;settings.routing={categories:[{id:'general',title:'General',chains:chains()},{id:'finance',title:'Finance',chains:chains()}]};
const W=world({env:{DYNAMIC_ROUTING:'on',APPEND_TASK_RUNTIME:'on',ROUTER_MODE:'two',MODEL_SETTINGS:settings,MODEL_SETTINGS_REVISION:1,OPENROUTER_API_KEY:'synthetic',GENUI:'on',RESUME_DELAY_MS:0,RESUME_WRITE_DELAY_MS:0,CODE_V:'input-v1',TASK_MODEL_CATALOG:Object.fromEntries(ids.map(id=>[id,{id,eligible:true,hosts:id.startsWith('anthropic')?['anthropic']:id.startsWith('deepseek')?['deepseek']:['azure'],efforts:settings.catalog[id].efforts,levels:['unrestricted','no_training','zdr'],context_length:200000,max_output:64000,input_modalities:['text'],tool_choice:['auto','none'],json:true,pricing:{prompt:.1,completion:.2}}]))}});
// A routed worker (dynamic routing, required delegation) gets the same browser behavior as General: its browser events reach the person, a
// handoff pauses it and the person's hand back resumes the same worker through Primary, and a saved login or purchase goes through Primary.
// The scripted models drive real Resident code. Assertions concern app state only, never wording.
import {sealSecret} from '../src/sentinel.js';
import {workerLoginGrant,LOGIN_GRANT_MS} from '../src/helpers.js';
import {routingToolsAllowed} from '../src/ee/orchestrator.js';
let callId=0,decideSteer='none',primaryTools=[],handoffTools=null,handoffMessages='',workerMsgs=[],loginPlain='hunter2-secret',page='https://shop.example.com/login?token=abc',acts=[],fetches=[];
W.env.VAULT_KEY=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const sealed=await sealSecret(W.env,loginPlain);
const stmt=(sql)=>({bind:()=>({
  all:async()=>({results:/FROM logins/.test(sql)?[{site:'shop.example.com',username:'me@example.com',sealed}]:[]}),
  first:async()=>/link_accounts/.test(sql)?{sealed:await sealSecret(W.env,JSON.stringify({access_token:'tok',refresh_token:'r'})),access_expires_at:Date.now()+3600e3}:/link_purchases/.test(sql)?{id:'sr1',tenant_id:'t1'}:null,
  run:async()=>({})})});
W.env.DB={prepare:stmt};
W.env.WS={put:async(k,b)=>({size:b.byteLength}),head:async()=>null,delete:async()=>{}};
const oldFetch=globalThis.fetch;
globalThis.fetch=async (url,init={})=>{
  const u=String(url);
  if(u.startsWith('https://api.link.com')){fetches.push([init.method||'GET',u]);
    if(u.endsWith('/payment-details'))return Response.json({payment_details:[{id:'pm1',is_default:true}]});
    if(u.endsWith('/spend_requests'))return Response.json({id:'sr1',status:'pending_approval',currency:'usd',amount:4375,merchant_name:'Shop',merchant_url:'https://shop.example.com/checkout',approval_url:'https://link.example/approve'});
    if(u.includes('/spend_requests/sr1'))return Response.json({id:'sr1',status:'approved',amount:4375,currency:'usd',merchant_name:'Shop'});
    return Response.json({});}
  const body=JSON.parse(init.body||'{}');
  return Response.json({answers:{is_task:{noul:1},category:{choice:'Finance'},unmet:{noul:0},steer:{choice:decideSteer}},usage:{cost:0}});
};
const R0=W.R,seen=[];
const result=(content='',calls=[])=>({content,calls:calls.map(([name,args])=>({id:`rb_${++callId}`,type:'function',function:{name,arguments:JSON.stringify({step_title:'Recorded task step',...args})}})),inTok:50,outTok:10,cached:0,charge:0,model:ids[0],provider:'fixture',usage:{}});
let wstep=0,decisions=[];
function attach(R){
  R.computer=()=>({...W.computer,readFile:async()=>({ok:true,bytes:new TextEncoder().encode('[]')}),browser:async(op,args)=>{
    if(op==='act'){acts.push(args);return{ok:true,completed:(args.actions||[]).length,url:page,title:'Shop',snapshot:'[e1] textbox "Email"\n[e2] password input "Password"'};}
    if(op==='screenshot')return{ok:true,url:page,title:'Shop',jpeg_base64:btoa('jpegbytes')};
    return{ok:true,url:page,title:'Shop',snapshot:'[e1] textbox "Email"\n[e2] password input "Password"'};}});
  R.callModel=async(messages,_w,_t,_o,tc)=>{
    const tools=R.modelTools(tc).map(t=>t.function.name);
    if(tc.kind==='helper'){
            const round=tc.helper.round;wstep++;
      if(tc.helper.task.startsWith('Deny')){R.helperAttachMessages(tc,messages);R.helperMessagesSeen(tc);workerMsgs.push(JSON.stringify(messages));
        if(round===1)return result('',[['request_saved_login',{site:'shop.example.com',reason:'Sign in'}]]);
        if(!seen.includes('d2')){seen.push('d2');return result('',[['browser_fill_login',{site:'shop.example.com',username_ref:'e1',password_ref:'e2'}]]);}
        return result('',[['done',{response:'Could not sign in.'}]]);}
      if(round>1){R.helperAttachMessages(tc,messages);R.helperMessagesSeen(tc);}
      workerMsgs.push(JSON.stringify(messages));
      if(round===1){assert(tools.includes('browser_handoff'));assert(tools.includes('request_saved_login'));assert(tools.includes('request_purchase'));assert(tools.includes('browser_fill_login'));assert(!tools.includes('decide_worker_request'));const hd=R.modelTools(tc).find(t=>t.function.name==='browser_handoff').function.description;assert(/pauses you/.test(hd)&&!/end your turn/.test(hd),'the worker reads handoff text that fits a worker');
        return wstep===1?result('',[['browser_navigate',{url:page}]]):wstep===2?result('',[['browser_screenshot',{caption:'Sign in page'}]]):result('',[['browser_handoff',{instructions:'Please solve the captcha, then hand back.'}]]);}
      if(round===2){
        if(!workerMsgs.at(-1).includes('fresh browser_snapshot'))throw new Error('round 2 lacks the browser note');
        const last=messages.at(-1);
        if(!seen.includes('r2a')){seen.push('r2a');return result('',[['browser_fill_login',{site:'shop.example.com',username_ref:'e1',password_ref:'e2'}]]);}   // no grant yet: refused
        if(!seen.includes('r2b')){seen.push('r2b');return result('',[['request_saved_login',{site:'shop.example.com',reason:'Sign in to continue the job'}]]);}
        return result('',[['done',{response:'unexpected'}]]);}
      if(round===3){
        if(!seen.includes('r3a')){seen.push('r3a');return result('',[['browser_fill_login',{site:'shop.example.com',username_ref:'e1',password_ref:'e2',submit:true}]]);}
        if(!seen.includes('r3b')){seen.push('r3b');return result('',[['check_purchase',{purchase_id:'nope'}]]);}   // not a purchase approved for this worker
        if(!seen.includes('r3c')){seen.push('r3c');return result('',[['request_purchase',{amount_cents:4375,merchant_name:'Shop',merchant_url:'https://shop.example.com/checkout',context:'Buying one blue kettle from Shop, quantity one, total 43.75 USD with shipping and tax, because the person asked for it in this task.'}]]);}
        return result('',[['done',{response:'unexpected'}]]);}
      if(round===4){
        if(!seen.includes('r4a')){seen.push('r4a');return result('',[['check_purchase',{purchase_id:'sr1'}]]);}
        return result('',[['done',{response:'Finished the purchase check.'}]]);}
      return result('',[['done',{response:'x'}]]);
    }
    // Primary
    primaryTools.push(tools);
    const f=tc.orchestration||{};
    if(f.browserHold){handoffTools=tools;handoffMessages=JSON.stringify(messages);return result('Use the browser card, then press hand back.');}
    if(f.review&&f.pausedKind==='browser'){decisions.push('browser');return result('',[['message_subagent',{id:f.review,message:'The person solved the captcha.'}]]);}
    if(f.review&&f.pausedKind==='login'&&R.sql.exec('SELECT task FROM helpers WHERE id=?',f.review).one().task.startsWith('Deny'))return result('',[['decide_worker_request',{id:f.review,decision:'deny',reason:'The person did not ask for a sign in.'}]]);
    if(f.review&&f.pausedKind==='login'){decisions.push('login');assert(tools.includes('decide_worker_request'));assert(tools.includes('ask_user'));
      assert(JSON.stringify(messages).includes('https://shop.example.com/login'),'Primary reads the page address the system recorded');assert(!JSON.stringify(messages).includes('token=abc'),'the query string is never passed on');
      return result('',[['decide_worker_request',{id:f.review,decision:'approve'}]]);}
    if(f.review&&f.pausedKind==='purchase'){decisions.push('purchase');return result('',[['decide_worker_request',{id:f.review,decision:'approve'}]]);}
    if(f.review){decisions.push('review');const h=R.sql.exec('SELECT status,input_kind FROM helpers WHERE id=?',f.review).one();
      if(h.status==='awaiting_review')return result('',[['approve_subagent',{id:f.review,files:[]}]]);
      return result('',[['message_subagent',{id:f.review,message:'The person approved the purchase in Link.'}]]);}
    if(f.started)return result('On it.');
    return result('',[['start_helper',{name:'Shopping',task:/Deny/.test(tc.userText)?'Deny test: look at shop.example.com.':'Buy a kettle at shop.example.com.'}]]);
  };
}
const events=[];
try{
  let R=W.R;attach(R);const session=R.newSession('Shopping');
  R._routingObservers=new Map([[session,new Set([o=>events.push(o)])]]);
  await R.chat('t1','main','1','Buy a kettle.',{session});await W.settle(R);
  const h=W.dodb.prepare('SELECT * FROM helpers WHERE session=?').get(session);
  // A: the worker's browser events reach whoever watches the task
  assert(events.some(e=>e.t==='browser'&&e.url.startsWith('https://shop.example.com')),'live browser view is forwarded');
  assert(events.some(e=>e.t==='browser_handoff'&&/captcha/.test(e.instructions)),'the Take control card is forwarded');
  // B: the handoff pauses the worker and holds the task on the browser
  assert.equal(h.status,'waiting_input');assert.equal(h.input_kind,'browser');
  assert.equal(R.session(session).waiting,'browser','the task waits on the browser, and the handoff turn does not clear it');
  assert.equal(R.sessionView(R.session(session)).waiting,'browser');
  assert.equal(handoffTools,null,'a browser pause runs no Primary model turn at all');assert.equal(R.sql.exec("SELECT COUNT(*) n FROM turns WHERE session=? AND kind='chat'",session).one().n,1,'the only chat turn is the first one');
  const open=W.dodb.prepare("SELECT * FROM helper_requests WHERE helper_id=? AND kind='browser'").get(h.id);assert.equal(open.status,'open');assert.equal(open.url,'https://shop.example.com/login','no query string is kept');
  // B2: with no Primary turn live, the chat still gets everything: the Take control card, the screenshot, the waiting state, and no extra reply
  {
    const d=await R.sessionDetail(session);
    assert.deepEqual(d.worker_browser,{url:'https://shop.example.com/login',text:'Please solve the captcha, then hand back.'},'the Take control card and its instructions come with the task, so a reload shows them');
    assert.equal(d.session.state,'waiting');assert.equal(d.session.waiting,'browser');
    assert.equal(d.live,null,'no Primary turn is live');
    assert.equal(d.turns.length,1,"Primary's review of the paused worker adds no message to the chat");
    assert(!d.turns.some(t=>/Use the browser card/.test(t.reply||'')),'the review reply is not shown');
    assert.equal(d.turns[0].images.length,1,'the worker screenshot shows under the reply that started the worker');
    assert.equal(d.turns[0].images[0].caption,'Sign in page');
    assert(d.cards.some(c=>(c.helpers||[]).some(x=>x.id===h.id&&x.input_kind==='browser')),'the task cards carry what the paused worker waits on, so the row can say it');
    R.sql.exec("UPDATE sessions SET waiting=NULL WHERE id=?",session);
    assert.equal(R.sessionView(R.session(session)).waiting,'browser','a worker paused on the browser holds the task even if the stored flag was cleared');
    assert.equal(R.sessionView(R.session(session)).state,'waiting');
    R.sql.exec("UPDATE sessions SET waiting='browser' WHERE id=?",session);
    assert.equal(R.helpersList&&(await R.helpersList(session)).helpers[0].input_kind,'browser','the app can tell what a paused worker waits on');
    // a review turn left running from before (or re-offered after a deploy) never overrides the pause, and is stopped so the hand back is not queued behind it
    {
      const fake={kind:'chat',session,turn:'leftover-review',finished:false,handoffFrom:'helper',handoffInfo:{type:'helper',id:h.id},subs:new Set(),key:'leftover',inTool:0,t0:Date.now(),text:'',line:'thinking'};
      const q0=R.quietReview;R.quietReview=()=>true;R.active.set('leftover',fake);
      const v=R.sessionView(R.session(session));assert.equal(v.state,'waiting','a leftover review does not make the paused task look busy');assert.equal(v.waiting,'browser');
      R.reapBrowserReviews();assert.equal(fake.abort,'hard','the leftover review is stopped');
      fake.finished=true;R.active.delete('leftover');R.quietReview=q0;
      const first=R.sql.exec("SELECT id FROM cards ORDER BY opened LIMIT 1").one().id;
      R.sql.exec("UPDATE cards SET status='interrupted' WHERE id=?",first);R.sql.exec("UPDATE helpers SET handed=1,result_card=?,review_tries=0 WHERE id=?",first,h.id);
      R.reconcileReviews();const hh=R.sql.exec("SELECT status,handed,review_tries,result_card FROM helpers WHERE id=?",h.id).one();
      assert.equal(hh.status,'waiting_input');assert.equal(hh.review_tries,0,'a browser pause is not re-offered for review');assert.equal(hh.handed,1);
      R.sql.exec("UPDATE cards SET status='complete' WHERE id=?",first);R.sql.exec("UPDATE helpers SET result_card=NULL WHERE id=?",h.id);
    }
    // a worker running in the browser (no pause): the live view comes from the task, with no instructions
    R.sql.exec("UPDATE helper_requests SET status='done' WHERE helper_id=? AND kind='browser'",h.id);R.sql.exec("UPDATE helpers SET status='running' WHERE id=?",h.id);
    R._workerBrowser=new Map([[session,{url:'https://shop.example.com/cart',helper:h.id,at:Date.now()}]]);
    assert.deepEqual((await R.sessionDetail(session)).worker_browser,{url:'https://shop.example.com/cart',text:''});
    R.sql.exec("UPDATE helper_requests SET status='open' WHERE helper_id=? AND kind='browser'",h.id);R.sql.exec("UPDATE helpers SET status='waiting_input' WHERE id=?",h.id);R._workerBrowser=new Map();R.sql.exec("UPDATE sessions SET waiting='browser' WHERE id=?",session);   // reading the task while the worker ran dropped the flag, as it should
    R.sql.exec("DELETE FROM helper_requests WHERE helper_id=? AND kind='browser'",h.id);
    const wb=(await R.sessionDetail(session)).worker_browser;assert(wb&&wb.text.length>0,'a pause with no request row still shows the Take control card');
    R.sql.exec("INSERT INTO helper_requests (helper_id,round,kind,url,job,status,created) VALUES (?,?,?,?,?,?,?)",h.id,h.round,'browser','https://shop.example.com/login','Please solve the captcha, then hand back.','open',Date.now());
  }
  const before=callId;await R.helpersRecover();assert.equal(callId,before,'a paused worker makes no model calls');
  // a deploy while it waits leaves it paused
  W.kill();W.env.CODE_V='rb-v2';R=W.boot();attach(R);R._routingObservers=new Map([[session,new Set([o=>events.push(o)])]]);await tick();await W.settle(R);
  assert.equal(W.dodb.prepare('SELECT status FROM helpers WHERE id=?').get(h.id).status,'waiting_input');assert.equal(R.session(session).waiting,'browser');assert.equal(callId,before);
  // hand back: the fixed message goes to the same worker through Primary even when the decider says "none"
  await R.chat('t1','main','1',"I'm done in the browser. Please continue.",{session});await W.settle(R);
  assert(decisions.includes('browser'),'Primary saw the worker as paused on the browser');
  const h2=W.dodb.prepare('SELECT * FROM helpers WHERE id=?').get(h.id);
  assert.equal(h2.id,h.id);assert.equal(h2.round,3,'same worker, rounds 2 and 3');
  assert(workerMsgs.some(m=>m.includes('The person solved the captcha.')&&m.includes('fresh browser_snapshot')),'the worker is told to look at the page again');
  assert.deepEqual(decisions.slice(0,3),['browser','login','purchase']);
  // Primary's reviews of the login and purchase pauses add no visible turn, also when a deploy cut one off or it was saved before the marker existed
  {
    const q=R.sql.exec("SELECT card FROM card_events WHERE type='handoff' AND input LIKE '%\"pause\"%'").toArray().map(x=>x.card);
    assert(q.length>=2,'login and purchase reviews are marked quiet');
    const shown=async()=>(await R.sessionDetail(session)).turns.map(t=>t.id);
    for(const id of q)assert(!(await shown()).includes(id),'a quiet review is not shown');
    R.sql.exec("UPDATE turns SET error='interrupted' WHERE id=?",q[0]);assert(!(await shown()).includes(q[0]),'an interrupted quiet review shows no Send it again bubble or Helper result chip');
    R.sql.exec("UPDATE turns SET error='boom' WHERE id=?",q[0]);assert((await shown()).includes(q[0]),'a review that failed for another reason stays visible');
    R.sql.exec("UPDATE turns SET error=NULL WHERE id=?",q[0]);
    const ev=R.sql.exec("SELECT seq,input FROM card_events WHERE card=? AND type='handoff'",q[1]).toArray()[0];
    const old=JSON.parse(ev.input);delete old.pause;R.sql.exec("UPDATE card_events SET input=? WHERE card=? AND seq=?",JSON.stringify(old),q[1],ev.seq);
    assert(!(await shown()).includes(q[1]),'a review saved before the marker is still hidden');
    R.sql.exec("UPDATE card_events SET text='x' WHERE card=? AND type='handoff'",q[1]);R.sql.exec("UPDATE turns SET error='interrupted',reply='' WHERE id=?",q[1]);
    assert(!(await shown()).includes(q[1]),'any handed-back turn a deploy cut off shows no Send it again bubble');R.sql.exec("UPDATE turns SET error=NULL WHERE id=?",q[1]);
  }
  // C: the login request went to Primary; before the approval nothing was typed, after it the system filled the saved login
  const lg=W.dodb.prepare("SELECT * FROM helper_requests WHERE helper_id=? AND kind='login'").get(h.id);
  assert.equal(lg.status,'approved');assert.equal(lg.site,'shop.example.com');assert.equal(lg.url,'https://shop.example.com/login');assert.equal(lg.uses,1);
  assert(workerMsgs.some(m=>m.includes('Not allowed yet')),'a fill with no approved request is refused');
  assert.equal(acts.length,1,'exactly one fill, after the approval');
  assert(JSON.stringify(acts[0]).includes(loginPlain),'the system typed the saved password into the browser');
  assert(acts[0].secret===true);
  // the password is in no stored row and no model message
  const dump=[];for(const {name} of W.dodb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()){try{dump.push(JSON.stringify(W.dodb.prepare(`SELECT * FROM ${name}`).all()));}catch{}}
  assert(!dump.join('').includes(loginPlain),'no stored row holds the password');assert(!workerMsgs.join('').includes(loginPlain),'no model message holds the password');
  assert(workerMsgs.some(m=>m.includes('this purchase was not approved for you')),'check_purchase for an unapproved purchase is refused');
  // purchase: approved by Primary, created in Link for the person, the worker waits for the person
  const pr=W.dodb.prepare("SELECT * FROM helper_requests WHERE helper_id=? AND kind='purchase'").get(h.id);
  assert.equal(pr.status,'approved');assert.equal(pr.purchase_id,'sr1');
  assert(fetches.some(([m,u])=>m==='POST'&&u.endsWith('/spend_requests')),'the Link request was created for the person to approve');
  assert.equal(h2.status,'waiting_input');assert.equal(h2.input_kind,'purchase_wait');assert.equal(R.session(session).waiting,'link');
  // the person says they approved: it goes to Primary and on to the same worker, which may now check the purchase
  decideSteer=String(h.id);
  await R.chat('t1','main','1','I approved it in Link.',{session});await W.settle(R);
  const h3=W.dodb.prepare('SELECT * FROM helpers WHERE id=?').get(h.id);
  assert.equal(h3.id,h.id);assert.equal(h3.round,4);assert.equal(h3.status,'approved','same worker finished and Primary approved it');
  assert(workerMsgs.some(m=>m.includes('Primary approved purchase request sr1')));
  R.sql.exec("UPDATE sessions SET waiting='browser' WHERE id=?",session);
  assert.equal(R.sessionView(R.session(session)).waiting,null,'once the worker finished, a leftover browser flag no longer holds the task');assert.equal(R.sessionView(R.session(session)).state,'ready');
  assert(fetches.some(([m,u])=>m==='GET'&&u.includes('/spend_requests/sr1')),'the worker checked the purchase through the gate');
  // a denied login: nothing is typed, and the worker is told
  const s2=R.newSession('Deny');acts.length=0;
  await R.chat('t1','main','1','Deny test please.',{session:s2});await W.settle(R);
  const dh=W.dodb.prepare('SELECT * FROM helpers WHERE session=?').get(s2),dl=W.dodb.prepare("SELECT * FROM helper_requests WHERE helper_id=? AND kind='login'").get(dh.id);
  assert.equal(dl.status,'denied');assert.equal(dl.uses,0);assert.equal(acts.length,0,'a denied login is never typed');
  assert(workerMsgs.some(m=>m.includes('Primary denied the saved login request')),'the worker is told');
  assert.equal(dh.status,'approved','the worker carried on after the denial and finished');
  // grants expire and are limited
  const now=Date.now();
  W.dodb.prepare("UPDATE helper_requests SET expires=? WHERE id=?").run(now-1,lg.id);
  assert.equal(workerLoginGrant(R.sql,h.id,()=>true),null,'an expired grant is not used');
  W.dodb.prepare("UPDATE helper_requests SET expires=?,uses=4 WHERE id=?").run(now+LOGIN_GRANT_MS,lg.id);
  assert.equal(workerLoginGrant(R.sql,h.id,()=>true),null,'a used up grant is not used');
  W.dodb.prepare("UPDATE helper_requests SET uses=0 WHERE id=?").run(lg.id);
  assert.equal(workerLoginGrant(R.sql,h.id,s=>s==='other.com'),null,'a grant covers only its site');
  assert(workerLoginGrant(R.sql,h.id,s=>s==='shop.example.com'));
  assert.equal(workerLoginGrant(R.sql,h.id+1,()=>true),null,'a grant belongs to one worker');
  // tool availability
  assert.equal(routingToolsAllowed({kind:'chat',orchestration:{requiredDelegation:true}},'request_saved_login'),false,'Primary cannot request a login');
  assert.equal(routingToolsAllowed({kind:'chat',orchestration:{requiredDelegation:true}},'browser_fill_login'),false,'Primary has no browser tools while delegation is required');
  assert.equal(routingToolsAllowed({kind:'chat'},'request_purchase'),false);
  assert.equal(routingToolsAllowed({kind:'helper',helper:{dynamic_routing:1}},'request_saved_login'),true);
  assert.equal(routingToolsAllowed({kind:'helper',helper:{dynamic_routing:1}},'decide_worker_request'),false,'a worker cannot decide its own request');
  assert.equal(routingToolsAllowed({kind:'chat',orchestration:{review:3,pausedKind:'login'}},'decide_worker_request'),true);
  assert.equal(routingToolsAllowed({kind:'chat',orchestration:{review:3,pausedKind:'browser'}},'decide_worker_request'),false,'only a login or purchase pause can be decided');
  assert.equal(routingToolsAllowed({kind:'chat',orchestration:{review:3,pausedKind:'login',browserHold:true}},'decide_worker_request'),false);
  console.log('routed browser: events, handoff pause and resume, login and purchase through Primary, gates passed');
}finally{globalThis.fetch=oldFetch;}
process.exit(0);
