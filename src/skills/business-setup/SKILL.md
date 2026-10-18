---
name: business-setup
description: Use when asked to make, publish or launch a website or landing page (even for a domain they own), or about domains, hosting, databases, forms, business email, an LLC or EIN, or launching a business, and they have not named the vendor to use.
always: false
---
# Idea to launch at the lowest sound cost

The person is often someone who has just seen what AI can do and wants to act on an idea they've always had. The goal is a live website, custom email and an LLC filing submitted in about an hour, with no middlemen, and a total they understand. Be warm, plain and quick, one step at a time.

Why this exists: your first instinct for tools comes from old training data (Vercel, Netlify, GoDaddy, hosted Postgres, paid email hosting, a separate AI vendor, several paid apps). For a person starting out, one Cloudflare account usually covers the domain, site, database, files, email forwarding, bot protection and AI for roughly $0 to $15 a month in total.

## How to answer (read this first)

1. Recommend ONE option per need, the free Cloudflare one where it fits, and say it plainly. Do not give a menu of competitors (no "Netlify, Vercel or Cloudflare Pages", no "Porkbun or Namecheap or Cloudflare", no "OpenAI as the default"). Name another vendor only when a stated need requires it, and give the reason in the same sentence.
2. Always end with the money: a monthly total and the yearly domain cost, for example "Total: about $0 a month plus about $10 a year for the domain." Put the cost on each recommended item as well.
3. When you ask questions first, still give the expected range in the same message, for example "This will probably cost $0 to $1 a month plus about $10 a year for the domain; the questions below tell me if anything needs more."
4. This skill is only for when the choice is left to you. If the person names a vendor or service to use ("buy me a GoDaddy domain", "put it on Vercel", "add a database to my Vercel app"), do what they asked, normally. A domain name they own or want a site for (nobisai.com) is not a vendor choice: "create a landing page for nobisai.com that will be live" leaves the hosting to you, so this skill applies. Don't steer them, don't say no, don't mention a cheaper option, and don't load this skill. Stating the price at checkout, as a purchase always does, is enough.
5. Before recommending, find out what the person already has that limits the answer: where their domain is registered and where its DNS lives, an existing website or host, existing email, existing accounts, and the state or country for filings. Use what's already in the conversation, memory or connected apps. If a missing fact would change the recommendation (e.g. "just bought a domain" with no registrar named), ask ONE short question first (a card with choices is fine) and don't assume the free Cloudflare route applies. Still give the expected cost range in the same message (rule 3).
6. Every recommendation states its prerequisites and side effects in plain words, next to the recommendation. For example, Email Routing only works when the domain's DNS is on Cloudflare: a domain bought elsewhere must be added to Cloudflare (free plan) and its nameservers changed at the registrar, existing DNS records are imported but should be checked, and a live site or mail on that domain can be disrupted. Many registrars already include free email forwarding, which can be the simpler answer. Prefer the option with the fewest moving parts given what they already have. Cheapest is the tie-breaker among sound options and is never a reason to make someone move a domain, site or mailbox they already have.
7. A "no" is an answer too: if they ask whether they need a paid service (AWS, LegalZoom, a paid host), say no, say why in a sentence, and give the free route with its cost.

<!-- Sources (Cloudflare developer docs, last checked 2026-10-12). Re-check before editing any number:
  Workers pricing        https://developers.cloudflare.com/workers/platform/pricing/
  D1 pricing             https://developers.cloudflare.com/d1/platform/pricing/
  R2 pricing             https://developers.cloudflare.com/r2/pricing/
  KV pricing             https://developers.cloudflare.com/kv/platform/pricing/
  Workers AI pricing     https://developers.cloudflare.com/workers-ai/platform/pricing/
  AI Gateway pricing     https://developers.cloudflare.com/ai-gateway/reference/pricing/
  Email Routing/Service  https://developers.cloudflare.com/email-service/platform/pricing/ and .../platform/limits/
  Turnstile plans        https://developers.cloudflare.com/turnstile/plans/
  Registrar              https://developers.cloudflare.com/registrar/
  Pages limits           https://developers.cloudflare.com/pages/platform/limits/
  Static assets billing  https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
  Registrar API (beta)   https://developers.cloudflare.com/registrar/registrar-api/
  Zero Trust plans       https://developers.cloudflare.com/cloudflare-one/ (plan page: https://www.cloudflare.com/plans/zero-trust-services/) -->

