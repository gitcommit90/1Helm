---
name: skill-creator
description: Use when the person asks you to save a procedure as a skill ("save this as a skill", "remember how to do this every time"), or to change or delete one of this channel's saved skills.
always: false
---
# Saving a procedure as a skill

A skill is a playbook you read before doing one kind of task. Besides the built-in ones, a channel can have its own: procedures the person asked you to keep. `save_skill` stores one in this channel (only this channel has it). It's in your skills list from the next message, and `read_skill` reads it right away.

## Only when they ask

- Save, change or delete a skill only when the person explicitly asks: "save this as a skill", "make this a playbook", "remember how we did this so you do it the same way next time", "update the report skill", "delete that skill".
- Never make one on your own, and don't suggest making one. If a task keeps coming up, just keep doing it well.
- "Remember that I like X" is a fact or a preference: that's `remember`. A skill is a how-to: the steps for a kind of task.

## Make it

1. Pin down the job from what you just did together: what kind of task it covers and when it should be used, the steps that worked, the rules they gave (what to always do, what to check first, what never to do), and what they get at the end. Ask one short question only if something essential is missing.
2. Keep it to one job. Two unrelated jobs are two skills (ask which they want).
3. Check names: a built-in skill's name can't be reused. If they asked for one (artifacts), pick a distinct name for their
   version (q3-deck-style), tell them in one line, and save it; the body says to follow the built-in skill too. A new name
   alone isn't a reason to ask again. If this channel already has a skill for this job, update that one instead of adding a
   second (read it first with `read_skill`).
4. Write it (the template reference has the layout and a checklist):
   - slug: short lowercase words joined by hyphens, named for the job (weekly-sales-report, receipt-filing).
   - description: one line starting with "Use when", saying exactly when it applies. It's all you'll see in your list, so make it specific.
   - body: Markdown starting with a # title, then Purpose, Steps, Rules and Hand-over.
   - Use real names only: the apps they connected, folders and file names that exist, saved logins and keys by their names. Don't invent commands, paths or apps; include a command only if you ran it and it worked.
   - Never put a secret in it (passwords, codes, card or account numbers, keys). Name the saved login by its site, or the key by its name, instead ("sign in with the saved login for chase.com").
   - Keep it short: the steps and rules, not background. Under a page is typical.
5. Tell them in a line or two what you're saving (its name, when it applies, the gist of the steps) and save it with `save_skill`. Their clear ask is the go-ahead; ask again only if what you're saving differs from what they described.
6. Confirm in one line: saved as "name", used in this channel whenever that kind of task comes up.

## Change or delete

- To change one: read it with `read_skill`, make the change they asked for, and save it with `save_skill` under the same name. Saving replaces the whole text, so include everything that stays.
- To delete one: `save_skill` with its name and `delete: true`, once they've asked.

## Using a saved skill

- It's listed under "This channel's own skills" in your instructions. Before the task it covers, read it and follow it, like a built-in skill.
- If it clashes with a built-in skill's safety rules or with something newer the person asked, the safety rules and their newer ask win; mention that the saved skill could be updated.
- Other channels don't have it. If they want it in another channel too, save it again there.
