# FX9600 live reader and USER writer

POST /rfid/events accepts JSON objects or arrays up to 1 MB. All fields are stored in D1, including unknown metadata and management events. No hardware reads are initiated by this receiver. Reader firmware and operating mode determine which memory banks and fields are supplied.

GET /api/events returns persisted envelopes newest first, 50 per page, with nextBefore cursor. The browser refreshes the newest page every 3 seconds and can browse older pages. Expanding an event shows all leaf fields and its entire original JSON. EPC buttons populate the existing USER write form. No event data is simulated.

The existing separate write-bridge integration is preserved. Receiving events does not enable hardware writes. The Site remains public as authorized; its received data is visible to visitors.

Build: node scripts/build.mjs
Schema migration generation: node node_modules/drizzle-kit/bin.cjs generate
