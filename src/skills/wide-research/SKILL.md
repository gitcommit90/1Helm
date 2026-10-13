---
name: wide-research
description: Use when the person wants the same facts looked up for many separate items (a list of companies, products, people, places or links), each answered in the same shape.
always: false
---
# Wide research

One job, many independent items, one result table. For example: the price, rating and return policy of 25 products; the founder, size and funding of 40 companies; whether each of 30 venues is free on a date.

Not for a single item, and not when the items depend on each other (each answer changes what to look up next). Then just research it.

## How you can fan out (say it honestly)

- Your own tool calls run one after another, even several in one step. They're quick, so a handful of items is fine right here.
- A background helper (`start_helper`) works through a batch on its own while you and the person carry on. Up to three independent helpers can run in one task at a time. Each has limits: about 20 steps, $0.50 and 15 minutes. You can start independent batches together, or run them one after another when later work depends on earlier results.
- Real parallel fetching happens on your computer: `python3 /opt/1hc/skills/wide-research/scripts/fetch_many.py urls.txt out/` fetches up to 10 public pages at the same time and saves each as text (out/index.tsv lists what worked). Use it when you already know which pages to read (official sites, product pages, a list of links). It doesn't search: searching is `web_search`, one call per query.
- Tell the person batches are running in parallel only when you have actually started more than one helper. Otherwise say you are working through the list in batches.

## 1. Set it up

1. Clean the list: drop duplicates, fix obvious typos, make each item specific enough to look up (add a website or city where names clash). Number the items.
2. Agree on the fields: the smallest set that answers their question, each with a type (number, yes/no, date, short text, link). Always add source (the link the answer came from) and notes (empty unless something's uncertain). No fields they didn't ask for.
3. Size it:
   - Up to about 8 items: usually do it yourself in this turn. `web_search` per item (several in one step), `fetch_url` only when the results don't answer it. Reply with the table even if some cells are still empty (mark them "not found" with a note), rather than a list.
   - About 9 to 40 items: consider background helpers in batches of about 10. Tell them which batches have started; they can keep talking to you meanwhile.
   - More than about 40: before starting anything, give both numbers, how many batches and roughly how long ("6 batches, about 45 minutes"), and ask whether to go ahead, narrow the list or start with a sample.

## 2. One helper per batch

A helper gets a bounded snapshot of recent messages in this task at spawn, but not the full tool history or later messages. Its brief still carries the goal, the batch's numbered items, the fields with their types, where to look, the results file, and what to report (done out of total, which failed and why). Use the helper-brief reference.

Start a suitable batch with `start_helper` and reply to the person right away that it's started; don't wait on it. You can start up to three independent batches together. Give each its own result file, and start another batch when one finishes if more work remains.

## 3. Finish

1. Merge the batches into one table (the helpers' CSV files are on your computer: `read_file` or `run_command`).
2. Retry only the items that failed, once, if completeness matters to them.
3. Hand it over: up to about 15 rows as a table in the chat; more as a spreadsheet (read the artifacts skill) given with `share_file`.
4. Always state coverage ("found 37 of 40; 3 have no public price, see notes") and which values are uncertain.

## Rules

1. One list, one result. Give each helper a separate batch and result file. Do not start duplicate work on the same items.
2. Every value has its source. No source, no value. A value you saw only in a search result's snippet gets that result's
   link (marked "search result"), not the item's main page; if you can't link where you saw it, leave the cell empty.
3. Keep each item's work to that item; one item's findings never fill another's fields.
4. A value that can't be found stays empty with a note. Never estimate it or fill it from memory.
5. If they change the list or the fields midway, stop the running helper with `stop_helper` if they want it stopped, and restart with the new brief.
