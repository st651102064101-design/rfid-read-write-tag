# FX9600 live reader and USER writer

POST /rfid/events accepts JSON objects or arrays up to 1 MB. All fields are stored in D1, including unknown metadata and management events. No hardware reads are initiated by this receiver. Reader firmware and operating mode determine which memory banks and fields are supplied.

GET /api/events returns persisted envelopes newest first, 50 per page, with nextBefore cursor. The browser refreshes the newest page every 3 seconds and can browse older pages. Expanding an event shows all leaf fields and its entire original JSON. EPC buttons populate the existing USER write form. No event data is simulated.

The existing separate write-bridge integration is preserved. Receiving events does not enable hardware writes. The Site remains public as authorized; its received data is visible to visitors.

Build: node scripts/build.mjs
Schema migration generation: node node_modules/drizzle-kit/bin.cjs generate

Reader read-only profile: reader/read-all-mode.json. Verified on FX960074AF20 (MAC C4:7D:CC:74:AF:20) on 2026-10-01. CUSTOM results are EPC (including CRC/PC), TID, RESERVED, USER in this order. The UI maps only this reader and profile timestamps from 05:41:00 UTC. Other CUSTOM results remain in raw JSON. USER word 0 returned memory overrun even with wordCount=1; this does not establish write capability. No tag writes, lock, or kill operations are included. Reader credentials are never stored in the repository.

Writing: /api/write proxies authenticated operator commands to the notebook bridge. WRITE_BRIDGE_URL, WRITE_BRIDGE_TOKEN and WRITE_OPERATOR_KEY are Sites secrets. Run reader/start-writer.ps1 as the same Windows user and keep ngrok forwarding localhost:5051. If the ngrok URL changes, update WRITE_BRIDGE_URL and deploy. Local credentials are DPAPI-encrypted under ignored .sites-runtime; never commit them. Supports aligned word writes to USER/EPC/TID/RESERVED subject to tag capabilities; EPC CRC/PC and EPC resizing are protected. Reads before and after writing, returns success only on matching hardware readback, restores reader mode, caches request IDs for this process, and never automatically retries an uncertain write.
