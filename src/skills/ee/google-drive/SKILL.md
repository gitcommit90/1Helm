---
name: google-drive
description: Use when the person wants files in their Google Drive, Docs or Sheets found, read, created, changed, shared, moved or deleted.
always: false
---
# Google Drive, Docs and Sheets

{{^apps}}Connected apps aren't switched on here, so you have no access to their Google files. Say so in one line.{{/apps}}{{#apps}}
Drive, Docs and Sheets are three separate connections (googledrive, googledocs, googlesheets). For each, `app_actions` with that app
returns Composio's plan and pitfalls (ids, ranges, paging, checking a write): follow them. This skill adds 1Helm's rules on top.
Where they disagree, this wins.

- **Not connected** (or expired): `offer_connect` for the app the job needs (a spreadsheet's rows or cells: googlesheets; a doc's
  text: googledocs; finding, moving or sharing files: googledrive), one short line, stop. Asked to write or add something (rows,
  a paragraph, a new doc): pass what you'd write as the card's `draft` {text} so they see it under Connect.
  Connecting isn't a yes: once connected, read the file first, then make the change; it goes through the confirm card (below).
- **Find the exact file first.** Search by name, then check its details. Several files with that name: show them (name, folder,
  last changed) and ask which. Use only ids the tools returned; never guess or build one.
- **Read before you write.** Open the doc or sheet first (the tab, its headers, the last rows, the paragraph you'll change), so
  the change you make is exactly the one they asked for.
- **Changes wait for a yes: the confirm card.** Writing, trashing, deleting, moving, renaming or sharing: find the exact file, then
  call the action. 1Helm shows the person a confirm card with that exact action and runs it only when they tap Confirm. Their
  request ("get rid of X", even "just do it, don't ask") is not that yes; the tap is. Don't ask in prose first; in your one line,
  name the file and the change (the card shows ids). WAITING FOR CONFIRM: end your turn.
- **Delete means trash**, which they can restore. Never permanently delete unless they say "permanently", and even then say it can't
  be undone (the card says so too).
- **Sharing changes who can see it.** Share with exactly the people and access (view, comment or edit) they named; the card shows
  them. "Anyone with the link" or public only when they ask for it. Moving a file into a shared folder shares it too: say so.
- **Files you made** go to them with `share_file` (their Library), unless they ask for Drive. To put one in Drive, pass its Library
  name or /workspace path as the file input of Drive's upload action (`app_run` attaches it).
- **After a write**, read it back (these actions often answer with very little) and report only what came back: the file's name
  and the link the tool returned. Never write a Drive or Docs link yourself.
- **A plan step that names a remote workbench:** you don't have one. Do that part on your computer (`run_command`) or in smaller calls.
- Plain words: no file ids, ranges in A1 form only when they help, no raw JSON.
{{/apps}}
