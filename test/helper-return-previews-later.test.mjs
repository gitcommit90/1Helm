// A worker's return releases its files and lists them at once. Nothing waits for the slow image and document previews (a held file's preview is no longer built: the files are attached).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { memEnv } from "./helpers/mem0-fakes.mjs";
import { helpersInit } from "../src/helpers.js";
import { userInputInit } from "../src/user-input.js";
import { initRoutingArtifacts } from "../src/ee/routing-artifacts.js";
import { Resident } from "../src/resident.js";
const db = new DatabaseSync(":memory:");
const sql = {exec(q,...a) { const s = db.prepare(q), rows = /^\s*(SELECT|PRAGMA|WITH)/.test(q) ? s.all(...a) : (s.run(...a), []);return {toArray:()=>rows,one:()=>rows[0]}; }};
helpersInit(sql);userInputInit(sql);initRoutingArtifacts(sql);
db.exec("CREATE TABLE turns (id TEXT PRIMARY KEY, at INTEGER NOT NULL); CREATE TABLE msgs(turn TEXT,role TEXT,content TEXT,tool_calls TEXT,tool_call_id TEXT); CREATE TABLE files(id TEXT,name TEXT,deleted INTEGER,pending INTEGER,r2key TEXT); CREATE TABLE file_uses(session TEXT,file_id TEXT,at INTEGER); CREATE TABLE card_events(card TEXT,seq INTEGER,type TEXT,tool TEXT,input TEXT,full_args TEXT,cmd TEXT,status TEXT,exit INTEGER,ms INTEGER,out_bytes INTEGER)");
const { env } = memEnv();
let release; const slow = new Promise(r => { release = r; });
let reads = 0;
env.WS = { get: async () => { reads++; await slow; return null; }, put: async () => ({}), head: async () => null, delete: async () => {} };   // reading a file for its preview is slow
const kv = new Map([["tenant","11111111-2222-3333-4444-555555555555"],["channel","main"]]);
let note = null; const background = [];
const f = Object.assign(Object.create(Resident.prototype),{sql,env,get:k=>kv.get(k),put:(k,v)=>kv.set(k,v),active:new Map(),
  computer:()=>({exec:async()=>({code:0,out:""}),readFile:async()=>({ok:true,bytes:new TextEncoder().encode("[]")})}),ctx:{waitUntil:p=>background.push(p)},
  handoff(_s,input){note=input.text;return {mode:"open",card:{id:"review"}}},arm:async()=>{}});
sql.exec("INSERT INTO helpers(session,name,task,status,started,deadline,dynamic_routing,category,card) VALUES(?,?,?,'running',?,?,1,?,?)","task","Check","Compare records",1,9999999999999,"general","worker-card");
sql.exec("INSERT INTO msgs VALUES(?,?,?,?,?)","worker-card","user","Assigned job",null,null);
sql.exec("INSERT INTO routing_artifact_rounds(helper_id,round,session,channel,manifest,state) VALUES(1,1,'task','main','[]','staging')");
sql.exec("INSERT INTO routing_artifacts(id,helper_id,round,session,channel,path,name,mime,bytes,r2key,state,at) VALUES('f1',1,1,'task','main','/workspace/workspace/helpers/1/shot.png','shot.png','image/png',900000,'k1','held',1)");
const h = sql.exec("SELECT * FROM helpers WHERE id=1").one();
const finish = f.orchestrationFinish(h,{turn:"worker-card",reply:"report",charge:1,tool_calls:0,steps:1},{helperDoneResponse:"report"});
const winner = await Promise.race([finish.then(() => "finished"), new Promise(r => setTimeout(() => r("stuck"), 1500))]);
assert.equal(winner,"finished","the return does not wait for image previews");
// There is no review step any more: the return releases the files in the same call. This fixture has no Library table, so the release fails on its own, which must show in the note
// (the worker is not left waiting for anyone to approve), and the file list still names the file.
assert(note.includes("shot.png"),"the note lists the file");
assert(/could not be released/.test(note)&&!/already attached/.test(note)&&!/approve|hidden from the person/i.test(note),note);
const saved = JSON.parse(sql.exec("SELECT handoff_json FROM helpers WHERE id=1").one().handoff_json);
assert.equal(saved.files.length,1);assert.deepEqual(saved.released,[],"the release was tried once and is recorded");
release(); await Promise.all(background);
assert.deepEqual(JSON.parse(sql.exec("SELECT handoff_json FROM helpers WHERE id=1").one().handoff_json).released,[],"nothing built later replaces the release record");
console.log("PASS worker return releases files at once, without waiting for previews");
process.exit(0);
