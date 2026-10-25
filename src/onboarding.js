import { ONBOARD_STATIC_CSS_V, ONBOARD_STATIC_JS_V } from "./asset-version.js";
import { pageDialog } from "./page-dialog.js";
import { US_ONLY as US_ONLY_MSG } from "./ee/index.js";
import { includedGb, fmtGb } from "./storage.js";
import { DEFAULT_HELPER } from "./helper-name.js";
const h = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attrs = (value = "") => h(value);

const STEP = { address: 1, plan: 2, profile: 3, helper: 4 };
const helperChoices = [
  [8, "Skipper"], [1, "Chomp"], [2, "Pebble"], [3, "Ollie"], [4, "Penny"],
  [5, "Shelly"], [6, "Moss"], [7, "Plum"], [9, "Pip"],
];

function shell(title, body, { narrow = false, script = true, status = 200 } = {}) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${h(title)} · 1Helm</title><meta name="robots" content="noindex"><meta name="theme-color" content="#f3f2ef"><link rel="icon" type="image/png" href="/1helm-icon-64.png"><link rel="apple-touch-icon" href="/1helm-sailboat.png"><link rel="stylesheet" href="/onboard-static/style.css?v=${ONBOARD_STATIC_CSS_V}">${script ? `<script defer src="/onboard-static/app.js?v=${ONBOARD_STATIC_JS_V}"></script>` : ""}</head>
<body><div class="ambient one"></div><div class="ambient two"></div><main class="shell${narrow ? " narrow" : ""}"><a class="brand" href="/" aria-label="1Helm home"><img src="/1helm-icon.png" alt=""><span>1Helm</span></a>${body}</main></body></html>`, {
    status, headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

// The required attestation on the sign-in forms. The submit button stays disabled until the box is checked; the server refuses a submit without it.
const AGE_BOX = '<label class="agebox" style="display:flex;align-items:center;gap:10px;margin:14px 0 0;font-size:14px;font-weight:500;cursor:pointer"><input type="checkbox" name="adult" value="yes" required style="width:20px;height:20px;flex:none;margin:0;padding:0;accent-color:currentColor"><span>I am 18 or older</span></label><input type="hidden" name="version" value="1">';
const AGE_SCRIPT = "<style>form[data-age] button[type=submit]:disabled{opacity:.4;cursor:default}</style><script>(()=>{const f=document.querySelector('form[data-age]'),b=f.querySelector('input[name=adult]'),s=f.querySelector('button[type=submit]'),y=()=>s.disabled=!b.checked;b.addEventListener('change',y);addEventListener('pageshow',y);y()})();</script>";

function notice(error) { return error ? `<div class="notice error" role="alert">${h(error)}</div>` : ""; }
function progress(step) {
  const n = STEP[step];
  return `<div class="progress" aria-label="Setup step ${n} of 4"><span>Set up your 1Helm</span><div>${[1, 2, 3, 4].map((x) => `<i class="${x <= n ? "on" : ""}"></i>`).join("")}</div><b>${n} of 4</b></div>`;
}

export function landingPage(data = {}) {
  return shell("Your own capable helper", `<section class="landing"><div class="promise"><p class="eyebrow">Your own capable helper</p><h1>Put something down.<br>1Helm picks it up.</h1><p class="lead">Give your helper a task. It can research, create files, use a real browser, and keep working while you move on.</p><div class="proof"><span><b>1</b> You ask normally</span><span><b>2</b> Your helper does the work</span><span><b>3</b> You decide when it’s done</span></div></div>
  <div class="signup card"><div class="cardhead"><img src="/av/8.png" alt=""><div><span>Meet Skipper</span><small>Your first 1Helm helper</small></div></div><h2>Start your 1Helm</h2><p>No server to run. No AI keys to find.</p>
  ${notice(data.error)}<form method="post" action="/auth/start" data-age><label for="email">Email address</label><input id="email" name="email" type="email" required autocomplete="email" inputmode="email" placeholder="you@example.com" value="${attrs(data.email || "")}" autofocus>${AGE_BOX}<button class="primary" type="submit">Continue <span>→</span></button></form>${AGE_SCRIPT}
  <div class="plan"><div><b>Plans from $30</b><span>Personal · Plus · Power · Max</span></div><strong>$30<small>/month</small></strong></div>
  ${data.testMode ? '<p class="testnote"><span>Test mode</span> Nothing here can charge a real card.</p>' : ""}</div></section>`, { script: false, status: data.status || 200 });
}

export function selfHostedSignInPage(data = {}) {
  const intro = data.claimed ? "Only this server's owner can sign in. Use the email address you used when setting it up." : "The first address to complete sign-in becomes this server's owner. You can add your AI provider key in Settings after signing in.";
  return shell("Sign in to your 1Helm", `<section class="center card"><p class="eyebrow">Your Cloudflare account</p><h1>Sign in to your 1Helm</h1><p>${intro}</p>${notice(data.error)}<form method="post" action="/auth/start"><label for="email">Email address</label><input id="email" name="email" type="email" required autocomplete="email" value="${attrs(data.email || "")}"><button class="primary" type="submit">Email me a sign-in link <span>→</span></button></form></section>`, { narrow: true, script: false });
}

// The 6-digit code from the sign-in email (src/signin-code.js), for the server-rendered "Check your email" pages (here and at a
// person's own address). One real input (so paste, the keyboard's code autofill and password managers all work) drawn as six boxes;
// the 6th digit submits. "Send a new code" re-posts the email after a short wait. No native dialogs.
export function codeEntry(d = {}) {
  const email = attrs(d.email || ""), wait = Math.max(0, Number(d.wait) || 0), dead = ["expired", "used", "too_many", "locked"].includes(d.codeKind);
  return `<style>.otp{margin:22px 0 0;text-align:left}.otp label{display:block;margin:0 0 8px;font-size:13px;font-weight:650}
