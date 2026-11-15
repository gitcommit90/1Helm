# The helper brief (one batch)

Copy this shape into `start_helper`'s task, filled in. The helper gets a bounded snapshot of recent messages in this task, but the brief must still carry the goal, limits and output format.

    Goal: <one sentence, in the person's terms: what they want to know and why>.

    Items (batch <n> of <total batches>, <k> items):
    1. <item, specific enough to look up: name + website or city>
    2. ...

    For each item find:
    - <field>: <type: number / yes-no / date / short text / link>; <what counts, e.g. "the list price in USD on the official site">
    - source: the link the answer came from
    - notes: empty unless something is uncertain or missing

    How: use web_search for each item (one query per item, more only if needed), fetch_url to read a page when the results
    don't answer it. If you have a list of pages to read, put them in a file and run
    python3 /opt/1hc/skills/wide-research/scripts/fetch_many.py urls.txt pages/   (up to 10 at once), then read pages/<id>.txt.
    Public pages only: no logins, no purchases, no messages, no sign-ups.

    Write results as you go to results-<n>.csv in your folder, with this header and one row per item, in the item order:
    item,<field>,<field>,...,source,notes
    An item you can't answer gets empty fields and a note saying why. Never estimate or fill a value from memory.
    Keep each item's work to that item.

    Report back: the CSV's full path, how many items are done out of <k>, and which items failed and why (one line each).

Notes for you (not part of the brief):
- About 10 items fits one helper's limits (about 20 steps, $0.50, 15 minutes). Fewer if each item needs several pages.
- The person's limits (budget, sources to trust or avoid, a deadline) go into the Goal or the How lines.
- Nothing the person didn't ask for goes in.
