# MC3390R validation

Validated on 2026-10-02 with the user's MC3390R, Android 8.1.0 (API 27), Zebra RFID API3 SDK 2.0.4.177 and the integrated SERVICE_SERIAL transport. APK installation and all device checks used wireless ADB. The device reported both AC and USB power disconnected during testing.

## Automated checks

- `gradlew.bat :app:testDebugUnitTest :app:assembleDebug`: successful build, 12 Java unit tests, zero failures/errors (7 write/power tests and 5 scan-sound tests).
- `node --test scripts/test-mobile.mjs`: 23 mobile UI and native transport contract tests passed. These use mock callbacks and are not hardware tests.
- The Java tests cover strict payload validation, EPC CRC/PC protection, sensitive memory confirmation, odd-byte neighbor preservation, exact pre-read requirements, and real serial power-table conversion.

## Physical device checks

| Check | Observed result |
| --- | --- |
| Integrated reader connection | Online after actual SDK inventory START and STOP events. No simulated reader status. |
| Read BOX-006 | EPC `0000000000424F582D303036`; TID `E280689420004026CE01B477`. |
| Memory limits | EPC, TID and RESERVED returned actual data. USER returned no readable memory; the UI blocked USER writes with unknown capacity. |
| Text EPC write | User authorized `TEST006`. UI sent 12 bytes `000000000054455354303036` at byte offset 4, preserving EPC length and PC. Native pre-read and targeted read-back both completed. |
| Text write timing | Reader operation 513 ms; UI total elapsed 620 ms. Reader time includes preparation, writing, verification and restoring reading mode. |
| Independent read after write | EPC `000000000054455354303036`; EPC bank `DD623000000000000054455354303036`; TID unchanged. |
| HEX EPC write | Switched TEST006 from Text to HEX; the complete 12-byte payload stayed identical. A hardware write from stopped inventory read back successfully in 464 ms (UI total 633 ms). |
| UI reading switch | On confirmed, live inventory reported TEST006; off confirmed. |
| UI transmit power slider | 29.7 → 28.7 → 29.7 dBm confirmed through antenna configuration read-back. Inventory resumed during power changes and was stopped after testing. |
| Layout | No horizontal overflow in the actual device WebView. Technical bank results and write details use drawers/disclosures. |
| Background lifecycle | Started actual inventory, pressed Android Home, observed the SDK STOP event, then reopened the app. Connected, reading off, power still 29.7 dBm. |

Original tag contents were saved locally before the write. Test data remains on the designated tag; its displayed name is now TEST006. No other tag was written. No password, TID, lock, kill, reader-region or factory-reset change was performed.

## Issues found and corrected on hardware

- Zebra Demo held the exclusive integrated-reader connection; closing it allowed this app to connect.
- This firmware does not implement `GetPowerState` and an idle stop does not emit a new STOP event. A brief real START → STOP cycle establishes an event-confirmed baseline.
- SERVICE_SERIAL power values are tenths dBm, not the LLRP hundredths scale. The actual table 0–297 maps to 0–29.7 dBm.
- This SDK rejects `WriteRetries=0`. In its serial implementation, 1 is one total attempt; the bridge uses that value and does not automatically repeat an uncertain write. The rejected first attempt left BOX-006 unchanged, confirmed by fresh inventory before the corrected write.
- One HEX attempt returned `RFID_ACCESS_TAG_WRITE_FAILED / access no response from tag`. The app reported an unconfirmed result, without an automatic retry. Inventory was stopped and the complete EPC was read again before an explicit second test, which succeeded. Successful checks do not imply every RF operation will succeed.
- Text/HEX conversion now preserves the complete padded EPC payload; it cannot accidentally move a short name to a different byte range when switching formats.

## Limits of these checks

The designated tag has no readable USER memory. A 256-byte USER write, other chips, TID/RESERVED writes, locked/password-protected tags and a physical trigger press were not hardware-tested here. Java and UI tests verify their validation paths but do not establish physical performance. Physical device power on/off and destructive reset/kill/lock controls are not part of this app.

## Scan sound update (1.0.1)

Installed versionCode 2 over Wi-Fi on 2026-10-02. Actual SDK inventory and handheld-trigger events were observed with live tag data. Debug logs confirmed successful native ToneGenerator starts spaced approximately 300 ms apart; Android AudioFlinger showed this app's STREAM_MUSIC AudioTrack rendering frames to the speaker output. The device's existing volume/mute values were not changed. This confirms the native playback path; subjective audibility is being checked with the user.

Five unit tests cover valid complete-byte EPCs, empty/invalid batches, the 300 ms boundary, inactive/lifecycle suppression, monotonic clock validation and no accumulated sounds after long gaps. Queued sound callbacks are invalidated on inventory stop, memory access, disconnect, backgrounding and disposal. Audio runs on the main thread; the SDK callback never waits for sound playback. No physical tag write was performed for this audio update.

