// Six everyday errands. Each has: what the person typed, the reply as OpenUI Lang (cards), and the same reply as
// today's markdown. The iMessage version is NOT written here: it's generated from the card tree (toText in genui.ts).
export type Scene = { k: string; tab: string; you?: string; nudge?: string; lang: string; md: string;
  after: (action: string, v: Record<string, any>) => { you: string; reply: string } };

export const SCENES: Scene[] = [
{ k: "flights", tab: "Flights", you: "Find me flights to Phoenix for Thanksgiving. Me and Sarah, out Wednesday, back Sunday. Nothing too early.",
lang: `root = Stack([intro, pick, go, tip])
intro = Say("I found three good round trips from San Jose for **Wed Nov 25 → Sun Nov 29**. Prices are for both of you.")
pick = Options("flight", [o1, o2, o3])
o1 = Option("Southwest", "Out 9:40a → 12:30p · Back 4:10p → 5:00p · Nonstop", "$486", "Best fit")
o2 = Option("American", "Out 11:15a → 2:05p · Back 6:05p → 6:55p · Nonstop", "$538", "")
o3 = Option("Alaska", "Out 7:00a → 9:50a · Back 1:30p → 2:20p · Nonstop", "$412", "Cheapest, but early")
go = Buttons([Button("Book the one I picked", "submit:flight", "primary"), Button("Show me more", "more", "ghost")])
tip = Tip("Southwest includes 2 checked bags each. The other two charge $35 a bag.")`,
md: `I found three good round trips from San Jose for **Wed Nov 25 → Sun Nov 29**. Prices are for both of you.

| Airline | Outbound | Return | Stops | Total (2 ppl) |
|---|---|---|---|---|
| **Southwest** ⭐ | 9:40a → 12:30p | 4:10p → 5:00p | Nonstop | **$486** |
| American | 11:15a → 2:05p | 6:05p → 6:55p | Nonstop | $538 |
| Alaska | 7:00a → 9:50a | 1:30p → 2:20p | Nonstop | $412 |

**My pick:** Southwest. It isn't too early, and it includes 2 checked bags each (the other two charge $35/bag).

**Note:** Alaska is the cheapest, but it leaves at 7:00a.

Let me know which one you'd like me to book!`,
after: (a, v) => a === "more" ? { you: "Show me more", reply: "Sure. Want me to look at Oakland too, or keep it to San Jose?" }
  : { you: `Book the ${v.flight || "Southwest"} one`, reply: `Booked. ${v.flight || "Southwest"}, both of you, ${({ Southwest: "$486", American: "$538", Alaska: "$412" } as any)[v.flight || "Southwest"]}. The confirmation is in your email and both flights are on your calendar. I'll text you when check-in opens.` } },

{ k: "rsvp", tab: "RSVP", you: "Can you RSVP us for Maya's school fall festival? The email's in my inbox.",
lang: `root = Stack([intro, form])
intro = Say("Lincoln's Fall Festival is **Sat Oct 17, 11a–3p**. The RSVP asks a few things, so I filled in what I know.")
form = Form("rsvp", [adults, kids, lunch, help, note], "Send RSVP")
adults = Stepper("adults", "Adults", 2, 0, 6)
kids = Stepper("kids", "Kids", 1, 0, 6)
lunch = Choice("lunch", "Pizza lunch, $6 each", ["Cheese", "Pepperoni", "No lunch"], false, "Cheese")
help = Choice("volunteer", "Want to help out?", ["Bake sale", "Face painting", "Setup at 10a", "Not this time"], true, "")
note = Field("note", "Anything for the PTA?", "Allergies, questions…")`,
md: `Lincoln's Fall Festival is **Sat Oct 17, 11a–3p**. The RSVP form asks for:

1. **Number of adults**: I'm guessing 2 (you and Sarah)?
2. **Number of kids**: 1 (Maya)?
3. **Pizza lunch** ($6 each): Cheese, Pepperoni, or No lunch
4. **Volunteering** (optional): Bake sale, Face painting, Setup at 10a, or Not this time
5. **Notes for the PTA** (optional): allergies, questions, etc.

Just reply with your answers, e.g. *"2 adults, 1 kid, cheese, bake sale"*, and I'll send it in!`,
after: (_a, v) => ({ you: `Send RSVP: ${v.adults ?? 2} adults, ${v.kids ?? 1} kid${(v.kids ?? 1) === 1 ? "" : "s"}, ${v.lunch || "Cheese"}${v.volunteer?.length ? ", " + v.volunteer.join(" + ") : ""}`,
  reply: `Sent to the PTA. It's on your calendar for Saturday the 17th${v.volunteer?.includes("Bake sale") ? ", and I'll remind you Friday night to bake" : ""}.` }) },

{ k: "bill", tab: "Bill", you: "Why is my PG&E bill $214 this month?? It's usually like $140.",
lang: `root = Stack([big, why, chart, rows, go, tip])
big = Big("$214.37", "October PG&E bill", "+$72 over your usual")
why = Say("Mostly the heat wave. Your AC ran hard on 9 days over 95°, and the new rate in September added a little.")
chart = Bars(["May", "Jun", "Jul", "Aug", "Sep", "Oct"], [131, 138, 152, 147, 142, 214], "$", 5)
rows = Rows([["AC during the heat wave", "+$58"], ["New rate since Sep 1", "+$9"], ["3 extra days in this bill", "+$5"]])
go = Buttons([Button("Put me on Budget Billing", "budget", "primary"), Button("Remind me before the next one", "remind", "secondary")])
tip = Tip("Budget Billing would make it about $156 every month, no surprises.")`,
md: `Your October PG&E bill is **$214.37**, about **$72 more** than your usual ~$142.

### What changed
| Reason | Impact |
|---|---|
| AC use during the heat wave (9 days over 95°) | +$58 |
| New rate effective Sep 1 | +$9 |
| Longer billing period (33 days vs 30) | +$5 |

### Last 6 months
- May: $131
- Jun: $138
- Jul: $152
- Aug: $147
- Sep: $142
- **Oct: $214**

### Options
1. **Budget Billing**: PG&E averages your bill to ~**$156/month**
2. I can remind you before the next bill

Want me to do either of these?`,
after: (a) => a === "budget" ? { you: "Put me on Budget Billing", reply: "Done. PG&E confirmed it starts with your November bill, about $156 a month. I'll check the first one to make sure it's right." }
  : { you: "Remind me before the next one", reply: "Will do. I'll text you around Nov 12 with an estimate." } },

{ k: "email", tab: "Approve", nudge: "While you were out",
lang: `root = Stack([intro, mail, go])
intro = Say("Dave, your landlord, wrote back about the dishwasher. The repair guy can come **Tuesday or Thursday morning**. You're home Thursday, so I drafted this:")
mail = Email("Dave Kline", "Re: Dishwasher still leaking", "Hi Dave,\\n\\nThursday morning works great. I'll be home from 8 to noon, and the side gate is unlocked.\\n\\nThanks for getting this sorted,\\nJoseph")
go = Buttons([Button("Send it", "send", "primary"), Button("Change something", "edit", "secondary"), Button("Not now", "later", "ghost")])`,
md: `Dave, your landlord, wrote back about the dishwasher. The repair guy can come **Tuesday or Thursday morning**. You're home Thursday, so I drafted this:

---

**To:** Dave Kline
**Subject:** Re: Dishwasher still leaking

> Hi Dave,
>
> Thursday morning works great. I'll be home from 8 to noon, and the side gate is unlocked.
>
> Thanks for getting this sorted,
> Joseph

---

Should I send it? Reply **yes** to send, or tell me what to change.`,
after: (a) => a === "send" ? { you: "Send it", reply: "Sent. I put Thursday 8–12 on your calendar as \"Dishwasher repair\"." }
  : a === "edit" ? { you: "Change something", reply: "Sure, what should it say instead?" } : { you: "Not now", reply: "Okay. I'll bring it back up tonight at 6." } },

{ k: "flyer", tab: "Flyer", you: "Make a flyer for our garage sale this Saturday. 8 to 1, 412 Alder St. Furniture, kids stuff, tools.",
lang: `root = Stack([intro, file, go])
intro = Say("Here's your flyer. I made it bright so people can read it from the street, and put the address big.")
file = File("Garage-sale-flyer.pdf", "1 page · Letter size · 240 KB", "flyer")
go = Buttons([Button("Text it to me", "text", "primary"), Button("Make changes", "edit", "secondary")])`,
md: `Here's your flyer! I made it bright so people can read it from the street, and put the address big.

📄 **[Garage-sale-flyer.pdf](#)** (1 page, Letter size, 240 KB)

**What's on it:**
- **GARAGE SALE** (headline)
- Saturday, 8 AM – 1 PM
- 412 Alder St
- Furniture · Kids stuff · Tools

Let me know if you'd like any changes, like different colors, adding prices, or a map!`,
after: (a) => a === "text" ? { you: "Text it to me", reply: "Sent to your phone. Want me to post it on Nextdoor too?" } : { you: "Make changes", reply: "Sure, what should I change?" } },

{ k: "topup", tab: "Running low", nudge: "Heads up",
lang: `root = Stack([intro, meter, go])
intro = Say("Heads up: you've used most of this month's usage. At your pace it runs out around **Oct 27**.")
meter = Meter("This month", 0.84, "Resets Nov 1 · 12 days left")
go = Buttons([Button("Top up $10", "top", "primary"), Button("Move to Plus", "plan", "secondary"), Button("I'm fine", "ok", "ghost")])`,
md: `**Heads up:** you've used **84%** of this month's usage. At your current pace it'll run out around **Oct 27**. It resets Nov 1 (12 days left).

**Options:**
- **Top up $10**: adds more usage right away
- **Move to Plus**: 2× the usage of Personal, $50/mo
- Do nothing: I'll pause big jobs if you run out

Reply with what you'd like to do.`,
after: (a) => a === "top" ? { you: "Top up $10", reply: "Done. $10 added with the Visa ending 4242. You're good through the end of the month." }
  : a === "plan" ? { you: "Move to Plus", reply: "You're on Plus now. Today's difference is prorated. Your usage just doubled." } : { you: "I'm fine", reply: "Got it. I'll only bring it up again if you actually run out." } },
];