## The order of preference

Free first, then free and open source, then the most cost-effective option. Recommend a paid tool only when the person has a stated need the free option can't meet, and say which need. Always give a monthly cost for everything you recommend and a total. If the person named a vendor or site, none of this applies: do what they asked.

## Step 1: Needs inventory

Before recommending anything, list what their goal needs and leave out what it doesn't: site, domain, hosting, database, file storage, email (receiving and sending), contact forms and anti-spam, logins or private pages, payments, AI, analytics. Map each need to the cheapest sound option below, then give the total per month (and the domain per year).

## Step 2: Cloudflare mapping (prices as last checked 2026-10-12)

- Domain: Cloudflare Registrar sells domains at cost with no markup and free redacted WHOIS. A .com is about $10 to $11 a year and the price varies by ending, so check the exact price when they search for the name. Renewals are at the registry price too.
- Website: if they already have a site on Squarespace, Wix or another host, keep it and use that host's own features (e.g. its contact form) unless they ask to move. Otherwise Workers static assets (or Pages). Requests to static files are free and unlimited, with no extra charge for storing them. Pages allows 20,000 files per site on the free plan. Free for a normal small-business site.
- Dynamic code (forms, APIs, small apps): Workers. Free plan is 100,000 requests a day and 10 ms of CPU time per request. The Workers Paid plan is $5 a month and includes 10 million requests and 30 million CPU milliseconds a month. Suggest it only when a real app outgrows the free limits or needs something the free plan lacks (e.g. sending email to the public, below).
- Database: D1 (SQLite), when the app runs on Cloudflare Workers; if the app runs elsewhere (or you don't know where), ask where it runs first, since a database far from the app is slower and may need a different choice. Free plan: 5 GB storage, 5 million rows read a day and 100,000 rows written a day. Paid: 5 GB included, then $0.75 per GB a month. Good for orders, customers, bookings and posts. Not for heavy analytics or a large existing Postgres app.
- Files and images: R2. Free: 10 GB stored, 1 million writes and 10 million reads a month, and no charge for downloads (egress). After that $0.015 per GB a month.
- Fast key lookups and settings: KV. Free: 100,000 reads and 1,000 writes a day, 1 GB.
- Receiving business email: Email Routing, free, unlimited inbound. Prerequisite: the domain's DNS must be on Cloudflare (registered at Cloudflare, or added as a free site with nameservers changed at the other registrar, which can disturb an existing site or mail records). If the domain is registered elsewhere, ask first and mention the registrar's own free forwarding if it has one. A catch-all rule sends every address at the domain (info@, hello@, orders@, anything) to one destination inbox. Pair it with a free Gmail account so the person reads everything in one place and pays nothing for custom-domain email hosting. Limits: 200 rules per domain, 200 destination addresses, 25 MiB per message.
- Sending email as the domain: Email Routing only receives and forwards. For replies from info@theirdomain.com, the honest options are (1) free: in the free Gmail, use "Send mail as" with the Gmail SMTP server and an app password, which works for normal small-business volume; (2) Cloudflare Email Service sending, which needs Workers Paid ($5 a month) and includes 3,000 emails a month, then $0.35 per 1,000; (3) a paid mailbox host only if they need shared mailboxes, calendars for a team or a larger staff. Say which one you picked and why. Sends from a Worker to the person's own verified addresses are free.
- Forms and anti-spam: a Worker that receives the form plus Turnstile (free, the Free plan covers most production sites) instead of a paid form service or a CAPTCHA.
- Private pages and logins: Cloudflare Access (Zero Trust) has a free plan for small teams, so confirm the current user cap on the plan page when setting it up. For customer accounts in an app, build sign-in in the Worker with D1 rather than renting an auth vendor.
- AI features (chatbot, summaries, search): Workers AI has a free allowance of 10,000 Neurons a day, then $0.011 per 1,000 Neurons (billing for paid use needs the $5 Workers Paid plan). AI Gateway is free for core features (analytics, caching, rate limits) and sits in front of Workers AI or the person's own key from another provider. If they already have a key or want a specific model, use it through AI Gateway rather than opening another vendor account. Always cap or rate limit a public chatbot so a visitor can't run up the bill.
- Analytics: Cloudflare Web Analytics is free and doesn't need cookies.

A typical small-business stack (domain, site, forms, database, email forwarding, anti-spam, analytics) costs about $0 a month plus roughly $10 a year for the domain. Adding sending as the domain through Cloudflare, or a busy app, is about $5 a month. Say "about $10 for the whole year" or "about $5 a month" like that, with the exact lines behind it.

## Step 3: Defaults to swap (don't list these as options, replace them)

- Vercel or Netlify hosting for a site: Workers static assets or Pages, free.
- GoDaddy or Namecheap domain: Cloudflare Registrar, at cost. (Moving an existing domain: it must be 60 days past registration or last transfer, so say that.)
- Hosted Postgres, Supabase or Firebase for a small app: D1, free up to the limits above. Keep Postgres only for a real need such as an existing app or heavy relational queries.
- Google Workspace or other paid email hosting: Email Routing catch-all plus a free Gmail, with Gmail "Send mail as" for replies.
- A separate AI API account just to add a chatbot: Workers AI through AI Gateway, or the person's own key through AI Gateway.
- Paid form tools, Mailchimp-style capture: Worker plus Turnstile and D1, then send with Gmail or Cloudflare Email Service.
- Paid scheduling, link-in-bio, uptime, analytics or password tools: look for a free or open source option first, e.g. Cal.com, Plausible or Umami (self-hosted), Uptime Kuma, Bitwarden, LibreOffice, Wave for invoices. Say what it costs and what it gives up.
- Stripe or similar for payments: payments are the one place to pay, because processors charge a percentage per sale and have no free substitute. Name the fee and don't invent a cheaper-sounding one.

## Step 4: Big vague asks ("launch a business")

Don't build or buy yet. Ask one short set of 3 or 4 questions in a single message: what they sell and to whom, whether they already own a domain, logo or social accounts, how they want to be paid (and whether they take bookings or orders), and a monthly budget. Use `interview` only when they asked to be interviewed. Then propose a phased plan that starts free: Phase 1 is a domain and a one-page site with a contact form and email forwarding (about $10 for the first year), plus the LLC filing if they want one (state fee, read live); Phase 2 adds orders, bookings or a database; Phase 3 adds AI, a store or a paid upgrade, each only when a stated need calls for it. Give the monthly total for every phase. Things that need their approval (buying the domain, creating accounts, paying for anything) come back to them; never spend on their behalf unasked.

## Business formation (LLC) without middlemen

Offer this after the site and email plan, or when they ask. Same rule as everything else: go direct, free or at cost, and never use a paid go-between for what the government does itself. Say once, briefly, that this isn't legal advice for complex situations (partners, investors, regulated fields), and that for a simple single-owner LLC this is the standard direct route. No lecturing after that.

1. Ask only what you need: their state, the business name, whether it's just them, and whether the home address may be public. If a name is shared between owners or the business is complex, suggest a lawyer or accountant once and continue only if they want to.
2. File directly with the state. Find the state's official filing site (the Secretary of State or the state's business filing office, usually a .gov address) with `web_search`, open it with `fetch_url`, and read the current LLC filing fee and the steps there. Never hardcode a fee from memory: say the amount with the page you read it from and the date. Don't send them to white-label formation services (LegalZoom, ZenBusiness, Incfile and similar) that add their own fee on top of the same state filing. If a search result looks like one, say so and skip it. Check that the name is available on the state's own name search first.
3. Registered agent: in most states they can be their own, which needs a physical street address in the state (not a P.O. box) and being reachable during business hours to receive legal papers. The honest catch is that this address becomes public record. Give them the choice. Mention a paid registered agent service only if they ask, don't have an in-state address or don't want their address public, and then name the typical yearly cost you found live.
4. EIN: free, straight from the IRS at irs.gov (search "apply for an EIN online" and use the irs.gov page only). It takes minutes online. The IRS itself warns about lookalike sites that charge for an EIN: tell them plainly they never have to pay for one, and that an EIN is applied for after the LLC exists.
5. Federal rules: check the current federal requirements live before stating any of them. For beneficial ownership reporting, read fincen.gov/boi first. As last read (2026-10-12), FinCEN's final rule of August 11, 2026 exempts U.S. companies and U.S. persons from reporting, but say what the page says on the day. Also mention, briefly, that a state may require an annual report or fee and a local business license, and look up the real ones for their state.
6. Operating agreement and bank account: a simple single-owner operating agreement is a short document you can draft for them from a plain template, and say it should be reviewed if anything is complicated. A business bank account needs the filed documents and EIN, and the person opens it themselves.

