# FX9600 RFID Read & Write

Source repository: https://github.com/st651102064101-design/rfid-read-write-tag.git (`origin`, branch `main`). After cloning on Windows, run `pwsh -File scripts/configure-git.ps1` to configure the default push remote and disable Git Credential Manager prompts for the internal Sites Git host in this checkout.

Sites publication uses its own source repository and a short-lived Bearer credential issued by Sites; never enter or save a username/password for `git.chatgpt-team.site`. The publishing workflow supplies that credential without prompting. A GitHub push alone does not publish this Site: the same commit must also be synchronized, built, saved and deployed through Sites. No automatic GitHub-to-Sites deployment is configured.

Public webhook: POST /rfid/events accepts JSON objects or arrays (up to 1 MB). Events and heartbeat metadata are persisted in D1. The dashboard groups duplicate EPCs, expires absent tags, preserves expanded cards, and shows HEX/ASCII, received memory size, reader details and raw payloads.

Hardware writer: the notebook bridge polls POST /api/bridge/poll using a secret token. Operators queue writes through /api/write and retrieve verified results from /api/write/result. No inbound tunnel is required. Keep reader/start-writer.ps1 running on the notebook. Local reader credentials are DPAPI-encrypted under ignored .sites-runtime and must never be committed. Sites secrets are WRITE_BRIDGE_TOKEN and WRITE_OPERATOR_KEY.

Each command is claimed once. The bridge reads the target region, writes, reads it back, and reports success only when readback matches. It restores the previous reader mode. Uncertain writes are never automatically retried. Queued commands expire after 30 seconds; unanswered results become unknown after 45 seconds.

Supports aligned word writes to USER/EPC/TID/RESERVED only when the chip and lock state permit. EPC CRC/PC changes and EPC resizing are protected. TID/RESERVED require explicit confirmation. Passwords are not written during testing. USER word 0 returned Memory overrun on the tested tag; EPC writes were verified and restored.

Read profile: reader/read-all-mode.json. CUSTOM accessResults order is EPC (including CRC/PC), TID, RESERVED, USER for FX960074AF20 (C4:7D:CC:74:AF:20). The UI maps only the verified reader/profile; unknown access results remain raw.

Build: node scripts/build.mjs
Tests: node --test scripts/test-ui.mjs scripts/test-writer.mjs
Migration generation: node node_modules/drizzle-kit/bin.cjs generate

Reader recovery: run pwsh -File reader/reconnect-reader.ps1 to reload a disconnected HTTP POST gateway without changing its endpoint or radio settings. The command verifies fresh EPC events on the Site; heartbeat alone is not treated as successful tag delivery. Local reader address was updated after its DHCP address changed.

Reader data relay: if the reader cannot resolve the Site hostname through Windows Internet Sharing, run `pwsh -File reader/start-data-relay.ps1`. It forwards JSON batches from the configured reader to the Site over HTTPS. The relay listens on `192.168.137.1:8766`, accepts only the configured reader IP, limits requests to 1 MB, and returns the Site response status. Local reader credentials remain DPAPI-encrypted. The notebook must stay powered on and connected. Current fallback network: Ethernet `192.168.137.1/24`, FX9600 static `192.168.137.10/24`, gateway `192.168.137.1`, DNS `8.8.8.8`. The relay changes only the Tag Data URL; management and radio configuration are preserved.

The relay also receives Management Events at the same local URL, so heartbeats do not depend on reader DNS. On this firmware, Management Events URL changes require disabling the IoT Connector, updating the named HTTP POST endpoint in the reader console, and enabling the connector again; the local REST configuration response alone does not confirm that change. The relay verifies both stored URLs and preserves paused tag reading when applying gateway settings. Known malformed FX9600 accessResults arrays are normalized only after complete JSON validation; unrelated malformed input is rejected with HTTP 400.