## Version 1.0.3 — physical trigger controls
Removed the Tag reading switch and its polling from the MC3390R UI. All 23 mobile tests pass; APK build succeeds. Installed over Wi-Fi on the MC3390R: SDK connected, switch absent, antenna power remains 6.8 dBm, and no horizontal overflow. Native trigger handling, scan sound and portrait lock are unchanged.


## Version 1.0.4 — scan cadence
Removed the 300 ms beep rate limit. Each delivered valid inventory batch requests a 20 ms tone; pending callbacks coalesce and stale/background/access events remain suppressed. Java unit tests pass (12 total), including 101 events spaced 30 ms apart and faster consecutive events. APK built and installed successfully over Wi-Fi. Actual acoustic 30 ms cadence is not yet measured on hardware.


## Version 1.0.5 — complete bank reads
Hardware reproduced access sessions stuck with Operation In Progress. Read sessions now call SDK stopAccess after each attempt and retry busy reads up to three times; writes are never retried. On actual BOX-003, EPC C06630000000000000424F582D303033, TID E280119120006D28D1770346000000000000 and RESERVED 0000000000000000 were returned. USER reported no readable memory. Details requests memory directly and refreshes the open drawer. Inventory retains SDK antenna/PC/CRC/seenCount. 25 mobile tests and 15 Java tests pass; APK build succeeds.


## Version 1.0.6 — sound gain and RFID-only input
ToneGenerator gain is now 100% of Media stream volume; no system volume is changed. Dedicated MC3390R_RFID_ONLY DataWedge profile disables barcode input for this package. Device returned RFID_ONLY_PROFILE SUCCESS. Unit tests pass (15 Java, 25 mobile), APK built and installed. Subjective loudness needs user confirmation. Subsequent bank reads returned access failures for the old targets; further hardware verification is pending a fresh scan. Earlier BOX-003 TID/RESERVED success does not establish reliable reads for all tags.


## Version 1.0.7 — targeted reads verified
Using SDK readWait with EPC prefilter enabled resolved bank access on the currently inventoried E2806F12000000022DF13118 tag. Actual read returned EPC 28273000E2806F12000000022DF13118, TID E2806F12200094022DF13118, USER 256 bytes and RESERVED 0000000000000000, no readableErrors, 7306 ms. Temporary transmit power test restored the original setting; successful full read was at the user's 2.9 dBm setting. Memory results retain the original inventory timestamp and are excluded from scan counts. All 26 mobile tests pass.


## Version 1.0.8 — fast complete memory reads
Actual reader reports access sequence capacity 10. Enabled access reports, retained tags on inventory stop, set a 512-byte report buffer, applied full EPC mask, and used a temporary S0 session with restoration. Removed capacity probing in favor of whole-bank reads. Final repeated hardware reads of E2806F12000000022DF13118 completed in 413, 371 and 358 ms, each returning EPC 16 bytes, TID E2806F12200094022DF13118 (12 bytes), USER 256 bytes and RESERVED 8 bytes with no errors. Earlier sequential baseline was 7306 ms; timing is specific to this device/tag/setup. All 26 mobile and 15 Java tests pass. SDK remains 2.0.4.177; upgrading was not required for this verified improvement.
DataWedge profile updates now handle existing app association and use the supported plugin list format. Device confirmed RFID_ONLY_PROFILE SUCCESS; SDK's additional disable request reports PLUGIN_DISABLED, consistent with barcode already disabled.


## Version 1.0.9 — targeted writes and bank validation
Enabled SDK EPC prefilter for writes; TID prefilter is used only for EPC renames. Frontend now requires explicit TID/RESERVED confirmation and validates the 8-digit HEX access password before enabling submission. All 31 mobile tests and 18 Java tests pass; debug APK builds and is installed on MC3390R over Wi-Fi.

Physical USER test on E2806F12000000022DF13118: TEST006 (7 bytes, offset 0) returned verified success in 1180 ms. Read-back was 5445535430303672: the adjacent original byte 72 was preserved. Original USER data was backed up before the test. Restoration initially reported ACCESS_TAG_WRITE_FAILED with no response; subsequent read showed a partial write. After inspecting that actual data, only differing word at byte offset 6 was restored to 6572, verified in 1101 ms. Final complete read returned EPC 16 bytes, TID 12 bytes, USER 256 bytes and RESERVED 8 bytes without errors; USER matched the original backup. An intermediate read had ACCESS_TAG_CRC_ERROR. RF response remains intermittent; no automatic write retry or fabricated success is used.

TID/RESERVED/EPC writes are covered by unit tests for validation, bank targeting, passwords, odd-byte preservation, read-back mismatch and unconfirmed errors. Physical modifications in those banks were not performed; unit tests do not establish that a factory-locked TID is writable.