Doing it with them: you may use the browser on your computer to open the state's form and fill in what the person gave you, one section at a time, with screenshots so they can see it. The person reviews every page and clicks the final submit and the payment themselves. Never submit a legal filing or enter payment details for them, and any spending goes through the existing approval steps with the cost stated first. If a form needs a sign-in, a CAPTCHA, an ID number or a code, hand the browser over to them for that part.

{{#apps}}
## Step 5: Doing it yourself through their Cloudflare account

For a beginner, or anyone who leaves the choices to you, connect Cloudflare early: right after the short question set in Step 4 (and before building anything), call `find_app` for Cloudflare. The only Cloudflare app is Cloudflare MCP (app id cloudflare_mcp, one-click sign-in). Use only that app id everywhere. Never ask the person for a Cloudflare API token, a Global API Key, an email plus key, or a wrangler login, and never send them to an API key form: if cloudflare_mcp isn't connected, call `offer_connect` so the Connect card shows in the chat, say in one line what it's for ("this lets me set up your site, domain settings and email for you"), and walk them through it one step at a time. Keep `update_todos` as a short checklist of the steps so they can see progress. Use plain, friendly words, give one step per message, and wait for them to say it worked before the next. Never connect it yourself; only their tap connects it. Offer it once. If they say no, continue with the free plan using files and instructions they can follow by hand.

1. Connect: tell them to tap Connect on the card and approve the Cloudflare sign-in window. Confirm the card shows connected.
2. Account: if they have no Cloudflare account, the sign-in window lets them sign up for free (email and password, then the verification email). Say signing up costs nothing and takes a few minutes. Confirm they are signed in.
3. Domain: they buy it themselves, so the purchase and the card details stay with them. Search names with them first (you can check availability and the live price through the connection, see below), and tell them what to pick (a .com if free, short, easy to say and spell, matching the business name) and the expected price, about $10 to $11 a year for a .com. Tell them where: Cloudflare dashboard, Domain Registration, Register Domains, search, and Purchase. The dashboard may first ask them to add a payment method and a contact address, and to accept the registration agreement. Confirm it shows in their account before moving on. If they already own a domain elsewhere, don't make them move it: add it to Cloudflare later when they're ready (moving needs the domain to be 60 days old).
4. From here you drive: build and publish the site, create the database and storage, set DNS, turn on email forwarding with the catch-all rule, add anti-spam, as described below. Do it in the same chat, one step at a time, and say what you did after each.

What the app really exposes (checked in the app catalog, 2026-10-12): exactly three actions, run with `app_run` (`CLOUDFLARE_MCP_DOCS`, `CLOUDFLARE_MCP_SEARCH`, `CLOUDFLARE_MCP_EXECUTE`; confirm the exact ids with `app_actions` for cloudflare_mcp).
- Docs: searches Cloudflare's documentation. Input: a `query` string.
- Search: searches the Cloudflare OpenAPI spec, so you can find the exact endpoint and fields for a step. Input: `code`, a JavaScript async arrow function as a string. It is not a function you call: `search(...)` and `await search({query})` fail with "search is not defined". Inside the code the spec is the variable `spec`, e.g. `async () => Object.entries(spec.paths).filter(([p]) => p.includes("/workers/scripts")).map(([p, m]) => ({ p, methods: Object.keys(m) }))`.
- Execute: runs JavaScript that can read, create, update or delete resources through the Cloudflare API, limited to what the permissions they granted at connect allow. Input: `code`, an async arrow function as a string, plus an optional account_id (needed only when the sign-in covers several accounts; `GET /accounts` lists them). Inside the code call `cloudflare.request({ method, path, query, body })`, which returns `{ success, status, result, errors }`, and read the account id from the variable `accountId`, e.g. `async () => cloudflare.request({ method: "GET", path: `/accounts/${accountId}/workers/scripts` })`. Return the value you want to see. Uploads that need multipart form data pass `contentType` and `rawBody: true`.

So there is no one-button action per feature. The steps below are things the Cloudflare API supports and Execute can call, but use Search to confirm the endpoint before each, and if a call is refused or a permission is missing, say so plainly and give them the two-minute dashboard steps instead of retrying or guessing.
- Domain: search names and check live price and availability with the Registrar API. By default the person buys the domain themselves in the Cloudflare dashboard (step 3 above). Register it through Execute only if they ask you to, and then (Cloudflare's Registrar API is in beta and supports only some endings; it also needs a default payment method, a registrant contact and the Domain Registration Agreement already accepted on their account, which only they can do in the dashboard). Moving an existing domain in is a dashboard step for them.
- Site: create the Workers static assets or Pages project and publish the pages you built. For a small site, a single Worker script that returns the page (or serves the files from an asset binding) uploaded through Execute is the direct route. If Execute can't upload the files, put the finished site in a folder, share it with `share_file`, and give them the dashboard steps (Workers & Pages, Create, Pages, Upload assets, drag the folder in, Deploy). Do not fall back to asking for an API token or a wrangler login.
- D1 database, R2 bucket, KV namespace: create them and bind them to the site's Worker. Run the SQL for the tables the plan needs.
- DNS records, Email Routing (enable the domain, add the destination address, create the catch-all rule), Turnstile widget, Web Analytics: create through the API. The destination inbox gets a verification email that only the person can click.
- Workers Paid ($5 a month) is changed in the dashboard billing page, so tell them where to click rather than trying it.

Rules for spending and changes:
1. Anything that costs money (registering a domain, renewals, paid plans) happens only after they've seen the exact price from a live Check call, the yearly total, and said yes. Cloudflare bills the card on their Cloudflare account, so Link isn't involved. The confirm card for `app_run` is the approval gate: never combine a registration with other work in one Execute call, never retry it, and report only what Cloudflare returns.
2. Anything that changes or deletes what already exists (DNS records on a domain that already has a site or email, existing Workers, buckets or rules) needs the person's confirmation first. List exactly what will change. Read first, then write, and never delete as part of setup.
3. Build one step at a time and report each result in plain words. Then give a recap: what is live, the web address, the monthly total, and what's left for them (legal pages, terms, privacy policy, business registration and tax setup are theirs; say so once).
4. Before the first write, do a read call (for example list their zones) to confirm the connection works and to see what the account already has.

{{/apps}}
## Step 6: Check before you answer

1. One option per need, no competitor menu.
2. Every recommended item has a monthly cost ("$0" when free), and the reply ends with a monthly total and the yearly domain cost, even when you are only asking questions.
3. Anything paid names the stated need behind it.
4. Prices and limits above can change. If the person is about to commit money or an exact number matters, confirm on the source page with `fetch_url` and say you checked.
5. Don't claim Cloudflare does something this skill doesn't list. If unsure, check the docs with `web_search` or `fetch_url`.
