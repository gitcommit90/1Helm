# Checkout in the browser

Every booking that reaches a final step runs here: on the provider's own site, in the browser on your computer, with the
person's OK on the exact terms and, for money, Link.

## Before checkout

Ask once whether they have an account on that site and want to use it: signing in can bring member prices, loyalty
benefits, credits and saved details. A saved login: open the sign-in page and `browser_fill_login`. No saved login:
`browser_handoff` so they sign in themselves. No account: continue as a guest where the site allows. Never create an
account for them without asking. Don't ask when the browser is already signed in to that site.

## One checkout, kept alive

Use one browser session for the chosen option and keep it through review, changes, approval, payment and confirmation. Don't
start a competing checkout on the same site or start over after they approve: the cart, holds and sign-in live in that
session. The browser keeps its cookies between conversations, so a cart usually survives a pause, but prices and holds may
not: recheck before paying.

{{#browser_task}}`browser_task` is good for getting to the final review page (give it the exact link, every choice, and "stop before
anything that books, charges, transfers points or creates a penalty; report the full final terms"). Check where it stopped with
`browser_snapshot`, then do the final steps yourself with `browser_act`.
{{/browser_task}}{{^browser_task}}Drive it with `browser_navigate`, `browser_snapshot` and `browser_act`.
{{/browser_task}}
## Their details

Names, phone, email, address and dates of birth: fill them in yourself (`fills_personal: true`), from what they told you
or their account and Notebook. Never invent one; ask in one short line for one you don't have. On the Standard permission level fill them in directly. If they chose Careful or Locked down, 1Helm asks
them with a permission card ("OK to fill in your name, phone and email on <site>?"); you don't ask in your own words. If they don't allow it, hand that form to them with `browser_handoff`.

Passport, traveller and loyalty numbers: the person enters them. Call `browser_handoff` at that form with exactly which
fields to fill, end your turn, and continue when they hand back. Never ask for those in chat, and if they paste one anyway,
don't repeat it, don't save it, and don't type it in for them: ask them to enter it themselves in the browser. If the
handoff can't reach them, stop with the option prepared and say what's left. Payment still goes only through Link with the
exact total confirmed (below).

## Final review and approval

At the last page before committing, read the exact terms from the page: item, date and time, travellers or party, seats,
room, rate or variant, itemized charges, the full total, anything due later, credits or points used, and the cancellation,
refund and no-show terms. Show them in the final review (presentation reference) and get their OK on exactly those terms.
Anything material changes after that: stop and ask again.

- **No payment** (a free table, a pay-at-property rate with no card): after their OK, press the final button yourself.
- **Payment now:** follow the Link steps in payments-and-purchases (`read_doc` if you haven't this conversation):
  1. `buy_with_link` with the exact total in cents, the store's checkout link, and a clear description (what, from where,
     for whom, the full total, and that they asked for it). End your turn and tell them to approve it in Link.
  2. When they say they approved, `check_purchase`. Denied or expired means no: don't retry another way.
  3. `browser_fill_card` into the payment fields, `browser_snapshot`, check the total still matches what they approved,
     then press Pay.
  Link covers one purchase, one store, one amount, at most $500. Over that, or a site that won't take the Link card, or a
  card needed only as a guarantee or for a later charge: tell them, and hand the payment step to them with
  `browser_handoff` so they pay with their own card. Never split one order into smaller ones to fit the limit.
- Never type a card number, and never ask for card details in chat.

## Verify, and protect against doubles

A booking is done only when the page shows a confirmation number, tickets, a reservation record or an unmistakable booked
state. If the result is unclear:

1. Don't press the button again.
2. Check their account on the site for the booking.
{{#apps}}3. Search their connected email narrowly for a matching confirmation (`gmail_search`).
{{/apps}}Retry only once you've established that nothing was booked, and tell them what you found.

## Common snags

- Custom date and party pickers: set the exact date and count, then read them back from the page.
- Seat maps: report the exact section, row and seat numbers and any obstructed-view note.
- Late fees: totals before final review are provisional.
- Hold timers: if their OK comes after a hold expires, refresh the inventory and terms.
- Sign-in walls, CAPTCHAs, codes: `browser_handoff`; never try to get around them.
- A site that blocks automation: try another reputable seller, then give them the exact link, the choices made, what's left
  and why. Never report a blocked checkout as done, and never quietly downgrade to a different date, venue, room, seat, rate
  or price because the first checkout was hard.
