// Skill scripts on the channel computer (see src/skills/README.md). The scripts are bundled into the Worker as text (bundle.js) and the
// computer's controller (ChannelComputer.installSkills in src/channel-computer.js) writes the whole set to SKILLS_DIR on the
// computer's own disk, not in /workspace: right after each start, and before a command whenever the installed set isn't this deploy's
// (SKILLS_VERSION, a hash of every script's path and text). Kept apart from index.js so the controller doesn't load the prompt code.
import { FILES } from "./bundle.js";

export const SKILLS_DIR = "/opt/1hc/skills";
// [{ path: "<slug>/scripts/<file>", text }], sorted by path.
export const SKILL_SCRIPTS = Object.keys(FILES).filter((p) => /^[^/]+\/scripts\//.test(p)).sort().map((path) => ({ path, text: String(FILES[path]) }));
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
