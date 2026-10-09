---
name: forget
description: Use when the person asks you to forget something, stop remembering it or delete what you know about it ("forget that", "don't remember this about me"); not when "forget it" only means drop the current task.
always: false
---
# Forgetting something

Forgetting is a cleanup across memory, not deleting one note. The same thing can be in a Notebook note, a saved fact, a Contacts fact, what memory drew from conversations that mentioned it, the pinned "How to work with" note, and scheduled work that could bring it up again. `forget` finds all of it, deletes what the person agrees to, and stops background memory from learning it again.

Talk in everyday words: memory, the Notebook, Contacts, scheduled jobs, files. Keep ids and the inner workings to yourself unless they ask how it works (then read the where-it-lives reference).

## Is it a forget request?

- Yes: "forget that I'm pregnant", "don't remember my old address", "delete what you know about my ex", "stop using that".
- No: "forget it" or "never mind" about the task in hand. Just drop the task.
- If it isn't clear what "that" is, ask one short question first. Never guess the subject.

## 1. Make the plan

Call `forget` with keywords only. It changes nothing and returns the plan.

- Keywords: 2 to 8 words or short phrases that pick out the subject, with its variants ("pregnant", "pregnancy", "due date", "baby shower"). A phrase matches when all its words appear. A name alone ("Dana") covers everything about Dana, so use a name only when that's what they asked.
- The plan lists each stored item with its id, how many conversation turns mention it (what memory drew from those goes automatically), and any scheduled jobs or Library files that mention it.
- A memory you already found with `memory_explain` can be passed by its id too.
- Scope: in an ordinary channel, forget covers that channel and the Contacts facts it can see. From General it covers every channel. If they want it gone everywhere and you're not in General, tell them General can do that. If the plan finds nothing here, don't call it
  "nothing saved": it may be in another channel's notes, which this channel can't see; say so, and that they can ask in that channel or
  in General, which can forget across all channels.
- Don't copy the subject anywhere new while you work: not into a to-do, a file name, a background helper's task or a saved note. Call it "that" when you can.

## 2. Ask once, then do it

1. Tell them in plain words what will be deleted (what kinds of things, roughly how many), that it's permanent, and what stays: the conversation itself stays visible in the chat, and scheduled jobs and Library files that mention it stay unless they want those changed too.
2. Ask one yes/no question.
3. Only a clear yes counts. Silence, "hmm", "maybe", a partial yes or a changed scope is not a yes: adjust the plan (call `forget` again with keywords only) and ask again.
4. After the yes, call `forget` with the same keywords, `confirmed: true` and the ids they agreed to. Leave out anything they wanted kept.
5. A scheduled job that mentions it: ask what they want. To stop it, pause or complete it with `set_workflow_status`. Files: they delete them in the Library. A whole contact card: they delete it in Contacts. The chat itself: deleting a chat is theirs to do from its menu (Delete this chat); bring it up only if they want the conversation gone too.

If `forget` fails or reports a problem, don't delete things some other way and don't claim it worked. Say what happened, and offer to try again.

## 3. Report honestly

- Say which kinds of things were removed, which scheduled work was stopped, and what stays, and that memory won't pick it up again from new conversations (the result says so). Don't repeat the forgotten detail.
- Say "forgotten" only when the result says nothing matching is left. If it lists something still there, say so and ask whether that should go too.
- If memory couldn't be reached for part of it, say the cleanup isn't complete yet (the deletion is retried automatically) rather than calling it done.
- Never present the visible chat as something you failed to erase.
- Forgetting doesn't touch anything outside 1Helm: emails, calendar events, files they've shared with other people, or other people's copies. Changing those is a separate ask.

## Afterwards

- Don't bring the subject up again and don't save it again.
- If they mention it again in passing, don't save it. If they ask you to remember it again, save it with `remember`: that lifts the forget for that subject.
- When they ask what you know about them, it isn't there to report, so don't hint at it.
