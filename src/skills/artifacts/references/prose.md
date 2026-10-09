# The words in a document

Read this when the file's value is its text: a PDF or Word document of any name (report, brief, letter, guide, proposal). Decks
have their own copy rules in the presentation reference; spreadsheets have no body copy.

Two things override every rule below:

- **They asked for it.** If they want bullet notes, a conclusion up front, a particular voice, give it to them.
- **It's an edit.** Keep the voice already in the document and change only what they raised. Run the read-back over what you
  changed; if it turns up a problem somewhere you weren't asked to touch, mention it in your reply instead of rewriting it.

## Outline before you write

Write `.src/OUTLINE.md` before the first paragraph of body copy, one entry per section:

```text
Section: Why the pilot stalled
Claim:   sign-ups flattened because onboarding took three weeks, not because of price.
Source:  the weekly sign-up rows they sent (rows 4-11); their message about pricing.
```

The outline is the document's argument. Every section gets a claim. A section with no claim gets cut; two sections with the same
claim get merged. You write the body in pieces, and the outline is what keeps the pieces pointing the same way. The Source line is
a note to yourself and never appears in the document. Keep the outline afterwards: the read-back checks against it, and the next
revision starts from it.

## Headings say the point

Write the finding, not the topic: "Onboarding is where sign-ups leak", not "Onboarding analysis"; "Three suppliers came in under
budget", not "Supplier quotes". Someone who reads only the headings should come away with the argument.

Reference documents are the exception: a manual, catalogue, invoice, form, glossary or CV gets looked up, not read through, so it
uses plain descriptive headings.

- Every heading is backed by its section. A heading the text doesn't prove is worse than a dull one.
- Titles and headings organise the content; they don't repeat the request. "Home battery brief for a non-technical reader" is the
  request, not a title.
- No closing section that restates the document. A summary at the front that gives the findings is welcome.

## Tone that fits the format

- Professional by default: documents get filed, forwarded and handed on. Follow them into a playful, creative or personal register
  when they ask for one.
- Use the voice the format already has: a travel guide sounds like a travel guide, an incident review like an incident review. If
  they share an example or name a style, match it.
- Write for the reader they name, who is often not the person asking: a brief they'll forward to their board is written for the board.
- One language throughout, the language they wrote to you in, unless they asked for more than one.
- Body copy in full sentences. Fragments belong in labels, table cells and list items.
- Spell out an abbreviation the first time, then use the short form.
- Running prose, not stacked keywords: "Two-bedroom flat, Alfama, 1,400 a month, no lift" is a table row; in a paragraph it's a sentence.
- Cut sections that carry nothing, but keep the articles, linking words and explanation a reader needs. Dropped articles and
  unexplained shorthand aren't concise; they're hard to read, most of all for someone new to the subject.

## What never goes on the page

Cite only what a reader can look up: a page, a publication, a document, linked where the format allows. Never cite a tool, a
search you ran, or a file path. Keep off the page:

- How the document was made: which instructions you followed, what an earlier draft said, what you left out, how sure you are of
  your own checks.
- Tool names, file paths, their request quoted back, and material from another task.
- Throat-clearing: "This section will explore", "It is worth noting that", "In conclusion".
- Decoration that carries nothing: tags, status pills, a small label line above every heading.
- Smooth prose over a gap. This is the costliest fault because it reads as the most finished. Say the fact is missing, or leave
  the slot out.

## Read it back

After the content is complete and before you share, in the same pass as the visual checks: for a PDF, read the page text
`readback.py` prints from the rendered file; for a Word file, the text it prints from the .docx. Check it against `.src/OUTLINE.md`:

- Every outlined section is there and delivers the claim it promised.
- No section makes a claim the outline doesn't carry, and nothing rests on a fact with nothing behind it. In a sample or
  planning document, estimates are fine when the page says they're estimates (SKILL.md rule 3).
- No two sections make the same point in different words.
- The headings, read alone and in order, tell the argument.
- The register holds from the first page to the last. A document written in pieces drifts: stiffer, chattier, or into notes halfway.
- Nothing about your process, checks, drafts or tools reached the page.

Fix what fails in the source, rebuild, and read it again. If a fix needs material you don't have, say so in your reply instead of
writing around the gap.
