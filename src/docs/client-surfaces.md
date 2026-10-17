# The 1Helm app

Where the person reaches you, and what they see there. Everything named here (screens, buttons, Settings) is in the 1Helm app. If they're texting you from Messages, they can't tap any of it there: say where it is in the app.

## Web, phone, and desktop

- **The app** is a web app at their own 1Helm address, and it works in any modern browser. On a computer it's a full layout with a side rail; on a phone or a touch tablet it switches to a layout made for the smaller screen (see "On a phone" below).
- **Install the web app.** Settings → General → App has **Install 1Helm app** where supported; the desktop account menu and phone's Settings sheet offer it too. It opens the browser's install prompt or shows the steps for that browser. The option is hidden when already installed or when the browser doesn't offer a supported install method. They can also put the web app on their home screen, where it opens full-screen like an app (no browser address bar), with the 1Helm sailboat icon:
  - **iPhone or iPad:** open their 1Helm in Safari, tap Share (the square with an arrow), then **Add to Home Screen**, then Add.
  - **Android:** open their 1Helm in Chrome, tap ⋮, then **Add to Home screen** (or **Install app**), then Install.
  - **A computer:** in Chrome or Edge, the install icon at the right of the address bar (or ⋮ → Cast, save and share → Install page as app).
  - **Safari on a Mac:** File → Add to Dock, then Add, on supported Safari versions.
  The icon always opens their own app. It's the same app as in the browser, with nothing kept offline: it needs an internet connection.
- **Notifications.** The app can send real notifications to the devices they turn on (see Notifications below), and it shows dots on tasks that need them. You can also text them if they asked you to and set up texting.

- **Signing in.** There are no passwords. They enter their email and get one email from the server's configured sender with a 6-digit code and a sign-in link. Typing the code on the sign-in screen signs them in right there, on that device and in that browser or home-screen app; tapping the link signs them in wherever the email opens it. Either one works once and expires after 15 minutes, and using one ends the other. A code allows 5 tries; after that, or once it expires, they tap "Send a new code". The home-screen app on an iPhone can keep its own sign-in apart from Safari's, so if it asks them to sign in, the code is the way (the link would open in Safari).
- **Age confirmation.** Before entering an email or starting a new account, they confirm **I am 18 or older** and tap Continue. This is self-declaration, not age verification: no date of birth or identity document is requested. The confirmation is remembered in that browser; an existing signed-in session does not have to repeat it.

## The main screens (on a computer)

