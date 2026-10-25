// Skill scripts on the channel computer (see src/skills/README.md). The scripts are bundled into the Worker as text (bundle.js) and the
// computer's controller (ChannelComputer.installSkills in src/channel-computer.js) writes the whole set to SKILLS_DIR on the
// computer's own disk, not in /workspace: right after each start, and before a command whenever the installed set isn't this deploy's
// (SKILLS_VERSION, a hash of every script's path and text). Kept apart from index.js so the controller doesn't load the prompt code.
import { FILES } from "./bundle.js";

export const SKILLS_DIR = "/opt/1hc/skills";
// [{ path: "<slug>/scripts/<file>", text }], sorted by path.
// The deck templates are not in the Worker bundle (they are about 5 MB): they are static assets under app-assets/deck-templates/, and
// ChannelComputer.installTemplates writes the one template a deck command names to TEMPLATES_DIR (src/deck-templates.js).
export const SKILL_SCRIPTS = Object.keys(FILES).filter((p) => /^[^/]+\/scripts\//.test(p)).sort().map((path) => ({ path, text: String(FILES[path]) }));
export const TEMPLATES_DIR = "/opt/1hc/deck-templates";
// A command that needs a template on the computer.
export const DECK_COMMAND = /\/skills\/artifacts\/scripts\/(new_deck\.mjs|make_deck\.sh|assemble_deck\.mjs|deck_check\.mjs|export_pptx\.mjs)/;
// What a deck command refers to: the templates it names (--template, --patterns) and the project folders it works on (the first absolute
// path after the script), whose .src/deck.json names the template. A command may run several deck scripts.
export function deckCommandRefs(cmd) {
  const names = new Set(), projects = new Set(), re = /(?:new_deck\.mjs|make_deck\.sh|assemble_deck\.mjs|deck_check\.mjs|export_pptx\.mjs)((?:[ \t]+(?:"[^"]*"|'[^']*'|[^\s;&|]+))*)/g;
  for (const m of String(cmd).matchAll(re)) {
    const t = [...m[1].matchAll(/"([^"]*)"|'([^']*)'|([^\s;&|]+)/g)].map((x) => x[1] ?? x[2] ?? x[3]);
    t.forEach((x, i) => { if ((x === "--template" || x === "--patterns") && /^[a-z0-9-]+$/.test(t[i + 1] || "")) names.add(t[i + 1]); });
    const p = t.find((x) => x.startsWith("/")); if (p) projects.add(p.replace(/\/+$/, ""));
  }
  return { names: [...names], projects: [...projects] };
}
export const scriptPath = (p) => `${SKILLS_DIR}/${p}`;

// FNV-1a, two lanes (64 bits): same scripts → same version, any change → a new one. Sync and dependency-free.
function hash(s) {
  let a = 0x811c9dc5, b = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export const SKILLS_VERSION = hash(SKILL_SCRIPTS.map((f) => `${f.path}\0${f.text}`).join("\0"));

// Runs on the computer as `node -e SKILLS_INSTALL_JS <dir>` with {"v", "files": {path: text}} on stdin. Writes a fresh copy beside the
// old one and swaps it in, so a command never sees half a set. Every script is executable. Prints "ok <n> <version>".
export const SKILLS_INSTALL_JS = `const fs=require("fs"),path=require("path"),root=process.argv[1]||"${SKILLS_DIR}";let s="";
process.stdin.setEncoding("utf8");process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{const j=JSON.parse(s),tmp=root+".new-"+process.pid,old=root+".old-"+process.pid;
fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});let n=0;
for(const [p,t] of Object.entries(j.files)){const f=path.resolve(tmp,p);if(!f.startsWith(tmp+"/"))throw new Error("bad path "+p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,t,{mode:0o755});n++;}
fs.writeFileSync(tmp+"/.version",j.v+"\\n");
if(fs.existsSync(root))fs.renameSync(root,old);fs.renameSync(tmp,root);fs.rmSync(old,{recursive:true,force:true});console.log("ok "+n+" "+j.v);});`;
// The stdin payload for SKILLS_INSTALL_JS.
export const skillsPayload = () => JSON.stringify({ v: SKILLS_VERSION, files: Object.fromEntries(SKILL_SCRIPTS.map((f) => [f.path, f.text])) });

// Runs on the computer as `node -e TEMPLATE_INSTALL_JS <dir>` with {"name", "hash", "files": {path: text}} on stdin. The files are paths under
// <dir>: "<name>/..." (the template, swapped in whole so a removed slide file never lingers) and shared ones (_fonts/, _lib/, LICENSE; each
// replaced on its own). Writes <dir>/<name>/.hash and prints "ok <n> <hash>".
export const TEMPLATE_INSTALL_JS = `const fs=require("fs"),path=require("path"),root=path.resolve(process.argv[1]||"${TEMPLATES_DIR}");let s="";
process.stdin.setEncoding("utf8");process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{const j=JSON.parse(s),name=j.name;if(!/^[a-z0-9-]+$/.test(name))throw new Error("bad name");
const tmp=path.join(root,name+".new-"+process.pid);fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});let n=0;
for(const [p,t] of Object.entries(j.files)){const f=path.resolve(root,p);if(!f.startsWith(root+"/"))throw new Error("bad path "+p);
if(p.startsWith(name+"/")){const d=path.join(tmp,p.slice(name.length+1));fs.mkdirSync(path.dirname(d),{recursive:true});fs.writeFileSync(d,t);}
else{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+".tmp-"+process.pid,t);fs.renameSync(f+".tmp-"+process.pid,f);}n++;}
fs.writeFileSync(path.join(tmp,".hash"),j.hash+"\\n");fs.rmSync(path.join(root,name),{recursive:true,force:true});fs.renameSync(tmp,path.join(root,name));console.log("ok "+n+" "+j.hash);});`;
