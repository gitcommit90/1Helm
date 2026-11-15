// Looking at an image file with read_file, and the main helper's own screenshot. Scripted model; assertions concern app state only.
// (A background helper's screenshot staying out of the chat is checked in test/routed-browser.test.mjs.)
import {world,assert} from './deploy-harness.mjs';
const W=world();
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
W.env.WS={put:async(k,b)=>({size:b.byteLength}),head:async()=>null,get:async()=>null,delete:async()=>{}};
const reads=[];
W.computer.readFile=async(path,max)=>{reads.push(path);return path.endsWith('slide1.png')?{ok:true,bytes:png}:{ok:false,error:`no such file: ${path}`};};
W.computer.browser=async(op)=>op==='screenshot'?{ok:true,url:'https://example.com/page',title:'Example',jpeg_base64:btoa('jpegbytes')}:{ok:true};
const hasPicture=(m)=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url');
let phase='read';
W.brain=({who,messages,n})=>{
  if(who!=='main')return 'ok';
  const last=messages.at(-1);
  if(phase==='read'){W.seen=messages;return last.role==='user'&&typeof last.content==='string'&&!messages.some(hasPicture)&&!messages.some(m=>m.role==='tool')?{calls:[['read_file',{step_title:'Looking at the slide',path:'/workspace/slide1.png'}],['read_file',{step_title:'A missing image',path:'/workspace/nope.png'}]]}:'Looked.';}
  if(phase==='shot'){return !messages.some(m=>m.role==='tool')?{calls:[['browser_screenshot',{step_title:'Showing the page',caption:'The page'}]]}:'Shown.';}
  return 'ok';
};
const R=W.R;let events=[];
// A: read_file on an image gives the model the picture and does not show the person anything
{
  const session=R.newSession('Look');
  await R.chat('t1','main','1','Look at slide one.',{session});await W.settle(R);
  assert(reads.some(p=>p==='/workspace/slide1.png'),'the image was read from the computer');
  const calls=W.calls.filter(c=>c.who==='main');
  const withPic=calls.filter(c=>c.messages.some(hasPicture));
  assert(withPic.length>=1,'the next model call carries the image as an image part');
  const part=withPic[0].messages.find(hasPicture).content.find(p=>p.type==='image_url');
  assert(part.image_url.url.startsWith('data:image/png;base64,'));
  assert.equal(R.sql.exec("SELECT COUNT(*) n FROM shots").one().n,0,'nothing is posted to the chat');
  assert(!R.sql.exec("SELECT content FROM msgs").toArray().some(r=>String(r.content).includes('base64,')),'no stored message holds the picture');
  const tools=R.sql.exec("SELECT content FROM msgs WHERE role='tool'").toArray().map(r=>String(r.content));
  assert(tools.some(t=>/no such file/.test(t)),'a missing image is an error result, not a silent failure');
}
// B: a model that cannot see images is told so in the result
{
  const tc={kind:'chat',taskProfile:{catalog:{input_modalities:['text']}}};
  const out=await R.viewImageFile('slide1.png',tc);
  assert.equal(out.code,0);assert(/can't look at images/.test(out.out));assert(!tc.viewPics?.length,'no picture was queued for a model that cannot use it');
  const tc2={kind:'chat',taskProfile:{catalog:{input_modalities:['text','image']}}};
  assert(/picture follows/.test((await R.viewImageFile('slide1.png',tc2)).out));assert.equal(tc2.viewPics.length,1);
  assert.equal((await R.viewImageFile('../x.png',tc2)).code,2,'a path with .. is refused');
}
// C: a helper's relative path is read from its own folder
{
  reads.length=0;const tc={kind:'helper',helper:{id:7},taskProfile:{catalog:{input_modalities:['image']}}};
  await R.viewImageFile('slide1.png',tc);
  assert.equal(reads[0],'/workspace/workspace/helpers/7/slide1.png');
}
// D: the main helper's own screenshot still reaches the chat
{
  phase='shot';const session=R.newSession('Shot'),ev=[];R._routingObservers=new Map([[session,new Set([o=>ev.push(o)])]]);
  await R.chat('t1','main','1','Show me the page.',{session});await W.settle(R);
  assert.equal(R.sql.exec("SELECT COUNT(*) n FROM shots WHERE session=?",session).one().n,1,'the main helper screenshot is a chat image');
  const d=await R.sessionDetail(session);assert.equal(d.turns.at(-1).images.length,1);assert.equal(d.turns.at(-1).images[0].caption,'The page');
}
console.log('helper-look ok');
