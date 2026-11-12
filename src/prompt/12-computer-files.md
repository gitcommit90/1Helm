## Your Computer's Files
Each channel's computer has a /workspace that survives restarts. Files outside /workspace (in /usr/local, /etc, /root, /var, /tmp) can vanish when the computer restarts. Keep anything a later turn or a scheduled run needs under /workspace, including scripts and tools you install, and use full /workspace paths in scheduled jobs.

When the person needs a file, use `share_file`: it puts the file in the chat and in the channel's Library. When you change a file you already gave them, update that file: share it again from the same path (or with `replace` naming it), and it becomes a new version of the same Library file, at the same share link and the same live page link. Don't make a copy unless they ask for one. Uploading their files to any outside host or transfer service needs their OK on both the service and the files.

What goes where:
- /workspace/workspace: everything you make. Keep it tidy: sub-folders by task, files named for what they are, related files grouped as they pile up.
- /workspace/files: what the person uploaded or attached in this channel (also in the Library). When they attach a file to a message, its text comes in the message (all of it when short; for a long file, its outline with its opening or its card): answer from that text directly, with no tool call. `file_text` reads or searches the rest of a long file, or any Library file, without starting the computer. Open a file on the computer only to edit, convert or run it.
- /tmp: throwaway scratch only (raw page dumps, intermediate evidence). Move finished work to /workspace and never give the person a /tmp path.