.otp .boxes{position:relative;display:grid;grid-template-columns:repeat(6,minmax(0,52px));justify-content:center;gap:8px}
.otp .boxes i{height:56px;display:grid;place-items:center;border:1px solid #d8d5ce;border-radius:14px;background:#fff;font:600 24px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-style:normal;color:#1c1b19}
.otp .boxes i.cur{border-color:#1c1b19;box-shadow:0 0 0 3px rgba(28,27,25,.08)}.otp.bad .boxes i{border-color:#dc2626}
.otp .boxes input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:.011;background:transparent;color:transparent;caret-color:transparent;font-size:16px;letter-spacing:40px;outline:0;box-shadow:none}
.otp .boxes input::selection{background:transparent}.otp .err{margin:10px 0 0;color:#b91c1c;font-size:14px;text-align:center}
.otp button.go{margin-top:14px}.otp .row{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 16px;margin:14px 0 0}
.otp .row button,.otp .row a{border:0;background:none;padding:6px 2px;color:#77746c;font:inherit;font-size:14px;cursor:pointer;text-decoration:underline;text-decoration-color:#d8d5ce;text-underline-offset:2px;white-space:nowrap}
.otp .row button[disabled]{cursor:default;text-decoration:none;color:#a8a49b}.otp .row button.hot{color:#1c1b19;font-weight:600;text-decoration-color:currentColor}</style>
<form class="otp${d.codeError ? " bad" : ""}" method="post" action="/auth/code" id="otpform"><input type="hidden" name="email" value="${email}">
<label for="otp">Enter the 6-digit code from the email</label>
<div class="boxes"><input id="otp" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required aria-describedby="otperr" ${dead ? "" : "autofocus"}>${"<i></i>".repeat(6)}</div>
${d.codeError ? `<p class="err" id="otperr" role="alert">${h(d.codeError)}</p>` : `<p class="err" id="otperr" hidden></p>`}
<button class="primary btn go" type="submit">Sign in</button></form>
<form method="post" action="/auth/start" class="otp" style="margin:0"><input type="hidden" name="email" value="${email}"><div class="row"><button type="submit" id="resend" class="${dead ? "hot" : ""}" data-wait="${wait}">Send a new code</button><a href="/">Use a different email</a></div></form>
<script>(()=>{const f=document.getElementById("otpform"),x=document.getElementById("otp"),bx=[...f.querySelectorAll(".boxes i")];
const draw=()=>{const v=x.value;bx.forEach((b,i)=>{b.textContent=v[i]||"";b.classList.toggle("cur",document.activeElement===x&&i===Math.min(v.length,5))})};
let sent=false;x.addEventListener("input",()=>{const v=x.value.replace(/\D/g,"").slice(0,6);if(v!==x.value)x.value=v;f.classList.remove("bad");draw();if(v.length===6&&!sent){sent=true;f.requestSubmit?f.requestSubmit():f.submit()}});
["focus","blur","keyup","click"].forEach((e)=>x.addEventListener(e,draw));f.addEventListener("submit",()=>{sent=true;const b=f.querySelector(".go");b.disabled=true;b.textContent="Checking…"});draw();
const r=document.getElementById("resend");let w=+r.dataset.wait||0;const t=()=>{if(w>0){r.disabled=true;r.textContent="Send a new code in "+w+"s";w--;setTimeout(t,1000)}else{r.disabled=false;r.textContent="Send a new code"}};t();})();</script>`;
}

export function checkEmailPage(email, link, testMode, data = {}) {
  const test = testMode ? `<div class="testbox"><span>Prototype shortcut</span><p>Test address (@example.com): nothing is emailed. This button is the sign-in link, and the code is <b id="testcode">${h(data.testCode || "")}</b>.</p><a class="primary" id="magic" href="${attrs(link)}">Open my sign-in link <span>→</span></a></div>` : "";
  return shell("Check your email", `<section class="center card"><div class="mailicon">✦</div><p class="eyebrow">One quick check</p><h1>Check your email</h1>${notice(data.error)}<p>We sent a sign-in code and link to <strong>${h(email)}</strong>. Enter the code here, or tap the link in the email. Both expire in 15 minutes. It comes from <strong>${h(data.emailFrom || "your server’s configured sender")}</strong>; check spam if it isn’t there in a minute.</p>${test}${codeEntry({ email, wait: data.wait, codeError: data.codeError, codeKind: data.codeKind })}</section>`, { narrow: true, script: false });
}

export function expiredPage() {
  return shell("That link expired", `<section class="center card"><div class="mailicon">↻</div><h1>That link has expired</h1><p>Sign-in links and codes work once and expire after 15 minutes. If you already signed in with the code, you're all set.</p><a class="primary" href="/">Send me a new one <span>→</span></a></section>`, { narrow: true, script: false });
}

// The link in "Confirm your new 1Helm sign-in email" (src/account.js). GET shows one button; only its POST switches the address.
export function emailChangePage(state, d = {}) {
  if (state === "confirm") return shell("Confirm your new email", `<section class="center card"><div class="mailicon">✉</div><p class="eyebrow">Your account</p><h1>Use this email?</h1><p>Your 1Helm sign-in email will change from <strong>${h(d.from || "")}</strong> to <strong>${h(d.to || "")}</strong>. From then on, sign-in links go to the new address.</p><form method="post" action="/auth/email-change"><input type="hidden" name="token" value="${attrs(d.token || "")}"><button class="primary" type="submit" id="confirm">Switch to this email <span>→</span></button></form><a class="quietlink" href="/">Not now</a></section>`, { narrow: true, script: false });
  if (state === "done") return shell("Email changed", `<section class="center card"><div class="mailicon">✓</div><p class="eyebrow">Your account</p><h1>Email changed</h1><p>You now sign in with <strong>${h(d.to || "")}</strong>. We let your old address know.</p><a class="primary" href="${attrs(d.app || "/")}" id="toapp">Open 1Helm <span>→</span></a></section>`, { narrow: true, script: false });
  if (state === "taken") return shell("Email already in use", `<section class="center card"><div class="mailicon">!</div><h1>That email is taken</h1><p><strong>${h(d.to || "")}</strong> already belongs to another 1Helm account, so nothing changed. Pick a different address in Settings → Your account.</p><a class="primary" href="/">Open 1Helm <span>→</span></a></section>`, { narrow: true, script: false });
  if (state === "stale") return shell("Link out of date", `<section class="center card"><div class="mailicon">↻</div><h1>This link is out of date</h1><p>Your sign-in email changed since this link was sent, so nothing changed. Ask again from Settings → Your account.</p><a class="primary" href="/">Open 1Helm <span>→</span></a></section>`, { narrow: true, script: false });
  return shell("That link expired", `<section class="center card"><div class="mailicon">↻</div><h1>That link has expired</h1><p>Email-change links work once and expire after an hour. Ask for a new one in Settings → Your account.</p><a class="primary" href="/">Open 1Helm <span>→</span></a></section>`, { narrow: true, script: false });
}

export function onboardPage(step, data = {}) {
  const error = notice(data.error);
  if (step === "waiting") return shell("Setting up your 1Helm", `<section class="center card waiting" data-payment-wait><div class="orb"><img src="/av/8.png" alt=""><i></i></div><p class="eyebrow">Payment received</p><h1>Getting your 1Helm ready</h1><p>Stripe is confirming your payment. This normally takes only a few seconds.</p><div class="waitline"><i></i><span>Waiting for confirmation…</span></div><p class="slow" hidden>This is taking longer than usual. You can safely refresh this page.</p></section>`, { narrow: true });
  if (step === "address") {
    const slug = data.slug || "";
    return shell("Choose your address", `<section class="setup">${progress(step)}<div class="setupgrid"><div class="setupcopy"><p class="eyebrow">A place of your own</p><h1>Choose your 1Helm address.</h1><p>This is where your helper, tasks, files, and memory will live. Keep it short—you can bookmark it once and forget about it.</p><div class="promisechip"><img src="/av/8.png" alt=""><span>Skipper will be waiting on the other side.</span></div></div>
      <div class="card formcard">${error}<form method="post" action="/onboard" data-address-form><label for="slug">Your address</label><div class="address"><input id="slug" name="slug" required minlength="3" maxlength="48" pattern="[a-z0-9-]{3,48}" value="${attrs(slug)}" placeholder="joseph" autocomplete="off" autocapitalize="none" spellcheck="false" autofocus>${data.domain ? `<span>.${h(data.domain)}</span>` : ""}</div><p class="fieldnote" data-slug-note>Lowercase letters, numbers, and single hyphens.</p><button class="primary" type="submit">Continue <span>→</span></button></form></div></div></section>`);
  }
  if (step === "plan") {
    const cur = data.plan || "plus", P = data.plans || {};
    const order = ["personal", "plus", "power", "max"], mult = { personal: "", plus: "2× the usage of Personal", power: "4× the usage of Personal", max: "8× the usage of Personal" };
    const cards = order.map((k) => { const x = P[k]; if (!x) return ""; return `<label class="plancard${k === cur ? " on" : ""}"><input type="radio" name="plan" value="${k}"${k === cur ? " checked" : ""}>${k === "plus" ? '<em>Most people</em>' : ""}<b>${h(x.name)}</b><small>${h(x.fit)}</small><strong>$${x.price}<span>/month</span></strong><i>${k === "personal" ? "Your own helper and computer" : h(mult[k])}</i><i>${h(fmtGb(includedGb(k)))} of storage</i></label>`; }).join("");
    // Bring your own key (src/byok.js): its own row under the four, since it works differently (AI on the person's own key).
    const B = P.byok, byok = B ? `<label class="plancard planbyok${cur === "byok" ? " on" : ""}"><input type="radio" name="plan" value="byok"${cur === "byok" ? " checked" : ""}><span class="pbk"><b>${h(B.name)}</b><small>Already pay for an AI service? Use your own key with any OpenAI-compatible provider.</small><i>${h(fmtGb(includedGb("byok")))} of storage included. The helper's computer, browser and memory are paid from credits you add, at cost + 15%. The AI part isn't covered by 1Helm's zero-data-retention guarantee: your provider's terms apply.</i></span><strong>$${B.price}<span>/month</span></strong></label>` : "";
    return shell("Pick a plan", `<section class="setup planstep">${progress(step)}<div class="setupintro"><p class="eyebrow">${h(data.slug || "")}${data.domain ? `.${h(data.domain)}` : ""}</p><h1>Pick a plan.</h1><p>Change or cancel anytime.</p></div>${error}<form method="post" action="/onboard/plan" class="planform" data-plan-form><div class="plans" role="radiogroup" aria-label="Plans">${cards}</div>${byok}<div class="planfoot"><button class="primary" type="submit">Continue to payment <span>→</span></button>${data.testMode ? '<p class="testnote"><span>Test mode</span> Card 4242 4242 4242 4242 · any future date · any CVC</p>' : ""}<a class="quietlink" href="/onboard">Back</a></div></form></section>`);
  }
  if (step === "profile") return shell("A little about you", `<section class="setup">${progress(step)}<div class="setupgrid"><div class="setupcopy"><p class="eyebrow">First things first</p><h1>What should your helper call you?</h1><p>Your first name is enough. This makes your 1Helm feel like yours without turning setup into a questionnaire.</p></div>
    <div class="card formcard">${error}<form method="post" action="/onboard/profile"><label for="first_name">Your first name</label><input id="first_name" name="first_name" required maxlength="80" value="${attrs(data.firstName || "")}" placeholder="Joseph" autocomplete="given-name" autofocus><p class="fieldnote">Your helper will use it naturally—not in every reply.</p><button class="primary" type="submit">Continue <span>→</span></button></form><p class="privacy">No profile quiz. Your helper learns what matters by working with you.</p></div></div></section>`);
  if (step === "helper") {
    const avatar = Number(data.avatar || 8), helperName = data.helperName || helperChoices.find(([id]) => id === avatar)?.[1] || DEFAULT_HELPER;
    return shell("Meet your helper", `<section class="setup helperstep">${progress(step)}<div class="setupintro"><p class="eyebrow">One last choice</p><h1>Meet your first helper.</h1><p>Pick the face and name you want to see every day. You can change both later.</p></div>${error}<form class="helperform" method="post" action="/onboard/helper" data-helper-form><input type="hidden" name="helper_avatar" value="${avatar}" data-avatar>
      <div class="helpers" role="radiogroup" aria-label="Choose a helper">${helperChoices.map(([id, name]) => `<button type="button" class="helper${id === avatar ? " on" : ""}" data-helper="${id}" data-name="${h(name)}" role="radio" aria-checked="${id === avatar}"><span><img src="/av/${id}.png" alt=""></span><b>${h(name)}</b></button>`).join("")}</div>
      <div class="card namecard"><div class="chosen"><img src="/av/${avatar}.png" alt="" data-chosen-avatar><div><label for="helper_name">Your helper’s name</label><input id="helper_name" name="helper_name" required maxlength="40" value="${attrs(helperName)}" autocomplete="off" data-helper-name></div></div><button class="primary" type="submit">Meet <span data-meet-name>${h(helperName)}</span> <span>→</span></button><a class="quietlink" href="/onboard/profile">Back</a></div>
    </form></section>`);
  }
  throw new Error(`unknown onboarding step: ${step}`);
}

// ---- Text with your helper: one calm page, three steps (number → free Photon sign-up → text the code) ----
const fmtPhone = (e) => { const m = String(e || "").match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(e || ""); };
// Which service their phone texts on (texting.js refreshService): Android phones get plain text messages (SMS/RCS fallback).
const svcLabel = (s) => ({ imessage: "iMessage", sms: "Text messages (SMS)", rcs: "Text messages (RCS)", not_imessage: "Text messages" })[s] || "";
export function textingPage(d = {}) {
  const helper = h(d.helper || "your helper"), av = Number(d.avatar || 8), api = attrs(d.api), back = attrs(d.back);
  const notIM = d.service && d.service !== "imessage";
  // Said before anyone starts (Captain 10-06): who it works for. d.android false (TEXTING_ANDROID=off) = iPhone only.
  const whoNote = d.android === false
    ? `<p class="fieldnote" data-who>Texting works with iPhone (iMessage) right now. On Android? You can still talk to ${helper} in the 1Helm app anytime. For US numbers.</p>`
    : `<p class="fieldnote" data-who>Works with US cell numbers, iPhone or Android. On iPhone it's iMessage, with tappable cards and reactions. On Android, ${helper} texts you as regular text messages, with links instead of cards.</p>`;
  const head = `<div class="cardhead"><img src="/av/${av}.png" alt=""><div><span>Text with ${helper}</span><small>From your own phone, like texting a friend</small></div></div>`;
  return shell(`Text with ${d.helper || "your helper"}`, `<section class="center card textsetup" data-texting data-api="${api}" data-back="${back}" data-state="${attrs(d.status || "new")}">
  ${head}
  <div data-step="phone"${d.status && d.status !== "new" && d.status !== "off" ? " hidden" : ""}>
    <h1>What's your cell number?</h1><p>${helper} will only ever text this number, and only this number can text ${helper}.</p>
    <form data-phone-form><label for="phone">Your cell number</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="(213) 555-0123" value="${attrs(fmtPhone(d.phone))}" autofocus>
    ${whoNote}<div class="notice error" role="alert" data-err hidden></div><button class="primary" type="submit">Confirm <span>→</span></button></form>
  </div>
  <div data-step="signup"${d.status === "signup" ? "" : " hidden"}>
    <p class="eyebrow">Step 2 of 3</p><h1>Create your free texting account</h1>
    <p>Texting runs through <b>Photon</b>, our texting partner. It's free and needs no card.</p>
    <ol class="steps"><li>Tap <b>Open Photon</b>. It opens in a new tab.</li><li>Sign up (or sign in), then tap <b>Approve</b>.</li><li>Come back to this tab. It moves on by itself.</li></ol>
    <a class="primary" data-photon-link href="${attrs(d.verify_url || "#")}" target="_blank" rel="noopener">Open Photon <span>↗</span></a>
    <div class="waitline"><i></i><span data-wait>Waiting for you to approve…</span></div>
    <p class="fieldnote">If Photon asks for a code, it's <b data-user-code>${h(d.user_code || "")}</b>.</p>
    <div class="notice error" role="alert" data-err2 hidden></div>
  </div>
  <div data-step="code"${d.status === "awaiting_code" ? "" : " hidden"}>
    <p class="eyebrow">Last step</p><h1>Send ${helper} one text</h1>
    <p class="bigsend">Text <b data-code>${h(d.code || "")}</b> to <b data-assigned>${h(fmtPhone(d.assigned))}</b></p>
    <a class="primary phoneonly" data-sms href="${d.assigned ? attrs(`sms:${d.assigned}&body=${d.code}`) : "#"}">Open Messages <span>→</span></a>
    <div class="waitline"><i></i><span>Waiting for your text…</span></div>
    <p class="fieldnote">Send it from <b data-from>${h(fmtPhone(d.phone))}</b>. Any other number or code is ignored.</p>
    <p class="fieldnote" data-svcnote${notIM ? "" : " hidden"}>This number isn't on iMessage (Android, most likely), so send it as a regular text. That works fine; ${helper}'s replies come as regular texts too, with links instead of tappable cards.</p>
    <p class="fieldnote" data-stuck hidden>Nothing yet? Check you sent exactly <b data-code2>${h(d.code || "")}</b>, from <b data-from2>${h(fmtPhone(d.phone))}</b>. A regular text (SMS) can take a minute or two to arrive. Still stuck? Get a new code and try once more.</p>
    <button class="quietlink" type="button" data-newcode>Get a new code</button>
  </div>
  <div data-step="manage"${d.status === "connected" ? "" : " hidden"}>
    <p class="eyebrow">Texting is on</p><h1>Text with ${helper}</h1>
    <dl class="txrows"><div><dt>Your phone</dt><dd data-mphone>${h(fmtPhone(d.phone))}</dd></div><div><dt>${helper}'s number</dt><dd data-massigned>${h(fmtPhone(d.assigned))}</dd></div><div data-msvcrow${svcLabel(d.service) ? "" : " hidden"}><dt>Texts as</dt><dd data-msvc>${h(svcLabel(d.service))}</dd></div></dl>
    <p class="fieldnote">Only your phone can text ${helper}, and ${helper} only texts you.</p>
    <a class="primary" href="${back}">Back to 1Helm <span>→</span></a>
    <button class="quietlink" type="button" data-off>Turn off texting</button>
  </div>
  <div data-step="done" hidden>
    <div class="mailicon">✓</div><h1>You're all set</h1><p>${helper} just texted you from <b data-assigned2>${h(fmtPhone(d.assigned))}</b>. Save the contact card it sent, so its texts never land in spam.</p>
    <a class="primary" href="${back}">${back === "/onboard" ? "Continue setup" : "Back to 1Helm"} <span>→</span></a>
  </div>
</section>${pageDialog("warm")}
<style>.textsetup{max-width:520px}.textsetup .cardhead{display:flex;gap:12px;align-items:center;margin-bottom:18px}.textsetup .cardhead img{width:44px;height:44px;border-radius:50%}
.textsetup .cardhead small{display:block;opacity:.7}.textsetup .steps{text-align:left;margin:14px 0 18px;padding-left:22px;line-height:1.7}.textsetup .bigsend{font-size:1.25rem;margin:16px 0}
.textsetup .bigsend b{font-size:1.5rem;letter-spacing:.04em;white-space:nowrap}.textsetup .phoneonly{display:none}@media (pointer:coarse){.textsetup .phoneonly{display:inline-flex}}
.textsetup form{text-align:left}.textsetup .txrows{margin:16px 0 8px;text-align:left}.textsetup .txrows div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.08)}.textsetup .txrows dt{opacity:.7}.textsetup .txrows dd{margin:0;font-weight:600;white-space:nowrap}.textsetup .quietlink{background:none;border:0;margin-top:14px;cursor:pointer;text-decoration:underline;opacity:.75;font:inherit}</style>
<script>(() => {
  const root = document.querySelector("[data-texting]"), api = root.dataset.api, $ = (s) => root.querySelector(s);
  const fmt = (e) => { const m = String(e || "").match(/^\\+1(\\d{3})(\\d{3})(\\d{4})$/); return m ? "(" + m[1] + ") " + m[2] + "-" + m[3] : String(e || ""); };
  // Android's Messages wants sms:<n>?body=…; iPhone uses &body=.
  const smsHref = (n, c) => "sms:" + n + (/Android/i.test(navigator.userAgent) ? "?" : "&") + "body=" + c;
  const SVC = { imessage: "iMessage", sms: "Text messages (SMS)", rcs: "Text messages (RCS)", not_imessage: "Text messages" };
  // Quick US-only check before the round trip (the server checks fully: valid US area code and number).
  const US_ONLY = ${JSON.stringify(US_ONLY_MSG)};
  const foreign = (v) => { const s = String(v || "").replace(/[\\s().\\-]/g, ""); return /^\\+(?!1)/.test(s) || /^(00|011)/.test(s) || (/^\\+?\\d+$/.test(s) && (s.replace("+", "").length > 11 || (s.replace("+", "").length === 11 && s.replace("+", "")[0] !== "1"))); };
  let codeSince = 0;
  const show = (k) => root.querySelectorAll("[data-step]").forEach((el) => el.hidden = el.dataset.step !== k);
  const post = (p, b) => fetch(api + p, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then((r) => r.json());
  let timer = 0;
  let prev = root.dataset.state;
  const apply = (s) => {
    if (s.status === "signup") { show("signup"); $("[data-photon-link]").href = s.verify_url; $("[data-user-code]").textContent = s.user_code || ""; }
    else if (s.status === "awaiting_code") {
      show("code"); if (prev !== "awaiting_code" || !codeSince) codeSince = Date.now();
      $("[data-code]").textContent = s.code; $("[data-code2]").textContent = s.code; $("[data-assigned]").textContent = fmt(s.assigned); $("[data-from]").textContent = fmt(s.phone); $("[data-from2]").textContent = fmt(s.phone); $("[data-sms]").href = smsHref(s.assigned, s.code);
      $("[data-svcnote]").hidden = !s.service || s.service === "imessage";
      $("[data-stuck]").hidden = Date.now() - codeSince < 120000;
    }
    else if (s.status === "connected") { const fresh = prev === "awaiting_code"; show(fresh ? "done" : "manage"); $("[data-assigned2]").textContent = fmt(s.assigned); $("[data-massigned]").textContent = fmt(s.assigned); $("[data-mphone]").textContent = fmt(s.phone); $("[data-msvc]").textContent = SVC[s.service] || ""; $("[data-msvcrow]").hidden = !SVC[s.service]; }
    else show("phone");
    if (s.error) { const e = s.status === "signup" ? $("[data-err2]") : $("[data-err]"); e.textContent = s.error; e.hidden = false; }
    prev = s.status;
  };
  const tick = async () => {
    clearTimeout(timer);
    const st = root.dataset.state;
    if (st !== "signup" && st !== "awaiting_code") return;
    try { const s = await post("/texting/poll"); root.dataset.state = s.status; apply(s); } catch {}
    timer = setTimeout(tick, root.dataset.state === "signup" ? 4000 : 2500);
  };
  $("[data-phone-form]").addEventListener("submit", async (e) => {
    e.preventDefault(); const b = e.target.querySelector("button"); $("[data-err]").hidden = true;
    if (foreign($("#phone").value)) { $("[data-err]").textContent = US_ONLY; $("[data-err]").hidden = false; return; }
    b.disabled = true;
    try { const s = await post("/texting/start", { phone: $("#phone").value }); if (s.error && !s.status) { $("[data-err]").textContent = s.error; $("[data-err]").hidden = false; } else { root.dataset.state = s.status; apply(s); tick(); } }
    finally { b.disabled = false; }
  });
  $("[data-newcode]").addEventListener("click", async () => { const s = await post("/texting/newcode"); codeSince = Date.now(); root.dataset.state = s.status; apply(s); });
  root.querySelectorAll("[data-off]").forEach((b) => b.addEventListener("click", async () => { if (!(await ask({ title: "Turn off texting?", body: "You can set it up again anytime.", confirm: "Turn off", danger: true }))) return; const s = await post("/texting/off"); root.dataset.state = s.status; apply(s); }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  tick();
})();</script>`, { narrow: true, script: false });
}

// ---- Sign in at your own address (<slug>.1helm.com). Same look as the approved onboarding: ink on warm paper,
// Instrument Sans/Serif, one card. Never the sign-up flow: this address already belongs to someone.
export function hostSignInPage(d = {}) {
  const host = h(d.host || ""), helper = h(d.helper || "your helper"), av = Number(d.avatar || 8);
  const body = d.sent
    ? `<h1>Check your email</h1><p class="sub">If <b>${h(d.email || "that address")}</b> owns this 1Helm, a sign-in code and link are on their way. Enter the code here, or tap the link in the email. Both work once and expire in 15 minutes. Check spam if it isn't there in a minute.</p>
       ${d.testLink ? `<a class="btn" href="${attrs(d.testLink)}">Open the link <em>Test address</em></a><p class="fine">Test code: <b id="testcode">${h(d.testCode || "")}</b></p>` : ""}
       ${codeEntry({ email: d.email, wait: d.wait, codeError: d.codeError, codeKind: d.codeKind })}`
    : `<h1>Welcome back</h1><p class="sub">Sign in to <b>${host}</b>. We'll email you a code and a link, no password needed.</p>
       ${d.error ? `<p class="err" role="alert">${h(d.error)}</p>` : ""}
       <form method="post" action="/auth/start" data-age><label for="em">Email</label><input id="em" name="email" type="email" inputmode="email" autocomplete="email" required autofocus placeholder="you@example.com" value="${attrs(d.email || "")}">${AGE_BOX}
       <button class="btn" type="submit">Email me a sign-in code</button></form>${AGE_SCRIPT}
       <p class="fine">Not yours? <a href="https://${attrs(d.appHost || d.host)}/">Start your own 1Helm</a></p>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Sign in · ${host}</title><meta name="robots" content="noindex"><meta name="theme-color" content="#f3f2ef"><link rel="icon" type="image/png" href="/1helm-icon-64.png"><link rel="apple-touch-icon" href="/1helm-icon-180.png">
<style>@font-face{font-family:"Instrument Sans";src:url("/fonts/instrument-sans.woff2") format("woff2");font-weight:400 700;font-display:swap}
@font-face{font-family:"Instrument Serif";src:url("/fonts/instrument-serif.woff2") format("woff2");font-weight:400;font-display:swap}
:root{--ink:#1c1b19;--mute:#77746c;--faint:#a8a49b;--line:#e7e4dd;--line2:#d8d5ce;--paper:#f3f2ef;--sheet:#fff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper);color:var(--ink);font:16px/1.55 "Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{width:100%;max-width:420px;background:var(--sheet);border-radius:24px;padding:36px 32px 30px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 40px rgba(0,0,0,.06)}
.who{display:flex;align-items:center;gap:12px;margin:0 0 26px}.who img{width:44px;height:44px;border-radius:50%;background:var(--paper)}.who b{display:block;font-weight:600}.who span{font-size:13.5px;color:var(--mute)}
h1{margin:0 0 8px;font:400 34px/1.15 "Instrument Serif",Georgia,serif;letter-spacing:-.01em}.sub{margin:0 0 24px;color:var(--mute)}.sub b{color:var(--ink);font-weight:600}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}input{width:100%;height:50px;padding:0 16px;border-radius:14px;border:1px solid var(--line2);background:var(--sheet);font:inherit;font-size:16px;color:var(--ink);outline:0}
input:focus{border-color:var(--ink);box-shadow:0 0 0 3px rgba(28,27,25,.08)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:50px;margin:14px 0 0;border:0;border-radius:999px;background:var(--ink);color:#fff;font:600 15px/1 inherit;cursor:pointer;text-decoration:none}.btn:hover{opacity:.92}
.btn em{font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.18)}
.quiet{display:block;text-align:center;margin:18px 0 0;color:var(--mute);font-size:14px}.fine{margin:22px 0 0;text-align:center;font-size:13px;color:var(--faint)}
a{color:var(--mute);text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:2px}a:hover{color:var(--ink);text-decoration-color:currentColor}
.err{margin:0 0 14px;color:#b91c1c;font-size:14px}</style></head>
<body><main><div class="who"><img src="/av/${av}.png" alt=""><div><b>${helper}</b><span>${host}</span></div></div>${body}</main></body></html>`,
    { status: d.status || 200, headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
