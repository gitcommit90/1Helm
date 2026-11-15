// Requires the dynamic task-profile runtime. Synthetic calls only.
import assert from 'node:assert/strict';
import { openRouterChat } from './helpers/or-chat.mjs';
import { seedSettings, ID } from './helpers/seed-settings.mjs';
const cf='@cf/example/worker',or=ID.SOL,settings=seedSettings();let level='no_training',wire=[],native=[];
const catalog=(id,source,hosts)=>({id,source,eligible:true,kinds:['chat'],hosts,levels:source==='CF'?['unrestricted','no_training']:['unrestricted','no_training','zdr'],efforts:['default','high'],context_length:16000,max_output:source==='CF'?400:800,input_modalities:['text'],pricing:{prompt:1,completion:2},tool_choice:['auto'],json:false});
const c=catalog(cf,'CF',['cloudflare']),o=catalog(or,'OR',['azure']);
settings.catalog[cf]=c;settings.catalog[or]=o;
const profile=m=>({version:1,mode:'managed',source:m.source,requestedModel:m.id,effort:m.source==='CF'?'default':'high',catalog:m,hosts:m.hosts,contextLength:m.context_length,maxOutput:m.max_output,cacheSession:'stable',level:'no_training'});
const a=profile(o),b=profile(c),env={ENV_NAME:'dev',ONEHELM_EE:'1hc',DYNAMIC_ROUTING:'on',MODEL_SETTINGS:settings,OPENROUTER_API_KEY:'synthetic',PROMPT_CACHE:'off',DB:{prepare(){return {bind(){return this},async first(){return {ai_privacy:level}}}}},AI:{async run(m,body,opts){native.push({m,body,opts});return Response.json({response:'fixture',usage:{prompt_tokens:10,completion_tokens:5}})}}};
globalThis.fetch=async(_u,init)=>{wire.push(JSON.parse(init.body));return new Response('unavailable',{status:503})};
let route={taskAffinity:true,taskProfile:{...a,poolChain:[a,b]}};
let r=await openRouterChat(env,{messages:[{role:'assistant',content:'history',reasoning_details:[{}],_rmodel:or}],max_tokens:50000},'ignored',route,{tenant:'t'});let out=await r.json();
assert.equal(wire.length,2);assert(wire.every(p=>p.model===or));assert.equal(native[0].m,cf);assert.equal(native[0].body.max_tokens,undefined);assert(!native[0].body.messages[0].reasoning_details);assert.equal(out.provider,'Cloudflare');assert.equal(out.usage.cost,.00002);assert.equal(route.served,cf);
wire=[];native=[];env.AI.run=async(m,body)=>{native.push({m,body});return new Response('outage',{status:503})};globalThis.fetch=async(_u,init)=>{wire.push(JSON.parse(init.body));return Response.json({model:or,choices:[{message:{content:'fixture'}}],usage:{cost:.00001}})};
route={taskAffinity:true,taskProfile:{...b,poolChain:[b,a]}};r=await openRouterChat(env,{messages:[],max_tokens:50000},'ignored',route,{tenant:'t'});out=await r.json();assert.equal(native.length,2);assert.equal(wire.length,1);assert.equal(wire[0].model,or);assert.equal(wire[0].reasoning.effort,'high');assert.equal(wire[0].max_tokens,undefined);assert.equal(route.served,or);
level='zdr';native=[];wire=[];route={taskAffinity:true,taskProfile:{...b,poolChain:[b,a]}};await openRouterChat(env,{messages:[]},'ignored',route,{tenant:'t'});assert.equal(native.length,0);assert.equal(wire.length,1);assert.equal(wire[0].provider.zdr,true);
console.log('PASS mixed source task fallbacks: OR to CF, CF to OR, frozen output/effort/reasoning, fresh privacy skip, actual response source/cost');
