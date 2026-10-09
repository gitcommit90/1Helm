# Where a fact can live, and what forgetting does to each

Read this when the person asks how forgetting works, or when a forget result surprises you. Explain it in everyday words.

| Place | What forget does |
|---|---|
| A Notebook note (theirs or one you saved with `remember`) | Deleted from the Notebook and from memory, the same as Delete on the note. Only when its id is in the confirmed call. |
| A saved fact (background memory upkeep saved it, or an older saved fact) | Deleted, together with the older and newer versions of it, so no earlier wording survives. |
| A memory drawn from a saved record | The record it came from is deleted, which removes every memory and summary drawn from it. |
| What memory drew from conversations | Automatic: every conversation turn in scope that mentions it loses its memory copies. The chat itself stays visible; deleting a chat is the person's action in the app. |
| A Contacts fact | Deleted for good (the fact and its search copy), when its id is in the confirmed call. A whole contact card is deleted by the person in Contacts. |
| The pinned "How to work with" note (General's Notebook, written nightly) | Deleted when its id (reflection) is in the confirmed call; the next nightly run writes a new one from words that no longer include the subject. |
| Background memory (upkeep, people, the nightly note) | From now on it skips anything containing the keywords: turns that mention them are hidden from it, and anything it proposes about them is dropped. Its own logs that quoted the subject are cleaned. |
| New conversation turns | A turn that mentions the keywords isn't saved to memory. Saving it with `remember` because they asked lifts this. |
| Scheduled jobs and Library files | Listed, not changed. Pause or complete a job with `set_workflow_status` if they want; files are deleted in the Library. |
| Outside 1Helm (email, calendar, shared files, other people's copies) | Not touched. |

What's kept to stop it coming back is a scrambled form of the keywords, not the subject itself.

Scope: an ordinary channel's forget covers that channel and the Contacts facts it can see. General's covers every channel.
