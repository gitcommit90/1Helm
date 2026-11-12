// A worker's return must reach Primary at once. The raw agent record write (Mem0 embeddings and index) is slow or can hang,
// so the handoff must not wait for it. On Live a worker returned at 05:58:46 and Primary was woken at 06:00:37.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { memEnv } from "./helpers/mem0-fakes.mjs";
import { helpersInit } from "../src/helpers.js";
import { userInputInit } from "../src/user-input.js";
import { Resident } from "../src/resident.js";
const db = new DatabaseSync(":memory:");
const sql = {exec(q,...a) { const s = db.prepare(q), rows = /^\s*(SELECT|PRAGMA|WITH)/.test(q) ? s.all(...a) : (s.run(...a), []);return {toArray:()=>rows,one:()=>rows[0]}; }};
helpersInit(sql);userInputInit(sql);
db.exec("CREATE TABLE turns (id TEXT PRIMARY KEY, at INTEGER NOT NULL); CREATE TABLE msgs(turn TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT); CREATE TABLE files(id TEXT,name TEXT,deleted INTEGER,pending INTEGER,r2key TEXT); CREATE TABLE file_uses(session TEXT,file_id TEXT,at INTEGER); CREATE TABLE card_events(card TEXT,seq INTEGER,type TEXT,tool TEXT,input TEXT,full_args TEXT,cmd TEXT,status TEXT,exit INTEGER,ms INTEGER,out_bytes INTEGER)");
const { env } = memEnv();
let release; const hang = new Promise(r => { release = r; });
env.MEMORY_INDEX.upsert = () => hang;   // the record write never finishes until released
const kv = new Map([["tenant","11111111-2222-3333-4444-555555555555"],["channel","main"]]);
let handoffAt = 0;
const f = Object.assign(Object.create(Resident.prototype),{sql,env,get:k=>kv.get(k),put:(k,v)=>kv.set(k,v),active:new Map(),
  computer:()=>({exec:async()=>({code:0,out:""}),readFile:async()=>({ok:true,bytes:new TextEncoder().encode("[]")})}),ctx:{waitUntil(){}},
  handoff(){handoffAt=Date.now();return {mode:"open",card:{id:"review"}}},arm:async()=>{}});
sql.exec("INSERT INTO helpers(session,name,task,status,started,deadline,dynamic_routing,category,card) VALUES(?,?,?,'running',?,?,1,?,?)","task","Check","Compare records",1,9999999999999,"general","worker-card");
sql.exec("INSERT INTO msgs VALUES(?,?,?,?,?)","worker-card","user","Assigned job",null,null);
const h = sql.exec("SELECT * FROM helpers WHERE id=1").one();
const finish = f.orchestrationFinish(h,{turn:"worker-card",reply:"report",charge:1,tool_calls:0,steps:1},{helperDoneResponse:"report"});
const winner = await Promise.race([finish.then(() => "finished"), new Promise(r => setTimeout(() => r("stuck"), 1500))]);
assert.equal(winner,"finished","the handoff to Primary does not wait for the agent record write");
assert(handoffAt,"Primary was handed the worker's return");
assert.equal(sql.exec("SELECT status FROM helpers WHERE id=1").one().status,"awaiting_review");
release();
console.log("PASS worker return wakes Primary without waiting for the agent record write");
process.exit(0);
