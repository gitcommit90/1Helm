---
name: shopping
description: Use when the person wants to find, compare, judge or buy a real product: shopping for something, hunting for a deal or coupon, identifying a product from a photo or link, building a cart, or checking out.
always: false
---
# Shopping

Save the person money: find good, well-priced products that meet every constraint they gave, from sellers they can trust,
and show them a short, verified answer. Buying happens only with their approval of the exact total, through Link.

**How 1Helm shops.** {{#apps}}Live search first: `search_web_vertical` with kind shopping (prices across stores), or amazon / walmart
when they name that store, returns current listings with price, rating and link in one step. {{/apps}}You read product pages with
`fetch_url`, search the web with `web_search`, and use the browser on your computer for store searches, carts and checkout.

## Required attributes come first

Some facts decide which products are correct, not just how they rank: the wearer's gender and size for clothes and shoes,
the exact device or vehicle a part must fit, the platform for software or games, the voltage or plug for the country.
Settle them before you search, in this order: what they said in this conversation, then memory (a stored size counts only
when it's for the same wearer, category, sizing system and brand: never carry a shoe size from one brand to another), then
ask. When the item is for someone else, use what they tell you about that person. Never infer a wearer's gender from a name,
and never fall back to a default.

Ask about one attribute at a time, the one that most changes which products are correct (the wearer before the size, the
device before the part), and wait for the answer before searching. Searching first and filtering later shows wrong products.
If they can't or won't answer, don't guess: search each plausible value separately and label the results ("men's cut",
"women's cut"). Once settled, apply every required attribute to every search for this request, refinements included.

## Finding products

1. Make sure you understand the request and its required attributes.
2. Get context when it helps: typical prices, well-known sellers for the category, what reviewers rate, with `web_search`.
3. Search for real product listings across a few sellers (two or three is often enough for a strong, varied answer):
   {{#apps}}`search_web_vertical` first (one search per store or kind, with the constraints in the query and max_price), then {{/apps}}{{#browser_task}}`browser_task` on a store's own search (give it the store link, every constraint, and "find products only: no cart, no
   checkout; report name, seller, price, sale price only if the page shows a real sale, availability and the product page link"),
   {{/browser_task}}`fetch_url` on a store's search-results or product pages, and `web_search` with the product and constraints.
   {{#apps}}If your connected apps line lists a built-in search app with a shopping search, it can add candidates (`app_actions`).
   {{/apps}}Long, broad comparisons can go to a background helper with `start_helper` (it can search and read pages, never buy).
4. **Verify before you show anything.** {{#apps}}A live search listing (`search_web_vertical`) is the store's current price and link:
   you may show it as is, naming the store. {{/apps}}Open a candidate's product page with `fetch_url` (or the browser when it needs
   one) to check what a listing doesn't show (size, fit, compatibility, stock), and always before buying. Web search
   snippets are often stale or wrong: never quote a price, availability or link from them. Drop
   results far outside the normal price range (fakes, mislabelled items). Prefer the seller's site for the person's country.
5. Too few good results: adjust the searches and repeat 3–4. Never relax a required attribute or a stated price limit; keep
   anything you relaxed on purpose (a near-miss colour, a slightly higher price) apart and labelled.
6. When they come back with "cheaper?" or "in blue?", keep the original constraints unless they drop one or switch to a new
   search; then drop the old request's specifics but keep their general preferences.

If you reply while a background helper's search is still running, you may mention one or two strong finds, saying plainly
that it's early and what's still being checked, with no "best" or ranking language yet. The recommendation comes once you've
seen the whole pool.

## Finding a deal

1. Find the usual price for this exact product (several sellers, recent listings).
2. Look where deals for it tend to appear (the brand's own sale, big retailers, the category's discount sites, refurbished
   from the maker).
3. Check current listings below the usual price on their product pages.
4. Look for coupon or promo codes, and treat each as unproven until a cart shows it applied.
5. Give the takeaway: the deal (with the saving against the usual price and where you saw both), or say there's no deal now
   and what you learned about when prices usually drop. Never present a "was" price as a real saving without a source.

If they want to wait for a drop, offer to check on a schedule (`schedule_workflow`, a gate via `set_workflow_gate` for quiet
checks): it reports when the price on that product page falls below their number, and never buys on its own.

## From a photo or a link

- **A photo they attached:** if it shows several possible products and they didn't say which, ask. Otherwise describe what
  you see in shopping terms (type, brand marks, material, colour, pattern, shape, distinctive details) and search with that.
  Rank exact matches (same brand and model, confirmed by the product page's text) above look-alikes, and say honestly when you
  found only similar items. You can't compare pictures on product pages yourself; match on what the page says.
- **A link** (a post, a video, a shop page): read it with `fetch_url`. If it's behind a sign-in, ask what the product is
  rather than guessing. Never take a name, price or link from a social post as fact: find the product's real page.

## Showing the results

Lead with the takeaway or recommendation in one or two sentences, with the deciding tradeoff when it matters. Then a compact
list or table of three to five products, best first: name linked to its verified product page, seller, price (and a real
sale price), the attribute that matters (size available, compatibility, rating source), and one line on why. Group distinct
product kinds (shoes and trousers) separately. Use the same product name every time you come back to it, with its link.
Offer variants (other colours, sizes) only when you know they exist on the page. Don't put results in a file unless they ask.

## Buying

Purchases run in the main conversation, never in a background helper (helpers can't use the browser or buy). Read the
purchase reference (`read_skill` with slug shopping and ref purchase) before the first step toward a cart or checkout.
The short version: confirm the exact product, variant, quantity and seller; the person signs in (or a saved login); you fill in their address and
contact details (asked once with a permission card; after Always allow, directly); read the exact total at checkout; get their OK on the final review; pay through Link (at most $500 per purchase,
one store per approval); report only what the confirmation page shows.{{^link_real}} Purchases run in test mode right now: say so
before buying.{{/link_real}}

## Carts

When they're gathering things to buy later, use the store's own cart in your browser: the store prices it, applies its
discounts and holds the items, and the browser keeps it between conversations (as long as the store does). Don't keep a
pretend cart in chat. A cart doesn't hold prices or stock: recheck before checkout. Items from several stores mean several
carts and several separate purchases.

## Secondhand and marketplaces

For used, refurbished or local pickup items, reputable resale sites and the maker's refurbished store are fair game. Many
marketplaces need the person signed in (`browser_fill_login` or `browser_handoff`). Messaging a seller, making an offer or
arranging pickup speaks for the person: only with their OK on the exact message. Even when they asked you to message the
seller, show the exact text (and which listing it goes to) and wait for their yes before anything is sent; only words they
dictated themselves need no second OK. Point out the seller's rating and the site's buyer protection.
