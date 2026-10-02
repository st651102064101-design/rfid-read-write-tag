# MC3390R RFID Live & Write

Android APK for Zebra MC3390R, Android 8.1 / API 27. This branch carries the FX9600 interface concept to the handheld: one tag selection list, compact reader controls, transmit-power slider, Text/HEX writes, verification, elapsed milliseconds, and technical details in drawers. All application-owned text is English.

The HTML/CSS/JavaScript interface is bundled offline in an Android WebView. Java talks directly to the integrated reader using Zebra RFID API3 SDK 2.0.4.177 (`SERVICE_SERIAL`). It does not connect to the FX9600 or to the hosted Site. The main branch and its Site deployment remain independent.

## Build

Requirements: JDK 17, Android SDK platform 35 and build tools, and your licensed Zebra RFID SDK 2.0.4.177 split `.aar` files. SDK binaries are deliberately excluded from Git; obtain them from Zebra or your organization's SDK distribution. Do not mix SDK versions.

Set `ZEBRA_RFID_SDK_DIR` to the supplied AAR folder and `ANDROID_HOME` to your Android SDK, or put `sdk.dir` and `zebra.sdk.dir` in ignored `local.properties`. For example:

```powershell
$env:ZEBRA_RFID_SDK_DIR = 'C:\path\to\ZebraSDK\libs'
$env:ANDROID_HOME = 'C:\path\to\Android\Sdk'
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`. Debug signing is for development; production releases need your own signing key. No key or reader password is stored in Git.

On Windows, if Gradle reports `java.net.SocketException: Invalid argument` creating its local daemon socket, use a real directory with a long absolute path for `-Djdk.net.unixdomain.tmpdir` in `JAVA_TOOL_OPTIONS`, then build again. This is a build-host issue, unrelated to RFID connectivity.

## Install without the cradle

Wireless ADB was tested on this Android 8.1 device. Enable USB debugging and authorize the development computer once over USB. Run `adb tcpip 5555`, then `adb connect DEVICE_WIFI_IP:5555`. Use `adb -s DEVICE_WIFI_IP:5555 install -r app/build/outputs/apk/debug/app-debug.apk` for updates over the same Wi-Fi. The handheld can leave the cradle while testing RFID. After development, run `adb -s DEVICE_WIFI_IP:5555 usb` to return ADB to USB mode. Rebooting may require enabling wireless ADB again.

## Use

Install the APK on the MC3390R. Keep Zebra RFID Manager installed and configure the correct regulatory region in the Zebra utility beforehand. This app does not select an arbitrary region automatically. Close other apps that are holding the RFID reader connection.

Valid inventory batches play a 20 ms scan beep at their actual arrival cadence, without a fixed rate limit. Closely spaced tones restart; pending UI callbacks are coalesced so delayed sounds do not accumulate. Beeps follow the device media volume; the physical volume buttons adjust that stream while this app is open. Beeps stop when the app is backgrounded. Memory access and connection setup do not beep.

Connect reader and pull the physical trigger to scan, then select a detected tag once. Choose a memory bank, Text or HEX, and enter data. Readable memory is loaded for the selected tag; observed read length is used as a conservative input limit and is not advertised as the physical chip capacity. Memory bank errors remain visible in Tag information. Write results contain milliseconds for the native operation and total elapsed time. Native reader errors are reported without automatically repeating an uncertain write.

EPC starts at byte 4 to preserve CRC and PC. EPC size is preserved. Odd byte lengths pre-read the final word and preserve its adjacent byte. Sensitive TID/RESERVED writes need explicit confirmation; the reader's permissions and locks still apply. A successful write is followed by a targeted read-back. A partial or unconfirmed operation must be checked before retrying.

Physical power off/on, factory reset, tag kill, and permanent lock operations are not exposed. Releasing the trigger stops inventory. Range controls antenna transmit power in dBm, not guaranteed meters. Backgrounding the app stops inventory and releases the reader when the activity is destroyed.

## Validation

Run the Java unit tests and APK build above. `node --test scripts/test-mobile.mjs` from the repository root tests the offline interface/SDK transport contract. These tests do not establish physical RFID performance. Hardware connection, scanning, trigger events, power read-back and tag writes need a real device and a designated test tag. Record completed hardware checks separately in `VALIDATION.md`.

The supplied project includes a known Android <=9 compatibility fix that sets the SDK's internal `API3Utils.m_scontext` before SERVICE_SERIAL enumeration. The bridge documents this vendor SDK workaround; it is not a simulated reader or substitute SDK.

The scan tone uses 100% application gain and follows the device Media volume without changing system volume. A dedicated DataWedge profile disables barcode input only for this app. Bank reads stop their access session and allow firmware to settle before subsequent reads.

Memory details use an EPC-filtered four-read Access Sequence when supported. Whole-bank reads avoid repeated capacity probes. The access sequence uses session S0 temporarily and restores the previous session. Missing sequence results fall back to targeted reads; RF errors remain visible.