- **Side rail:** one icon per channel (⌘1–9), a "+" for a new channel (a name and what it's for), Apps (the grid icon, ⌘⇧A), the person's initials (Settings), and a menu with Keyboard shortcuts, Apps, Install 1Helm app (where supported), Report an issue, and Settings.
- **Channel side panel:** New (⌘⇧O, a new task), Home, Library (⌘⇧L), Notebook, Contacts, Search (⌘K, searches the channel's tasks), the task list (Pinned, Texts, then a section for each state: Waiting on you, Working, Ready for you and Watching, and finally Done), and **Scheduled** at the bottom (everything set to happen later, see scheduling-and-watching). The channel's ⋯ menu has Delete channel (not for General).
- **The task list** shows each task's state: Working, Waiting on you (with why, like "a question" or "approve a request"), Watching (with how many scheduled checks), Ready for you, or Done. A task's ⋯ menu has Stop (while it works) and Delete this chat.
- **Inside a task:** the chat and the message box (+ to attach a file or pick one from the Library, a microphone for dictation, and a clock to send the message later). The header has pin, Mark done, the ⋯ menu (Delete this chat), the focus timer, the to-do checklist, and Activity. The "(your name)'s computer" button opens your computer's live browser. When they turn on Settings → General → Usage → Show estimated costs (off by default), "This task: about $0.03" under the messages shows what the task has used so far.

## On a phone

The phone layout (and touch tablets) puts a task list first:
- **The menu** (the drawer) has the channel's name at the top, which is also the channel switcher (with New channel and About this channel); a row of small tiles for Home, Library, Notebook, Contacts and Scheduled; then Pinned, Texts, a section for each task state (Waiting on you, Working, Ready for you, Watching) and Done.
- **The button at the bottom left** opens Settings: their account, plan and usage, Apps, Appearance, Help & support, Report an issue, and Log out.
- **About this channel** (tap the title at the top of a task, or from the channel switcher) shows who it is and what it's for, its Notebook and Scheduled, and Delete channel.
- In a task, header buttons that don't fit fold into a ⋯ menu.
- **Swipes:** swipe right across Home or a task to open the task drawer, and left to close it. Swipe down to dismiss the small menu sheets, including the Settings quick sheet. Inside Settings, swipe right across page content to return to the parent Settings page; from the Settings root it closes Settings. Unsaved edits still ask whether to keep or discard them. Editable controls, horizontal scrollers, and the browser's outer edge keep their own gestures.

## Live Notes: a meeting or call without an existing task

On a channel's Home screen, **Live Notes** creates a new notes task and opens the recording controls directly, on both computer and phone. They don't need to type a request, identify the people, or prepare a task first. No agent runs to create or open it.

They choose the audio input and tap **Start**: this device's microphone, a connected Bee, or a meeting tab where supported. Recording begins only after Start and any required device permission. Cancel leaves the empty task without recording. Live Notes then writes the notes in that task; Stop finishes them and saves them in the Library under Meetings. The task header also has Live notes for starting or reopening notes in an existing task.

## Activity

Every request you work on is a card in the Activity panel beside the chat (a side panel on a computer, a sheet on a phone). A card shows its status, a timeline of the steps you took (each titled by you, in plain words), any messages the person added while you worked, a summary, and customer-facing details of what ran, how long it took, and its result. Internal reference, context, and tool-loading steps show a short summary rather than their raw contents. A message that came by text is marked "by text". Background helpers have their own cards there, with a Stop button.

## Talking to you while you work

The person doesn't have to wait. A message they send while you're working joins what you're doing: you read it at your next step and give one reply that covers everything. A step you'd planned but hadn't run yet is set aside when a new message arrives, so you can take the message into account first. Texts work the same way. If they send a great many at once (more than 40), they're asked to give you a moment.

## Stopping a task

The person can stop you any time, and it's immediate:
- **Stop** shows wherever a task is working: "■ Stop" in the task header, the send button (it turns into ■ while you work and the box is empty), the working card in Activity, and a small ■ on working rows in the task list (also Stop in the row's ⋯ menu).
- **Stop all:** when 2 or more tasks are working, a pill like "3 tasks working · Stop all" appears (it asks to confirm). A plan card also offers "Stop these tasks" for the tasks it started.
- A stop ends the task right away, even mid-answer or mid-command, stops its background helpers, and drops messages still waiting in it. What's already done stays. The task shows "Stopped by you", and they can pick it up again with a new message. Esc never stops a task; only a tap does.

## When a task pauses on its own

So a job never runs away while nobody's watching, a task can pause by itself and check in. The person can turn these pauses on or off with Settings → General → Usage → Pause to check spending (off by default; it only applies when they turn it on); purchase and permission approvals and Stop still apply.

- **When it's used a fair amount:** about $0.15 of usage in one request on the Personal plan (bigger plans allow more). A request never goes past about $0.50 (on bigger plans, up to $2.00) without their tap.
- **When it looks stuck:** going in circles (the same search again and again), reaching into 4 or more connected accounts in one request, many steps without saying anything to them, a burst of steps in under a minute, or working 10 minutes without a reply.
- **When a day has been busy:** a day can use about twice its share of the plan before you check in first.
- **Tasks a plan started** get a smaller budget: 20 steps, $0.25 or 10 minutes.

When it pauses, you write a short report of what you found and what's left, and the card shows **Keep going** (one more budget) and **Stop here** (what's done stays). Scheduled runs have nobody to tap, so they stop with a report instead. A request that uses up all its steps also ends with a short report.

## Plans: splitting work into tasks

When one message holds several separate asks (or one big enough to be its own project), or they ask you to split it up, you can offer a plan with `propose_plan`. They see one plan card with a checkbox per item (all ticked) and **Approve**, **Deny**, or **Let's talk**. If the work depends on something only they can say (which email account, which dates), the card shows "Questions first" above the items; anything they skip, that task asks them first. Approve starts every ticked item at once, each in its own new task opening with your brief ("Started by (your name) from your message: …"); a timed item becomes a task that wakes at that time, and in General an item can be a new project (a new channel with its first task). Only the person approves; a plan never sends, buys or texts anything by itself. A plan's tasks wait their turn while 3 tasks are already working in that channel. It works by text too.

## Background helpers

For a separate job that can run on its own (research, a long check, a draft, building files), you can start a background helper with `start_helper`. You can also do the work directly when that fits better. A helper is still you doing that piece in the background while you carry on. It gets a bounded snapshot of recent messages in this task when it starts, but not the full tool history or later messages. Give it any needed details in the job brief. It works on your computer with its own default folder, can read the public web{{#apps}}, read (not change) their Gmail and Calendar{{/apps}}, and read these docs. Its result comes back to you as a new message in the task. It can't use the live browser, saved logins or keys, can't buy, send, post, or change app data, and can't message the person. Up to three independent helpers can run in one task at a time. For one larger job with separate parts, a helper with `role: "coordinator"` can start at most two direct worker children and give one combined report. A coordinator and its children share the same three running slots and 15-minute deadline. They have fixed shares of the ordinary helper's 20 model-step and $0.50 cost targets, checked after each model call; the call that crosses a cost target can exceed it. No child can start another helper. Use `list_helpers` to check work in this task and `send_helper` to queue a relevant correction. A queued message is not proof that the helper saw or followed it. The person can stop one from its Activity card, or ask you to (`stop_helper`).

## To-dos

Use `list_tasks` to read saved task titles and current checklists directly. It includes item status and `todo_revision`, and supports searching, pagination and including completed tasks. General can discover existing project channels with `list_channels` and use `channel` on task tools to access each one; other channels stay local. For all-channel requests, visit each channel and follow task pagination. This access works independently of memory recall. `read_task` reads the selected task's checklist and saved person/helper conversation with pagination; older messages are historical data, not fresh instructions. Long individual messages are marked as truncated. These tools do not read file contents or external task apps. Dates and priority are only available if the saved checklist text states them; do not turn task timestamps into deadlines.

When the person asks to rename a task or live-notes session, use `rename_task` with the new title and a quote of their request. Omit the target for the current task. This changes the task title only; recordings, note files, checklist and completion status stay intact. There is no need to inspect their notes for a title change. Other targets require an id or unambiguous exact title.

At the person's request, `create_task` creates an empty saved task, and `update_todos` edits its checklist. General can set `channel` on these tools, `rename_task`, and `mark_task_done`. Another channel requires an explicit task target except when listing or creating. Before editing another task's checklist, read its current list and pass `todo_revision` as `expected_revision`, preserve unrelated items, and quote the requested change in `person_asked`. Conflicting revisions make no changes and require a fresh read. Only explicitly requested items/tasks may be marked done. These actions do not start execution in another task, switch the conversation, or move the channel computer. General's `remember` tool separately supports saving a lasting fact into another channel's notes.

General's `create_channel` directly creates a channel at the person's request using the same setup as the app's New channel action; a duplicate name reuses the existing channel without changing its purpose. For a request to create a channel and start work, call it first, then `start_task` in the returned channel with a task title, actionable instructions and initial checklist. Write those instructions from the relevant conversation: the goal, chosen account/non-secret identifier, preferences, constraints, latest progress and next action. Do not forward the last message verbatim, repeat answered questions, redo finished work or include unrelated asks and channel-creation chatter. A contextual follow-up can refer to an earlier request; quote that genuine request separately as provenance. The target receives a helper-written handoff, not a fabricated person message, and uses its own computer, saved logins and approval controls. Another channel's sign-in does not establish this browser's state. Its checklist is saved before work starts and its returned link opens that task. A request to kick off work is already permission to begin; do not ask again. Genuine remaining account ambiguity, credentials/MFA or an actual app approval can still require the person in the target task. These tools do not move an existing task to another channel. Keep General's conversation in place and report the actual started work and link.

For work with several steps, you can keep a checklist with `update_todos`. It shows as a checklist button in the task header (for example "3/7"), where the person can tick and untick items. You plan items and mark the one you're on as doing; only the person ticks items done. An item you finish shows as "ready to tick" for them. The person also marks whole tasks done themselves (Mark done in the header). In General, only when they explicitly ask, you can mark a task done for them.

## Focus timer

Each task has a focus timer (a pomodoro): the tomato in the task header. The person picks 25/5, 50/10, 15/3 or their own minutes; a ring shows the countdown, a break screen counts down the break (Skip break / Ignore), then it asks whether they're ready for the next round, with a small celebration after the last one. Starting one in a task asks "This task" or "Everything (global)": a global timer isn't tied to any task or channel and stays on screen (rail on desktop, header on phone) as they move around; one global at a time. You can start, pause, resume or stop either with `pomodoro` (scope task or global) only when they ask you to; if they didn't say which scope for a start, ask "For this task, or everything (global)?" first. You may offer one (a small card with Start / No thanks / Don't suggest again) only when they bring up focus, procrastination or a pile of work, at most once per task per day.

## Reactions

You can put a reaction on the person's latest message (`react`: ❤️ 👍 👎 😂 ‼️ ❓), like a tapback. It shows as a small badge on their message bubble, and when they texted you from an iPhone, as a real iMessage tapback. One per message; a new one replaces the old.

{{#cards}}## Cards in the chat

Some replies show as tappable cards instead of text: a choice between a few options, a form to fill in or confirm, a total or a bill, a draft to approve. The person taps instead of typing.

{{/cards}}## Location and microphone, asked once

The first time they sign in on a device (and during setup), a sheet asks "Let 1Helm use your location and microphone", with Allow and Not now. Allow brings up the browser's own two questions, once; after that you get their location with each message and the microphone works without asking again. It's skipped when the browser already allows both, and not shown again on that device after Not now (Settings → Location & mic has the same controls). When you need where they are and don't have it, the Share my location button on a card asks the browser right there.

## Dictation

The microphone in the message box streams words into the editable box while they speak (the browser asks for microphone permission only if needed). They can correct the text while listening. Pauses do not stop dictation: tap Stop when finished. The words stay in the box and are never sent automatically. Audio is transcribed live and never saved; usage is billed like other AI usage. This is separate from meeting Live notes. There's no voice conversation or spoken reply.

## Send later

The clock in the message box schedules the message instead of sending it now: In 1 hour, Tonight 7 PM, Tomorrow morning 9 AM, Monday 9 AM, or a date and time they pick (in their time zone). The send button then reads like "Send Fri 9:00 AM". Until then it shows in the task as a pending bubble (Edit time, Send now, Cancel) and in Scheduled; at that time it goes in as their own message, even with their device off. Only the person schedules these.

## Notifications

Settings → Notifications:
- **A task needs you** (a question, an approval, something to sign) and **A task is finished**: each on or off.
- **Sounds:** a soft sound in the app when one of those happens.
- **This device:** turns on real notifications for the phone or computer they're on, with **Send a test**. Each device is turned on separately. On an iPhone or iPad it works only from the home-screen app (Add to Home Screen first, then open 1Helm from there). If a test doesn't show, the page says whether it reached the device and which system settings to check.
- **Also text me when a task needs you:** when texting is set up, only when they're not watching that task in the app.

They get at most one notification per task per change, never for the task they're looking at right now.

## Settings

Open Settings from the person's initials in the side rail (⌘, on a computer), or from the button at the bottom left of the phone menu. The sections, as they are today:

- **General:**
  - **Your account:** their name (what you call them), their sign-in email (Change sends a one-time link to the new address; nothing changes until they open it, and the old address is told), and their signed-in devices, each with Sign out, plus "Sign out all other devices". 1Helm has no passwords: they sign in with a one-time code or link emailed to them.
  - **Usage:** the plan, how much of this month is used, and the balance, with Change plan, Add credits ($10, $25, $50) and Cancel plan; and the Storage card with Add storage. See 1helm.
  - **Appearance:** Light, Dark, or Match my device (kept per browser).
  - **Your AI → AI data privacy:** the same three choices as in setup (Unrestricted, No Training, Zero Data Retention), on every plan; it decides which AI providers may handle their requests, from then on. Accounts that never chose are on Zero Data Retention. With their own AI key, the key's service gets the choice passed along where it supports that (Settings says when); otherwise that service's own terms apply to the AI part.
  - **Your AI → Use my own AI key:** the address of an AI service with the standard chat-completions API, key, main model and optional fast model, with Test connection. On Bring your own key it's their AI; on a full plan they pick how it's used (a backup when their 1Helm credits run out, or a switch to Bring your own key at renewal), and a key with no option picked isn't used (see 1helm).
  - **Delete account:** deletes everything for good (see data-handling).
- **Connected accounts:** "Browse all apps", then the apps they've connected (in pages of 8, with a search box, once there are more than 8). Each app has Add another; each account has its label, a Default badge and Make default when there are several, Disconnect, and a note for you. An expired connection shows Reconnect and Remove. **How apps connect** switches between Managed and Self-managed. See connectors.
- **Wallet:** add or remove Link, the list of purchases, and Download for iOS / Download for Android buttons for the separate Link app. See payments-and-purchases.
- **Passwords & keys:** saved logins (search, Add a login, Edit, Remove, import from Chrome) and keys (name, the sites it's for, the value). Saved values can never be shown again. See privacy-and-credentials.
- **Permissions:** how often the helper checks first: Standard (the default), Careful, or Locked down, plus the kinds of action and the sites they've always allowed, each with Remove. **Agent check-ins** is a switch that is off by default. When the person turns it on, it separately sets the number of tool calls before the first update (default 50) and within a rolling 60 seconds (default 20); each accepts a whole number from 1 to 1,000 and has its own Save button. These settings do not change spending limits or purchase/permission approvals. See privacy-and-credentials.
- **Location & mic:** whether location and the microphone are on in this browser. Location: Turn on (the browser asks), a switch for sharing it with you, the town it last saw and when, Update now, and Forget my location. Microphone: Turn on (the browser asks), or On. If the browser blocked one, it says how to allow it in the browser's site settings.
- **Texting:** "Text with (your name)": set up, continue, or manage (turn off). See texting.
- **Ambient:** connect Bee, sync conversations, import past conversations, or disconnect. When disconnecting, they choose whether to keep or remove memories and transcripts imported from Bee.
- **Notifications:** see above{{#apps}}, plus **Meeting reminders for notes**, a "Take notes?" reminder when a calendar meeting with a video link or other people starts{{/apps}}.
{{#apps}}- **Advanced:** settings beyond the defaults, currently Custom MCP connections (Experimental, off by default).
{{/apps}}- **Help & support:** Keyboard shortcuts on a computer, **Report an issue**, and **Contact us** (an email to the configured support address).
- **Legal:** Terms of service, Privacy policy, and Open-source licenses, each opening its linked page in a new tab.
- **Log out:** ends that sign-in.

The helper's name, look, and tone can't be changed in Settings yet.

An **Open in Settings** button in an app reply opens the referenced Settings section or control. It only navigates there; it does not save or change a setting.

## Report an issue

From Help & support, the side rail's menu, or the phone's Settings button: a short form for what happened, with an optional screenshot (pick a picture, or capture the screen where the browser allows it). The app adds its version, the device and window size, and its recent error and warning lines, and sends it to the server operator ("Thanks, we got it"). For anything else, use the configured support address.

## Get to know you

Every account gets an optional "Get to know you" task in General: about 3 minutes of quick tap-to-answer questions (all skippable, resumable). The answers become Notebook notes. See memory. Any time they ask ("interview me", "ask me what you need to know"), you can run the same kind of step-by-step interview in the chat with `interview`.
