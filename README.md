# FX9600 RFID Read & Write

Public webhook: POST /rfid/events accepts JSON objects or arrays (up to 1 MB). Events and heartbeat metadata are persisted in D1. The dashboard groups duplicate EPCs, expires absent tags, preserves expanded cards, and shows HEX/ASCII, received memory size, reader details and raw payloads.

Hardware writer: the notebook bridge polls POST /api/bridge/poll using a secret token. Operators queue writes through /api/write and retrieve verified results from /api/write/result. No inbound tunnel is required. Keep reader/start-writer.ps1 running on the notebook. Local reader credentials are DPAPI-encrypted under ignored .sites-runtime and must never be committed. Sites secrets are WRITE_BRIDGE_TOKEN and WRITE_OPERATOR_KEY.

Each command is claimed once. The bridge reads the target region, writes, reads it back, and reports success only when readback matches. It restores the previous reader mode. Uncertain writes are never automatically retried. Queued commands expire after 30 seconds; unanswered results become unknown after 45 seconds.

Supports aligned word writes to USER/EPC/TID/RESERVED only when the chip and lock state permit. EPC CRC/PC changes and EPC resizing are protected. TID/RESERVED require explicit confirmation. Passwords are not written during testing. USER word 0 returned Memory overrun on the tested tag; EPC writes were verified and restored.

Read profile: reader/read-all-mode.json. CUSTOM accessResults order is EPC (including CRC/PC), TID, RESERVED, USER for FX960074AF20 (C4:7D:CC:74:AF:20). The UI maps only the verified reader/profile; unknown access results remain raw.

Build: node scripts/build.mjs
Tests: node --test scripts/test-ui.mjs scripts/test-writer.mjs
Migration generation: node node_modules/drizzle-kit/bin.cjs generate
