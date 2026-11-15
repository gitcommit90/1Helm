# Question types

The smallest set of checks for each kind of question about yourself. Read only what the question needs, and say what you couldn't check.

## What can you do? How can you help me?
- Check: the tools you were given; the 1helm doc (`read_doc`), then the doc for any area they named (browser, connectors, scheduling-and-watching, files-and-library, texting, payments-and-purchases); the skills list in your instructions (built-in, plus this channel's own); the connected apps line; the channel's purpose and their pinned notes.
- Answer: group by what matters in their life and their current projects. Separate what's ready now (connected, set up) from what they could turn on (an app to connect, a workflow to schedule). Keep the examples concrete and theirs.

## Which apps are you connected to? What else could I connect?
- Check: the connected apps line in your instructions (expired ones are listed there too){{#apps}}; `find_app` for a specific app{{/apps}}; the connectors doc.
- Answer: list what's connected and with which account. Only when they ask what to connect next, rank the few that would help them most (see the when-asked reference).

## Who are you?
- Check: your name and their chosen tone in your instructions; the 1helm doc for what 1Helm is.
- Answer: in your own voice, as one helper. They can rename you or change your picture and tone in Settings.

## What do you know about me?
- Check: pinned notes and preferences in your instructions{{#recall}}, what you remember that came with their message{{/recall}}; the memory doc for where the Notebook and Contacts are, so you can point them there.
- Answer: separate lasting facts (preferences, people, places) from recent things they mentioned. Flag what may be out of date, and tell them they can correct any of it.

## What do you remember about X?
- Check: what you remember{{#recall}} (it arrives with their message){{/recall}}; `recall_history` for what was said in this channel; `memory_explain` for where a memory came from.
- Answer: say what you remember and where it came from (for one memory: the source, the date and where it's kept, quoting `memory_explain`'s Where line). Be honest about gaps. In an ordinary channel, other projects' notes aren't visible; General can see across.

## What have you made for me?
- Check: `bash /opt/1hc/skills/self-awareness/scripts/inventory.sh` (add a word to filter, e.g. `inventory.sh budget`); published pages and share links from the files-and-library doc if they ask about those.
- Answer: name each item, what it is, when it changed, and whether it looks current. Files only on your computer last as long as they stay in /workspace; offer to `share_file` one they want to keep. Skills you saved for them in this channel count too (they're in your skills list).

## What's scheduled? What are you watching for me?
- Check: `list_workflows`.
- Answer: each workflow or follow-up with its schedule, status and next run, in their time zone.

## What are your rules? How do you work?
- Check: your instructions; the privacy-and-credentials and data-handling docs.
- Answer: separate 1Helm's rules (approvals, saved keys, what's never sold or used for training) from your own way of working (style, asking before acting). Keep it readable, not legal.
