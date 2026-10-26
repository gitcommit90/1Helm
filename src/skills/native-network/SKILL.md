---
name: native-network
description: Use when connecting to a server with SSH or SFTP, sharing your computer SSH public key, or joining or leaving a native Tailscale network.
always: false
---
# Native SSH and Tailscale

Read the `ssh` reference for SSH/SFTP or the `tailscale` reference for private reachability. Inspect actual state with `native_network` operation `status` before claiming readiness. An unavailable deployment has no usable native transport; do not promise a connection or try a shell workaround.

Check status before negative claims too: never say “not signed in”, “not connected” or “public addresses only” from memory or without a current result. Unchecked, sleeping, reconnecting and timed-out states are unknown, not proof of logout. Report uncertainty and inspect once; do not invent a propagation delay or ask for duplicate enrollment. A successfully prepared tailnet SSH request contradicts a claim that no tailnet membership exists, although it is not proof of SSH authentication until the approved session opens.

SSH runs from this channel's 1HC computer through an isolated, platform-managed transport. It does not run on the person's Mac or phone. The platform transport holds this computer's distinct identity and network connection. Arbitrary programs in the computer cannot read its private key or use its Tailscale sockets.

Only Primary has these tools. Workers (sub-agents) do not, and the computer's shell cannot reach tailnet addresses or port 22 (only web traffic leaves it), so run_command, curl, ssh clients and libraries such as paramiko cannot do this job. Do not probe SSH or the tailnet from the shell, and do not install SSH software. Check `native_network` status first, on every request including a retry after the person says a step is done. When `ssh_connect` returns setup_needed, show the person a card in the chat that links to the settings_link page (Settings, Computer connections) with the returned steps in plain words, then end the turn.

Use only `native_network`, `ssh_connect`, and `ssh_session` for this feature. Never ask for passwords, existing private keys, Tailscale API keys, or reusable enrollment keys in chat. Sharing your own public SSH key is safe. Native Tailscale enrollment is different from a Composio Tailscale management API connection.

An approval authorizes remote commands and SFTP within one SSH session. It does not sandbox the remote account or control what its commands can do on the remote network. Do not describe a session approval as approval of only one command.

The separate SSH setting supports Deny, Ask each time, and Allow trusted servers. The last option permits automatic reconnect only to explicitly remembered, still-matching servers on this computer; it does not grant spending or general app permissions. Read the SSH reference for scope, host-key verification and revocation. Always call `ssh_connect` for a new transport; do not assume an old session remains usable.