## Version 1.0.10 — rapid inventory and full USER write planning
Disabled unique-tag suppression and selected Gen2 session S0 at connection. A two-second continuous physical inventory on the MC3390R returned 355 reports across 9 unique EPCs (about 177 reports/second), with zero SDK buffer-full events. Delivery coalesces SDK notifications, drains bounded batches on the SDK executor, preserves every SDK seen count and updates existing UI cards instead of rebuilding them.

Access-sequence START/STOP events are now excluded from trigger inventory state unless an explicit inventory command is pending. Physical logs confirmed that a memory read no longer leaves the app falsely stuck in reading state after trigger release.

USER payloads up to the observed bank limit are split into 8-byte Gen2 writes and each chunk is read back before the next chunk.

Root cause of failed full USER writes: near-field saturation. A power sweep of identical 8-byte USER writes on E2806F12000000022DF13118 succeeded at 10, 15 and 20 dBm, returned CRC error at 24 and 27 dBm, and no response at 29.7 dBm. USER writes now temporarily use min(configured, 20) dBm, stepping to 15 and 10 dBm on failure, remember the last verified write power for the session, and restore the configured power afterwards. Because a USER rewrite of a fixed range is idempotent, a chunk is re-sent (up to 4 attempts) only after its read-back proves it is not yet correct. EPC, TID and RESERVED writes are still never retried.

Chunk size was measured: 32-byte chunks succeeded in 1 of 10 full writes (tag lost mid-command; each failure reported verified partial bytes). 8-byte chunks were used for the final configuration.

Physical stability results (256-byte USER, a distinct pattern per cycle, independent full-bank read after each write):
- 10/10 full writes verified (≈25–27 s each) with the initial step-down ladder.
- 20/20 full writes verified (22–32 s each, 0–14 chunk retries) with the final configuration, starting from a fresh app session.
- 6/6 further full writes verified with configured and actual reader power confirmed at 27 dBm after every write and every read.
- Original USER contents were backed up before testing and written back at the end; full read-back matched exactly.

During the 20-cycle run, the in-app power read 29.7 dBm afterwards; this was not reproduced in the instrumented 6-cycle run, where the restore to 27 dBm was confirmed each cycle. Diagnostics now report the reader's actual transmit power (`readerPowerDbm`).

All Java tests pass, including the one-million-report pipeline test, 256-byte write planning and the power step-down order. The debug APK builds, installs and connects on the physical MC3390R.


### 2026-10-05: final rapid inventory validation (1.0.10)

- Compared all 19 supported RF modes at fixed 27 dBm, then repeated the top candidates three times. Mode 21 was consistently faster than modes 8 and 24 in the repeated comparison. Selected S0, AB flip and population 32; unsupported readers retain their existing RF mode.
- Installed the final APK over Wi-Fi. Three 10-second scans measured **228.40, 230.69 and 227.23 inventory reports/second**, compared with 102.36 reports/second for the same-day mode 0/S0/A/population 16 baseline (about 2.2x). These are repeat reports from nearby stationary tags, not unique tags/second or full-memory reads/second.
- Final scans delivered exactly 2301/2327/2289 SDK reports to the interface. Each scan had one inventory start, zero memory requests, zero buffer-full events and zero delivery overflow; stop commands succeeded.
- Read actual EPC, TID, USER and RESERVED on designated E2806F12000000022DF13118 in 436 ms with no bank errors. The complete scan profile remained S0/AB/32/mode 21 before and after. Value snapshots prevent SDK access filtering from retaining the mutated inventory state after memory access or writes. No tag data was modified during these speed checks.
- Java **28/28** and interface **36/36** tests passed; debug APK assembled successfully. Load tests preserve one million Java reports across 1000 tags and 100000 interface reports; they prove software count preservation and scheduling, not a universal physical maximum.
- Reproducible measurements: `benchmarks/2026-10-05-scan.json`. This is the fastest consistently verified setup among the tested configurations in these conditions; tag placement and RF conditions can change the rate.


### Selected USER reset and scan ranking

- Reset dialog requires explicit unchecked-by-default tag checkboxes and at least one selection. The submitted target snapshot contains only checked EPCs.
- Completion closes the dialog and emits a success alert only when every selected tag is verified; skipped, failed, uncertain or stopped operations emit an incomplete alert.
- Live cards reorder by descending cumulative read count, with latest observation and EPC as tie-breakers. Reused cards move when rankings change.
- Interface tests: 38/38 passed, including selected-target isolation, successful/failed completion and card reorder; Java tests: 28/28 passed.
- Hardware reset verification initially blocked by RFID_CHARGING_COMMAND_NOT_ALLOWED. No tag changes occurred in that blocked attempt.
