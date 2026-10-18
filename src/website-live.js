// Putting a website or landing page live on a person's own domain: 1Helm itself puts the business-setup skill in front of the model
// (the model's own choice to call read_skill proved unreliable; a Live helper skipped it and spent hours on GitHub and API-key toolkits).
// - wantsWebsiteLive(text): a plain text test for that request. A named vendor ("on Vercel", "with Squarespace") is not matched,
//   because business-setup only applies when the hosting choice is left to us.
// - websiteLiveNote(): the short note added to the main turn's message beside the integration hint (resident.js; never saved).
// - the guide for a matching helper job is the whole business-setup skill (read_skill text), passed into helperJobText by resident.js
//   (helpers.js is imported early by resident.js and must not import the skills loader).

const SITE = /\b(?:web ?sites?|landing ?pages?|web ?pages?|home ?pages?|(?:my|our|the|a|an) (?:new )?site|online store|portfolio site)\b/i;
const LIVE = /\b(?:live|go live|goes live|going live|launch(?:ed|ing)?|host(?:ed|ing)?|deploy(?:ed|ing)?|put (?:it |this |that )?online|up and running)\b/i;
const DOMAIN_NAME = /\b[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|co|ai|app|dev|me|us|xyz|info|biz|shop|site|online|store|tech|blog)\b/i;
const DOMAIN_WORD = /\bdomains?\b/i;
const HOSTING = /\b(?:hosting|dns|nameservers?|point(?:ing)? (?:it|the domain|my domain)|connect(?:ing)? (?:it|the domain|my domain))\b/i;
const VENDOR = /\b(?:vercel|netlify|github pages|godaddy|squarespace|wix|wordpress|shopify|webflow|heroku|firebase|render\.com|aws|amplify|bluehost|hostinger|namecheap|google sites|carrd|framer)\b/i;

export function wantsWebsiteLive(text) {
  const t = String(text || "").slice(0, 4000); if (!t.trim() || VENDOR.test(t)) return false;
  const domain = DOMAIN_WORD.test(t) || DOMAIN_NAME.test(t);
  if (SITE.test(t) && (LIVE.test(t) || domain)) return true;
  return domain && HOSTING.test(t);
}

export const websiteLiveNote = () => "(This request is about putting a website live on a domain. Your first tool call must be read_skill with slug business-setup, before any app, browser, GitHub or purchase step, and follow it. Cloudflare is done only through the Cloudflare MCP app (app id cloudflare_mcp, app_run CLOUDFLARE_MCP_SEARCH and CLOUDFLARE_MCP_EXECUTE), and never ask for a Cloudflare API token, Global API Key or wrangler login. If you start a helper for it, say in the job that it is about putting a website live on a domain.)";

