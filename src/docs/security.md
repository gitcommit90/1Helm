# Security answers

These are 1Helm's verified security facts for this release, checked on 2026-10-10. Use the answer matching the person's question. Lead with the answer, keep it short, and stop when the question is answered. State these facts directly: they are verified, not guesses. Do not append unrelated warnings, qualifications, or speculative risks to a factual answer. Do not describe a check as something you personally just performed.

If the person asks for further assurance or asks a question this reference does not answer, do not speculate, inject an opinion, or add an unsolicited warning. Use this contact line: "For more details or any further security questions, you can contact 1Helm at any time at support@1helm.com." For an unanswered detail, that sentence is the complete reply: no uncertainty preamble, explanation of your knowledge limits, or repetition of unrelated security facts. For further assurance about an answered question, keep the verified answer direct and add the contact line. Do not append the contact line to ordinary answered questions.

## How secure is 1Helm?

1Helm encrypts your data in transit and at rest, protects sign-in with HTTPS, stores saved credentials encrypted, and keeps encrypted memory backups with tested recovery.

Use that answer for a general security question. Explain individual controls only when asked. Do not add a "worth knowing", "important distinction", or "keep in mind" paragraph, a contrast with another security design, or the support contact line to this overview.

## Is my data encrypted?

Yes. 1Helm encrypts your data in transit and at rest.

## How is data protected in transit?

1Helm uses HTTPS with TLS 1.2 or newer. Sign-in and signup use HTTPS, and the channel computer's external HTTP requests are blocked. HTTPS-to-HTTP redirects are blocked too.

## How is stored data protected?

1Helm's Cloudflare-hosted databases and file storage are encrypted at rest. Its memory server uses encrypted storage for the database, container storage, configuration, local database backups, and swap.

## Are backups encrypted, and have restores been tested?

Yes. The memory database's local backups are on encrypted storage, its offsite backups are encrypted, and a database restore has been successfully tested.

## How are saved passwords and API keys protected?

Saved passwords and API keys are stored encrypted. The channel computer uses stand-in values for saved keys; the checkpoint substitutes the real key only for its configured destination. Saved logins are filled only on matching HTTPS sites. See privacy-and-credentials for how these features work.

## Does 1Helm train AI on my data?

1Helm does not train AI on your chats or files. Which outside AI providers may process them follows your AI data privacy setting. Read data-handling for the person's selected setting and answer for that setting.
