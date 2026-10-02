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
