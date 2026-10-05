package com.kriangkrai.rfid;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.zebra.rfid.api3.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** SDK calls and access operations share one executor; SDK events never wait on it. */
public final class RfidBridge {
    // Measured on MC3390R: 16-word writes lose the tag mid-command; 4-word writes are stable.
    private static final int USER_WRITE_CHUNK_WORDS = 4;
    private static final int USER_CHUNK_ATTEMPTS = 4;
    private static final long TAG_WAIT_MS = 30000;
    // First 6 TID words: class, mask designer, model and the 48-bit serial that makes the chip unique.
    private static final int TID_SCAN_WORDS = 6;
    private volatile boolean tidScan = true;
    private volatile boolean tidInventoryActive;
    private final Context context;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final InventoryBatch inventoryBatch = new InventoryBatch();
    private final InventoryPump inventoryPump = new InventoryPump(executor, this::drainInventory);
    private final AtomicBoolean deliveryPending = new AtomicBoolean();
    private final AtomicInteger bufferWarnings = new AtomicInteger();
    private final AtomicInteger bufferFull = new AtomicInteger();
    private final AtomicInteger inventoryStarts = new AtomicInteger();
    private final AtomicInteger bankRequests = new AtomicInteger();
    private final Object inventoryMonitor = new Object();
    private final LinkedHashMap<String, Completed> completed = new LinkedHashMap<>();
    private final ScanBeepGate beepGate = new ScanBeepGate();
    private final AtomicBoolean beepPending = new AtomicBoolean();
    private final AtomicInteger beepEpoch = new AtomicInteger();
    private final boolean debugBuild;
    // Created, used, stopped, and released only on the main thread.
    private ToneGenerator scanTone;
    private Readers readers;
    private volatile RFIDReader reader;
    private final EventHandler events = new EventHandler();
    private volatile boolean reading;
    private volatile boolean readingKnown;
    private volatile boolean initialized;
    private volatile boolean connectionLost;
    private volatile boolean foreground = true;
    private volatile boolean disposed;
    private volatile boolean accessing;
    private volatile boolean inventoryCommandPending;
    private boolean continuousReading;
    private boolean barcodeMode;
    private final TriggerLatch triggerLatch = new TriggerLatch();
    private int[] powerValues;
    private volatile Double powerDbm;
    private Double lastUserWritePower;
    private volatile String message = "Connect the integrated RFID reader";
    private boolean powerStateSupported = true;
    private String powerStateDiagnostic = "Not queried";

    RfidBridge(Context context, WebView web) {
        this.context = context;
        this.web = web;
        debugBuild = (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }
    void pageReady() { emitState(); }
    void resume() { foreground = true; if (!disposed) emitState(); }

    @JavascriptInterface public void command(String requestId, String operation, String json) {
        if (disposed) return;
        if (requestId == null || !requestId.matches("[A-Za-z0-9-]{8,80}") || operation == null
                || json == null || json.length() > 16384) {
            reply(requestId == null ? "" : requestId, failure("Invalid native request", false));
            return;
        }
        executor.execute(() -> {
            if (disposed) return;
            String signature = operation + "\n" + json;
            Completed previous = completed.get(requestId);
            if (previous != null) {
                reply(requestId, previous.signature.equals(signature) ? previous.result
                        : failure("Request ID already used for another command", false));
                return;
            }
            long started = SystemClock.elapsedRealtime();
            JSONObject result;
            try {
                if (!foreground) throw new IllegalStateException("Return to the app before operating the reader");
                JSONObject payload = new JSONObject(json);
                switch (operation) {
                    case "connect": result = connect(); break;
                    case "reading":
                        if (!(payload.opt("enabled") instanceof Boolean)) throw new IllegalArgumentException("Invalid reading state");
                        boolean requestedReading = payload.getBoolean("enabled");
                        setReading(requestedReading);
                        continuousReading = requestedReading;
                        result = success().put("reading", reading);
                        break;
                    case "scannerMode":
                        String mode = payload.getString("mode");
                        if (!mode.equals("barcode") && !mode.equals("rfid")) throw new IllegalArgumentException("Invalid scanner mode");
                        RFIDReader modeReader = requireReader();
                        barcodeMode = mode.equals("barcode");
                        if (reading) setReading(false);
                        continuousReading = false;
                        modeReader.Config.setTriggerMode(mode.equals("barcode") ? ENUM_TRIGGER_MODE.BARCODE_MODE : ENUM_TRIGGER_MODE.RFID_MODE, true);
                        barcodeMode = mode.equals("barcode");
                        result = success().put("scannerMode", mode);
                        break;
                    case "scanTid":
                        if (!(payload.opt("enabled") instanceof Boolean)) throw new IllegalArgumentException("Invalid TID scan state");
                        boolean resumeScan = reading;
                        if (resumeScan) setReading(false);
                        tidScan = payload.getBoolean("enabled");
                        if (resumeScan) setReading(true);
                        result = success().put("tidScan", tidScan);
                        break;
                    case "power": result = setPower(payload.getDouble("powerDbm")); break;
                    case "banks": result = banks(payload); break;
                    case "scanDiagnostics": result = scanDiagnostics(); break;
                    case "scanConfig":
                        if (!debugBuild) throw new IllegalArgumentException("Benchmark configuration requires a debug build");
                        result = scanConfig(payload); break;
                    case "write": result = write(payload); break;
                    default: throw new IllegalArgumentException("Unsupported reader command");
                }
            } catch (Exception error) {
                if (operation.equals("connect")) releaseReader();
                result = failure(explain(error), false);
                message = explain(error);
            }
            try { result.put("requestId", requestId).put("durationMs", SystemClock.elapsedRealtime() - started); }
            catch (JSONException ignored) { }
            completed.put(requestId, new Completed(signature, result));
            while (completed.size() > 64) completed.remove(completed.keySet().iterator().next());
            emitState();
            reply(requestId, result);
        });
    }

    private JSONObject connect() throws Exception {
        if (reader != null && reader.isConnected() && initialized && !connectionLost) return success().put("connected", true);
        message = "Connecting to integrated reader";
        emitState();
        releaseReader();
        patchLegacyContext();
        readers = new Readers(context, ENUM_TRANSPORT.SERVICE_SERIAL);
        ArrayList<ReaderDevice> devices = readers.GetAvailableRFIDReaderList();
        if (devices == null || devices.isEmpty()) {
            throw new IllegalStateException("Integrated MC3390R reader not found. Close other RFID apps and reconnect.");
        }
        reader = devices.get(0).getRFIDReader();
        // Region is owned by the device administrator; never pick a country automatically.
        reader.connect();
        if (!reader.isConnected()) throw new IllegalStateException("Reader connection was not confirmed");
        connectionLost = false;
        reader.Events.addEventsListener(events);
        reader.Events.setTagReadEvent(true);
        reader.Events.setAttachTagDataWithReadEvent(false);
        reader.Events.setInventoryStartEvent(true);
        reader.Events.setInventoryStopEvent(true);
        reader.Events.setHandheldEvent(true);
        reader.Events.setReaderDisconnectEvent(true);
        reader.Events.setBufferFullEvent(true);
        reader.Events.setBufferFullWarningEvent(true);
        TriggerInfo trigger = new TriggerInfo();
        trigger.StartTrigger.setTriggerType(START_TRIGGER_TYPE.START_TRIGGER_TYPE_IMMEDIATE);
        trigger.StopTrigger.setTriggerType(STOP_TRIGGER_TYPE.STOP_TRIGGER_TYPE_IMMEDIATE);
        reader.Config.setStartTrigger(trigger.StartTrigger);
        reader.Config.setStopTrigger(trigger.StopTrigger);
        reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.RFID_MODE, true);
        barcodeMode = false;
        reader.Config.setAccessOperationWaitTimeout(1500);
        TagStorageSettings storage = reader.Config.getTagStorageSettings();
        storage.enableAccessReports(true);
        storage.discardTagsOnInventoryStop(false);
        storage.setMaxMemoryBankByteCount(512);
        storage.setTagFields(new TAG_FIELD[]{TAG_FIELD.ANTENNA_ID, TAG_FIELD.PEAK_RSSI, TAG_FIELD.TAG_SEEN_COUNT, TAG_FIELD.PC, TAG_FIELD.CRC});
        reader.Config.setTagStorageSettings(storage);
        // Stream repeat observations instead of retaining one unique record per EPC.
        reader.Config.setUniqueTagReport(false);
        if (reader.Config.getUniqueTagReport() != UNIQUE_TAG_REPORT_SETTING.DISABLE)
            throw new IllegalStateException("Reader did not confirm repeated tag reporting");
        Antennas.SingulationControl scanControl = reader.Config.Antennas.getSingulationControl(1);
        scanControl.setSession(SESSION.SESSION_S0);
        scanControl.Action.setInventoryState(INVENTORY_STATE.INVENTORY_STATE_AB_FLIP);
        scanControl.setTagPopulation((short)32);
        reader.Config.Antennas.setSingulationControl(1, scanControl);
        // Mode 21 was the most consistent in repeated physical comparisons on this MC3390R; select its identifier,
        // not its position in the mode table. Unsupported devices keep their RF mode.
        boolean rapidModeSupported = false;
        for (int i = 0; i < reader.ReaderCapabilities.RFModes.Length(); i++) {
            RFModeTable table = reader.ReaderCapabilities.RFModes.getRFModeTableInfo(i);
            for (int j = 0; j < table.length(); j++)
                if (table.getRFModeTableEntryInfo(j).getModeIdentifer() == 21) rapidModeSupported = true;
        }
        if (rapidModeSupported) {
            Antennas.AntennaRfConfig rapidRf = reader.Config.Antennas.getAntennaRfConfig(1);
            rapidRf.setrfModeTableIndex(21);
            reader.Config.Antennas.setAntennaRfConfig(1, rapidRf);
            if (reader.Config.Antennas.getAntennaRfConfig(1).getrfModeTableIndex() != 21)
                throw new IllegalStateException("Reader did not confirm rapid RF mode");
        }
        powerValues = reader.ReaderCapabilities.getTransmitPowerLevelValues();
        refreshPower();
        // Old MC3390R firmware has no GetPowerState command and emits no event for an
        // idle stop. A brief real start/stop establishes both transitions from SDK events.
        readingKnown = false;
        setReading(true);
        setReading(false);
        initialized = true;
        message = "Connected";
        return success().put("connected", true);
    }

    /** SDK 2.0.4.177 transport checks this otherwise unset field on Android <= 9. */
    private void patchLegacyContext() throws Exception {
        Field field = Class.forName("com.zebra.rfid.api3.API3Utils").getDeclaredField("m_scontext");
        field.setAccessible(true);
        field.set(null, context.getApplicationContext());
    }

    private RFIDReader requireReader() {
        RFIDReader connected = reader;
        if (connected == null || !connected.isConnected() || connectionLost) throw new IllegalStateException("Connect the reader first");
        return connected;
    }

    private void setReading(boolean enabled) throws Exception {
        RFIDReader rd = requireReader();
        if (enabled && !foreground) throw new IllegalStateException("Reader cannot start while the app is in the background");
        synchronized (inventoryMonitor) {
            if (readingKnown && reading == enabled) return;
        }
        inventoryCommandPending = true;
        try {
            setReadingConfirmed(rd, enabled);
        } finally {
            inventoryCommandPending = false;
        }
    }

    /** Inventory that also reads each tag's TID, so tags sharing an EPC are reported separately. */
    private void startTidInventory(RFIDReader rd) throws Exception {
        TagAccess.Sequence sequence = rd.Actions.TagAccess.OperationSequence;
        sequence.deleteAll();
        TagAccess.Sequence.Operation readTid = sequence.new Operation();
        readTid.setAccessOperationCode(ACCESS_OPERATION_CODE.ACCESS_OPERATION_READ);
        readTid.ReadAccessParams.setMemoryBank(MEMORY_BANK.MEMORY_BANK_TID);
        readTid.ReadAccessParams.setOffset(0);
        readTid.ReadAccessParams.setCount(TID_SCAN_WORDS);
        readTid.ReadAccessParams.setAccessPassword(0);
        sequence.add(readTid);
        tidInventoryActive = true;
        sequence.performSequence();
    }

    private void stopTidInventory(RFIDReader rd) throws Exception {
        try { rd.Actions.TagAccess.OperationSequence.stopSequence(); }
        finally {
            tidInventoryActive = false;
            try { rd.Actions.TagAccess.OperationSequence.deleteAll(); } catch (Exception ignored) { }
        }
    }

    private void setReadingConfirmed(RFIDReader rd, boolean enabled) throws Exception {
        try {
            if (enabled && tidScan) startTidInventory(rd);
            else if (enabled) rd.Actions.Inventory.perform();
            else if (tidInventoryActive) stopTidInventory(rd);
            else rd.Actions.Inventory.stop();
        } catch (OperationFailureException error) {
            if (!enabled && error.getResults() == RFIDResults.RFID_NO_INVENTORY_IN_PROGRESS) {
                synchronized (inventoryMonitor) { reading = false; readingKnown = true; inventoryMonitor.notifyAll(); }
                return;
            }
            if (!(enabled && (error.getResults() == RFIDResults.RFID_INVENTORY_IN_PROGRESS
                    || error.getResults() == RFIDResults.RFID_OPERATION_IN_PROGRESS))) throw error;
        }
        long until = SystemClock.elapsedRealtime() + 3000;
        while (true) {
            synchronized (inventoryMonitor) { if (readingKnown && reading == enabled) return; }
            if (!rd.isConnected() || connectionLost) throw new IllegalStateException("Reader disconnected during inventory change");
            // An already idle MC3390R can acknowledge stop without emitting a transition event.
            // Read the RF state from the reader; a command acknowledgement alone is never sufficient.
            if (powerStateSupported) {
                try {
                    READER_POWER_STATE power = rd.Config.getReaderPowerState();
                    powerStateDiagnostic = String.valueOf(power);
                    Boolean actual = power == READER_POWER_STATE.POWER_STATE_RF_ACTIVE ? Boolean.TRUE
                            : power == READER_POWER_STATE.POWER_STATE_ACTIVE
                            || power == READER_POWER_STATE.POWER_STATE_STANDBY
                            || power == READER_POWER_STATE.POWER_STATE_OFF ? Boolean.FALSE : null;
                    if (actual != null && actual == enabled) {
                        synchronized (inventoryMonitor) {
                            reading = actual;
                            readingKnown = true;
                            inventoryMonitor.notifyAll();
                        }
                        return;
                    }
                } catch (OperationFailureException | InvalidUsageException unavailable) {
                    powerStateSupported = false;
                    powerStateDiagnostic = explain(unavailable);
                    Log.i("MC3390R.Rfid", "RF-state getter unavailable: " + powerStateDiagnostic);
                }
            }
            long remaining = until - SystemClock.elapsedRealtime();
            if (remaining <= 0) {
                Log.w("MC3390R.Rfid", "Inventory confirmation timed out: requested=" + enabled
                        + ", readingKnown=" + readingKnown + ", reading=" + reading
                        + ", powerState=" + powerStateDiagnostic);
                throw new IllegalStateException("SDK did not confirm inventory " + (enabled ? "start" : "stop") + "; check the reader");
            }
            synchronized (inventoryMonitor) {
                if (!readingKnown || reading != enabled) inventoryMonitor.wait(Math.min(remaining, 150));
            }
        }
    }

    private void refreshPower() throws Exception {
        RFIDReader rd = requireReader();
        if (powerValues == null || powerValues.length == 0) throw new IllegalStateException("Reader power levels unavailable");
        int index = rd.Config.Antennas.getAntennaRfConfig(1).getTransmitPowerIndex();
        if (index < 0 || index >= powerValues.length) throw new IllegalStateException("Invalid reader power index");
        powerDbm = WritePolicy.serialPowerDbm(powerValues[index]);
    }

    private void applyPower(RFIDReader rd, double dbm) throws Exception {
        Exception last = null;
        for (int attempt = 0; attempt < 4; attempt++) {
            try {
                if (attempt > 0) Thread.sleep(200);
                stopAccessQuietly();
                Antennas.AntennaRfConfig config = rd.Config.Antennas.getAntennaRfConfig(1);
                config.setTransmitPowerIndex(WritePolicy.powerIndex(powerValues, dbm));
                rd.Config.Antennas.setAntennaRfConfig(1, config);
                refreshPower();
                if (Math.abs(powerDbm - dbm) > 0.00001) throw new IllegalStateException("Reader did not confirm the selected transmit power");
                return;
            } catch (Exception error) {
                last = error;
                if (!accessBusy(error) || attempt == 3) throw error;
            }
        }
        throw last;
    }

    private JSONObject setPower(double dbm) throws Exception {
        RFIDReader rd = requireReader();
        int index = WritePolicy.powerIndex(powerValues, dbm);
        boolean resume = reading;
        accessing = true;
        beepEpoch.incrementAndGet();
        JSONObject result;
        try {
            if (resume) setReading(false);
            Antennas.AntennaRfConfig config = rd.Config.Antennas.getAntennaRfConfig(1);
            config.setTransmitPowerIndex(index);
            rd.Config.Antennas.setAntennaRfConfig(1, config);
            refreshPower();
            if (Math.abs(powerDbm - dbm) > 0.00001) throw new IllegalStateException("Reader did not confirm the selected transmit power");
            result = success().put("powerDbm", powerDbm);
        } finally {
            try { if (((resume && continuousReading) || triggerLatch.wantsInventory(barcodeMode, foreground, disposed)) && foreground) setReading(true); }
            finally { accessing = false; }
        }
        message = "Connected";
        return result;
    }

    private JSONObject banks(JSONObject payload) throws Exception {
        RFIDReader rd = requireReader();
        // A UI timer must never interrupt continuous trigger inventory.
        if (triggerLatch.held() || reading || continuousReading) throw new IllegalStateException("Release the trigger before reading tag memory");
        bankRequests.incrementAndGet();
        String epc = WritePolicy.hex(payload.getString("epc"), false);
        if (epc.length() % 4 != 0 || epc.length() > 124) throw new IllegalArgumentException("Invalid Gen2 EPC");
        String passwordText = payload.optString("accessPassword", "");
        if (!passwordText.isEmpty() && !passwordText.matches("[A-Fa-f0-9]{8}")) throw new IllegalArgumentException("Access password must be 8 HEX digits");
        long password = WritePolicy.password(passwordText);
        SingulationSnapshot scanProfile = new SingulationSnapshot(rd.Config.Antennas.getSingulationControl(1));
        boolean resume = reading;
        accessing = true;
        beepEpoch.incrementAndGet();
        JSONObject values = new JSONObject(), errors = new JSONObject();
        Double scanPower = powerDbm;
        try {
            if (resume) setReading(false);
            waitUntilAccessIdle();
            JSONArray only = payload.optJSONArray("banks");
            if (only != null && scanPower != null && powerValues != null) {
                // A tag that is silent at full power up close is retried at lower levels before giving up.
                List<Double> levels = WritePolicy.userWritePowers(scanPower, powerValues);
                levels.remove(Double.valueOf(WritePolicy.maxSupportedDbm(powerValues)));
                levels.add(0, scanPower);
                int[] step = {0};
                try {
                    String first = only.toString().contains("\"TID\"") ? "TID" : null;
                    if (first != null) { values.put("TID", readStepping(rd, epc, "TID", 0, 0, password, levels, step)); errors.remove("TID"); }
                } catch (Exception error) { errors.put("TID", explain(error)); }
            }
            for (String bank : new String[]{"EPC", "TID", "USER", "RESERVED"}) {
                if (values.has(bank) || errors.has(bank)) continue;
                if (only != null && !only.toString().contains("\"" + bank + "\"")) continue;
                try {
                    String data;
                    if (bank.equals("EPC")) data = read(epc, bank, 0, epc.length() / 4 + 2, password);
                    else if (bank.equals("RESERVED")) data = read(epc, bank, 0, 4, password);
                    else data = read(epc, bank, 0, 0, password);
                    values.put(bank, data); errors.remove(bank);
                } catch (Exception error) { errors.put(bank, explain(error)); }
            }
        } finally {
            releaseAccess();
            try {
                if (scanPower != null && powerDbm != null && Math.abs(powerDbm - scanPower) > 0.00001) applyPower(rd, scanPower);
            } catch (Exception error) { message = "Transmit power could not be restored: " + explain(error); }
            try { scanProfile.restore(rd); if (((resume && continuousReading) || triggerLatch.wantsInventory(barcodeMode, foreground, disposed)) && foreground) setReading(true); }
            finally { accessing = false; }
        }
        return success().put("epc", epc).put("banks", values).put("readableErrors", errors);
    }

    private MEMORY_BANK memoryBank(String bank) {
        switch (bank) {
            case "EPC": return MEMORY_BANK.MEMORY_BANK_EPC;
            case "TID": return MEMORY_BANK.MEMORY_BANK_TID;
            case "USER": return MEMORY_BANK.MEMORY_BANK_USER;
            case "RESERVED": return MEMORY_BANK.MEMORY_BANK_RESERVED;
            default: throw new IllegalArgumentException("Invalid memory bank");
        }
    }

    private String waitForTagRead(String epc, String bank, int offsetWords, int countWords, long password) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + TAG_WAIT_MS;
        while (true) {
            try {
                return read(epc, bank, offsetWords, countWords, password);
            } catch (Exception error) {
                boolean missing = WritePolicy.tagAbsent(explain(error));
                if (!missing || SystemClock.elapsedRealtime() >= deadline) {
                    if (missing) throw new IllegalStateException("Tag is not in range. Hold it near the reader and write again. · " + explain(error));
                    throw error;
                }
                stopAccessQuietly();
                Thread.sleep(250);
            }
        }
    }

    private String read(String epc, String bank, int offsetWords, int countWords, long password) throws Exception {
        return MemoryReadSession.run(
                () -> readOnce(epc, bank, offsetWords, countWords, password),
                () -> stopAccessQuietly(),
                error -> accessBusy(error) && !WritePolicy.tagAbsent(explain(error)),
                () -> Thread.sleep(200));
    }

    /** A tag that does not answer at full power is usually saturated up close; try the next lower level at once. */
    private String readStepping(RFIDReader rd, String epc, String bank, int offsetWords, int countWords, long password,
                                List<Double> powers, int[] step) throws Exception {
        while (true) {
            try { return read(epc, bank, offsetWords, countWords, password); }
            catch (Exception error) {
                if (!WritePolicy.tagAbsent(explain(error)) || powers == null || step[0] + 1 >= powers.size()) throw error;
                applyPower(rd, powers.get(++step[0]));
            }
        }
    }

    private void stopAccessQuietly() {
        try { requireReader().Actions.TagAccess.stopAccess(); }
        catch (Exception error) { Log.d("MC3390R.Rfid", "Access cleanup: " + explain(error)); }
    }

    private void releaseAccess() {
        RFIDReader rd = reader;
        if (rd == null) return;
        try { rd.Actions.TagAccess.OperationSequence.stopSequence(); }
        catch (Exception ignored) { }
        try { rd.Actions.TagAccess.OperationSequence.deleteAll(); }
        catch (Exception ignored) { }
        stopAccessQuietly();
        try { rd.Actions.Inventory.stop(); }
        catch (OperationFailureException error) {
            if (error.getResults() != RFIDResults.RFID_NO_INVENTORY_IN_PROGRESS)
                Log.d("MC3390R.Rfid", "Inventory stop during access release: " + explain(error));
        } catch (Exception ignored) { }
    }

    private void waitUntilAccessIdle() throws Exception {
        // SDK access calls handle actual operation-in-progress errors with bounded retries.
        // Do not delay every healthy operation by 600 ms.
        releaseAccess();
    }

    private boolean accessBusy(Exception error) {
        if (error instanceof OperationFailureException) {
            OperationFailureException sdk = (OperationFailureException) error;
            if (sdk.getResults() == RFIDResults.RFID_OPERATION_IN_PROGRESS) return true;
            String vendor = sdk.getVendorMessage();
            if (vendor != null && vendor.toLowerCase(Locale.ROOT).contains("operation in progress")) return true;
        }
        String text = error.getMessage();
        return text != null && text.toLowerCase(Locale.ROOT).contains("operation in progress");
    }

    private boolean insufficientPower(Exception error) {
        String text = explain(error).toLowerCase(Locale.ROOT);
        return text.contains("insufficient") || text.contains("0x0b");
    }

    private String readOnce(String epc, String bank, int offsetWords, int countWords, long password) throws Exception {
        RFIDReader rd = requireReader();
        TagAccess.ReadAccessParams params = rd.Actions.TagAccess.new ReadAccessParams();
        params.setMemoryBank(memoryBank(bank));
        params.setOffset(offsetWords);
        params.setCount(countWords);
        params.setAccessPassword(password);
        TagData tag = rd.Actions.TagAccess.readWait(epc, params, null, true);
        if (tag == null) throw new IllegalStateException("No read-back returned by the reader");
        if (!epc.equalsIgnoreCase(tag.getTagID())) throw new IllegalStateException("Reader returned data for a different tag");
        ACCESS_OPERATION_STATUS status = tag.getOpStatus();
        if (status != null && status != ACCESS_OPERATION_STATUS.ACCESS_SUCCESS) {
            throw new BankReadException("Read failed: " + status,
                    status == ACCESS_OPERATION_STATUS.ACCESS_TAG_MEMORY_OVERRUN_ERROR);
        }
        String data = WritePolicy.hex(tag.getMemoryBankData(), false);
        if (countWords > 0 && data.length() != countWords * 4) throw new IllegalStateException("Reader returned a shorter memory range than requested");
        return data;
    }

    private static int integer(JSONObject payload, String name) throws JSONException {
        Object value = payload.get(name);
        if (!(value instanceof Number)) throw new IllegalArgumentException("Invalid " + name);
        double number = ((Number)value).doubleValue();
        if (!Double.isFinite(number) || number != Math.rint(number) || number > Integer.MAX_VALUE || number < Integer.MIN_VALUE)
            throw new IllegalArgumentException("Invalid " + name);
        return (int)number;
    }

    /** One SDK write of complete words; waits for a returning tag only before anything was issued. */
    private void writeChunk(RFIDReader rd, String epc, String bank, int offsetWords, String chunk, long password,
                            long tagDeadline, boolean alreadyIssued) throws Exception {
        TagAccess.WriteAccessParams params = rd.Actions.TagAccess.new WriteAccessParams();
        params.setMemoryBank(memoryBank(bank));
        params.setOffset(offsetWords);
        params.setWriteData(chunk);
        params.setWriteDataLength(chunk.length() / 4); // SDK lengths are 16-bit words, not bytes.
        params.setWriteRetries(1); // SDK counts total attempts and rejects 0; 1 means no retry.
        params.setAccessPassword(password);
        for (int radio = 0; ; radio++) {
            try {
                if (radio > 0) Thread.sleep(100);
                stopAccessQuietly();
                TagData written = new TagData();
                // 6-arg flags are bPrefilter, bTIDPrefilter — never TID-prefilter an EPC write.
                rd.Actions.TagAccess.writeWait(epc, params, null, written, true, false);
                if (written.getOpStatus() != null && written.getOpStatus() != ACCESS_OPERATION_STATUS.ACCESS_SUCCESS)
                    throw new IllegalStateException("Write returned " + written.getOpStatus() + "; check the tag before retrying");
                return;
            } catch (Exception error) {
                boolean missing = !alreadyIssued && WritePolicy.tagAbsent(explain(error)) && SystemClock.elapsedRealtime() < tagDeadline;
                if (missing) { stopAccessQuietly(); continue; }
                if (!accessBusy(error) || radio >= 2) throw error;
                stopAccessQuietly();
            }
        }
    }

    private JSONObject write(JSONObject payload) throws Exception {
        RFIDReader rd = requireReader();
        if (!payload.optString("operation", "write").equals("write")) throw new IllegalArgumentException("Invalid write operation");
        String epc = WritePolicy.hex(payload.getString("epc"), false);
        String bank = payload.getString("memoryBank");
        int offset = integer(payload, "offsetBytes"), length = integer(payload, "lengthBytes");
        String data = WritePolicy.hex(payload.getString("dataHex"), false);
        String passwordText = payload.optString("accessPassword", "");
        WritePolicy.validate(epc, bank, offset, length, data, passwordText, Boolean.TRUE.equals(payload.opt("confirmSensitive")));
        long password = WritePolicy.password(passwordText);
        SingulationSnapshot scanProfile = new SingulationSnapshot(rd.Config.Antennas.getSingulationControl(1));
        boolean resume = reading, issued = false, blankByAbsence = false;
        int completedWords = 0, totalWords = 0, writeRetries = 0;
        Double originalPower = powerDbm;
        accessing = true;
        beepEpoch.incrementAndGet();
        JSONObject result;
        try {
            if (resume) setReading(false);
            waitUntilAccessIdle();
            int words = WritePolicy.paddedLength(length) / 2;
            totalWords = words;
            boolean user = bank.equals("USER"), epcBank = bank.equals("EPC"), reservedBank = bank.equals("RESERVED");
            boolean adjustable = (user || epcBank || reservedBank) && originalPower != null && powerValues != null;
            int chunkWords = user ? USER_WRITE_CHUNK_WORDS : words;
            // USER rewrites of a fixed range are idempotent, so a chunk may be re-sent after
            // verification is unsuccessful. EPC/RESERVED change the access target.
            List<Double> powers = !adjustable ? java.util.Collections.singletonList(originalPower)
                    : user ? WritePolicy.userWritePowers(originalPower, powerValues, lastUserWritePower)
                    : WritePolicy.epcWritePowers(originalPower, powerValues);
            int powerStep = 0;
            boolean powerProven = lastUserWritePower != null;
            if (adjustable && (powerDbm == null || Math.abs(powerDbm - powers.get(0)) > 0.00001))
                applyPower(rd, powers.get(0));
            long tagDeadline = SystemClock.elapsedRealtime() + TAG_WAIT_MS;
            String supplied = payload.optString("beforeHex", "");
            String before;
            if (supplied.matches("(?i)[0-9a-f]*") && supplied.length() == words * 4) before = supplied.toUpperCase(Locale.ROOT);
            else {
                // Full power first; a saturated near tag gets the lower levels at once. A tag that left the
                // field after the trigger scan is waited for, cycling the levels until it answers.
                int[] step = {0};
                while (true) {
                    try { before = readStepping(rd, epc, bank, offset / 2, words, password, adjustable ? powers : null, step); break; }
                    catch (Exception error) {
                        if (!WritePolicy.tagAbsent(explain(error)) || SystemClock.elapsedRealtime() >= tagDeadline) {
                            if (WritePolicy.tagAbsent(explain(error)))
                                throw new IllegalStateException("Tag is not in range. Hold it near the reader and write again. · " + explain(error));
                            throw error;
                        }
                        if (adjustable && step[0] != 0) { step[0] = 0; applyPower(rd, powers.get(0)); }
                        Thread.sleep(150);
                    }
                }
                powerStep = step[0];
            }
            String wordData = WritePolicy.wordData(data, before);
            long verifyPassword = password;
            if (reservedBank && offset + WritePolicy.paddedLength(length) > 4) {
                String reserved = waitForTagRead(epc, bank, 0, 4, password);
                reserved = reserved.substring(0, offset * 2) + wordData
                        + reserved.substring((offset + words * 2) * 2);
                verifyPassword = WritePolicy.reservedVerifyPassword(reserved);
            }
            String newEpc = WritePolicy.newEpc(epc, bank, offset, data);
            if (user) {
                // Write every changed chunk, then prove the whole range with one read; only mismatches are re-sent.
                // Word 0 goes last on its own: Monza chips derive the PC UMI bit from it, and a mid-write PC change
                // makes the rest of a multi-word write and the next read on the same session fail.
                List<String> chunks = new ArrayList<>();
                List<Integer> starts = new ArrayList<>();
                int firstWords = offset == 0 ? 1 : chunkWords;
                chunks.add(wordData.substring(0, Math.min(wordData.length(), firstWords * 4)));
                starts.add(0);
                if (wordData.length() > firstWords * 4)
                    for (String rest : WritePolicy.wordChunks(wordData.substring(firstWords * 4), chunkWords)) {
                        starts.add(starts.get(starts.size() - 1) + chunks.get(chunks.size() - 1).length() / 4);
                        chunks.add(rest);
                    }
                boolean[] done = new boolean[chunks.size()];
                for (int i = 0; i < chunks.size(); i++) done[i] = WritePolicy.matchesBaseline(chunks.get(i), before, starts.get(i));
                Exception last = null;
                for (int round = 0; round < USER_CHUNK_ATTEMPTS && !WritePolicy.allTrue(done); round++) {
                    if (round > 0) {
                        writeRetries++;
                        if (adjustable && powerStep + 1 < powers.size()) applyPower(rd, powers.get(++powerStep));
                    }
                    for (int i = chunks.size() - 1; i >= 0; i--) {
                        if (done[i]) continue;
                        try {
                            writeChunk(rd, epc, bank, offset / 2 + starts.get(i), chunks.get(i), password, tagDeadline, issued);
                            issued = true;
                        } catch (Exception error) { last = error; }
                    }
                    try {
                        String actual;
                        try { actual = read(epc, bank, offset / 2, words, verifyPassword); }
                        catch (Exception missing) {
                            if (!WritePolicy.tagAbsent(explain(missing))) throw missing;
                            releaseAccess();
                            actual = read(epc, bank, offset / 2, words, verifyPassword);
                        }
                        for (int i = 0; i < chunks.size(); i++) {
                            int first = starts.get(i) * 4;
                            done[i] = actual.substring(first, first + chunks.get(i).length()).equalsIgnoreCase(chunks.get(i));
                        }
                        if (!WritePolicy.allTrue(done)) last = new IllegalStateException("Read-back did not match the complete written word range; check the tag before retrying");
                    } catch (Exception error) { last = error; }
                }
                completedWords = 0;
                for (int i = 0; i < chunks.size() && done[i]; i++) completedWords += chunks.get(i).length() / 4;
                if (!WritePolicy.allTrue(done)) throw last != null ? last : new IllegalStateException("USER write could not be verified");
            } else
            for (String chunk : WritePolicy.wordChunks(wordData, chunkWords)) {
                int currentWords = chunk.length() / 4;
                int chunkOffset = offset / 2 + completedWords;
                // Fresh pre-read already verifies unchanged USER chunks, including cleared tails.
                if (user && WritePolicy.matchesBaseline(chunk, before, completedWords)) {
                    completedWords += currentWords;
                    continue;
                }
                Exception last = null;
                boolean verified = false;
                int attempts = user ? USER_CHUNK_ATTEMPTS : (epcBank || reservedBank) ? 3 : 1;
                boolean blankEpc = epcBank && newEpc.matches("(?i)^0+$");
                boolean powerRetry = epcBank || reservedBank;
                for (int attempt = 0; attempt < attempts && !verified; attempt++) {
                    if (attempt > 0) {
                        writeRetries++;
                        if (adjustable && powerStep + 1 < powers.size() && (!user || !powerProven || attempt % 2 == 0))
                            applyPower(rd, powers.get(++powerStep));
                    }
                    boolean writeSucceeded = false;
                    try {
                        TagAccess.WriteAccessParams params = rd.Actions.TagAccess.new WriteAccessParams();
                        params.setMemoryBank(memoryBank(bank));
                        params.setOffset(chunkOffset);
                        params.setWriteData(chunk);
                        params.setWriteDataLength(currentWords); // SDK lengths are 16-bit words, not bytes.
                        params.setWriteRetries(1); // SDK counts total attempts and rejects 0; 1 means no retry.
                        params.setAccessPassword(password);
                        Exception writeError = null;
                        for (int radio = 0; ; radio++) {
                            try {
                                if (radio > 0) Thread.sleep(250);
                                stopAccessQuietly();
                                TagData written = new TagData();
                                // 6-arg flags are bPrefilter, bTIDPrefilter — never TID-prefilter an EPC write.
                                rd.Actions.TagAccess.writeWait(epc, params, null, written, true, false);
                                issued = true;
                                if (written.getOpStatus() != null && written.getOpStatus() != ACCESS_OPERATION_STATUS.ACCESS_SUCCESS) {
                                    throw new IllegalStateException("Write returned " + written.getOpStatus()
                                            + "; check the tag before retrying");
                                }
                                writeError = null;
                                writeSucceeded = true;
                                break;
                            } catch (Exception error) {
                                writeError = error;
                                boolean missing = !issued && WritePolicy.tagAbsent(explain(error))
                                        && SystemClock.elapsedRealtime() < tagDeadline;
                                // A silent tag at full power is tried at the next lower level before waiting.
                                if (missing && adjustable && powerStep + 1 < powers.size()) throw error;
                                if (missing) continue;
                                if (!accessBusy(error) || radio >= 2) throw error;
                            }
                        }
                        if (writeError != null) throw writeError;
                    } catch (Exception error) {
                        last = error;
                        boolean silentBeforeIssue = !issued && WritePolicy.tagAbsent(explain(error));
                        if (!user && !(powerRetry && (accessBusy(error) || insufficientPower(error) || silentBeforeIssue))) throw error;
                    }
                    if (powerRetry && !writeSucceeded) continue;
                    try {
                        if (blankEpc && !epc.equalsIgnoreCase(newEpc)) {
                            String expectTid = payload.optString("tidHex", "");
                            if (expectTid.matches("(?i)([0-9a-f]{4})+")) {
                                // All-zero EPCs can collide; only this tag's factory TID proves the 00 EPC is ours.
                                // Lower power leaves only the nearest tag, the one just written, answering at EPC 00.
                                double writtenAt = powerDbm;
                                List<Double> probeLevels = new ArrayList<>();
                                probeLevels.add(powerDbm);
                                if (powerValues != null) for (double level : WritePolicy.userWritePowers(powerDbm, powerValues))
                                    if (level < powerDbm - 0.00001 && !probeLevels.contains(level)) probeLevels.add(level);
                                for (int probe = 0; probe < probeLevels.size() * 2 && !verified; probe++) {
                                    if (probe > 0 && probe % 2 == 0 && adjustable) applyPower(rd, probeLevels.get(probe / 2));
                                    try {
                                        verified = expectTid.equalsIgnoreCase(read(newEpc, "TID", 0, expectTid.length() / 4, verifyPassword));
                                    } catch (Exception other) {
                                        // Another 00 tag answered (shorter TID overruns) or nobody did; probe again.
                                        boolean overrun = other instanceof BankReadException || explain(other).contains("OVERRUN");
                                        if (!overrun && !WritePolicy.tagAbsent(explain(other))) throw other;
                                    }
                                    if (!verified) releaseAccess();
                                }
                                if (!verified) {
                                    // Other 00 tags can always answer first. The tag answered at its old EPC moments ago at
                                    // this power; two clean misses there now mean its EPC changed.
                                    if (adjustable && Math.abs(powerDbm - writtenAt) > 0.00001) applyPower(rd, writtenAt);
                                    boolean stillOld = false;
                                    for (int probe = 0; probe < 2 && !stillOld; probe++) {
                                        try { read(epc, "TID", 0, expectTid.length() / 4, verifyPassword); stillOld = true; }
                                        catch (Exception gone) {
                                            if (!WritePolicy.tagAbsent(explain(gone))) throw gone;
                                            releaseAccess();
                                        }
                                    }
                                    if (stillOld) throw new IllegalStateException("Previous EPC is still readable after the write; check the tag before retrying");
                                    verified = true;
                                    blankByAbsence = true;
                                }
                            } else {
                                // Without a TID, the previous unique EPC must stay unreadable on two clean attempts.
                                for (int probe = 0; probe < 2; probe++) {
                                    try {
                                        read(epc, bank, chunkOffset, currentWords, verifyPassword);
                                        throw new IllegalStateException("Previous EPC is still readable after the write; check the tag before retrying");
                                    } catch (Exception gone) {
                                        String detail = gone.getMessage();
                                        if (detail != null && detail.startsWith("Previous EPC is still readable")) throw gone;
                                        if (!WritePolicy.tagAbsent(explain(gone))) throw gone;
                                        releaseAccess();
                                    }
                                }
                                verified = true;
                            }
                        } else {
                            WritePolicy.verifyReadBack(chunk, read(newEpc, bank, chunkOffset, currentWords, verifyPassword));
                            verified = true;
                        }
                    } catch (Exception error) {
                        if (!user) throw error;
                        if (last == null) last = error;
                    }
                }
                if (!verified) throw last;
                powerProven = true;
                completedWords += currentWords;
            }
            if (user) lastUserWritePower = powerDbm;
            result = success().put("epc", epc).put("newEpc", newEpc).put("memoryBank", bank)
                    .put("offsetBytes", offset).put("beforeHex", before).put("afterHex", wordData)
                    .put("chunks", WritePolicy.wordChunks(wordData, chunkWords).size())
                    .put("writeRetries", writeRetries).put("writePowerDbm", powerDbm)
                    .put("blankEpcByAbsence", blankByAbsence)
                    .put("message", (blankByAbsence ? "EPC write accepted; old EPC no longer answers (other 00 tags blocked a TID check)"
                            : "Written and read back from MC3390R")
                            + (length % 2 == 1 ? " · adjacent byte preserved" : ""));
        } catch (Exception error) {
            Log.e("MC3390R.Rfid", "Tag access failed (write issued=" + issued + ")", error);
            String detail = explain(error);
            if (completedWords > 0 && completedWords < totalWords) {
                detail = "Partial write: " + (completedWords * 2) + " of " + (totalWords * 2)
                        + " bytes were written and verified before failure. Read the complete USER bank before any retry. · "
                        + detail;
            }
            result = failure(detail, issued).put("epc", epc).put("memoryBank", bank)
                    .put("verifiedBytes", completedWords * 2).put("requestedBytes", length)
                    .put("writeRetries", writeRetries);
        } finally {
            releaseAccess();
            try {
                if (originalPower != null && powerDbm != null && Math.abs(powerDbm - originalPower) > 0.00001)
                    applyPower(rd, originalPower);
            } catch (Exception error) {
                message = "Transmit power could not be restored: " + explain(error);
            }
            try {
                scanProfile.restore(rd);
                if (((resume && continuousReading) || triggerLatch.wantsInventory(barcodeMode, foreground, disposed)) && foreground) setReading(true);
            } catch (Exception error) {
                // Preserve the write outcome while honestly reporting the failed inventory restore.
                message = "Inventory could not resume: " + explain(error);
            } finally { accessing = false; }
        }
        if (resume && foreground && !reading) result.put("resumeWarning", message);
        return result;
    }

    private JSONObject success() {
        JSONObject result = new JSONObject();
        try { result.put("status", "success").put("verified", true); } catch (JSONException ignored) { }
        return result;
    }
    private JSONObject failure(String detail, boolean uncertain) {
        JSONObject result = new JSONObject();
        try { result.put("status", uncertain ? "unknown" : "failed").put("verified", false).put("message", detail); }
        catch (JSONException ignored) { }
        return result;
    }
    private String explain(Exception error) {
        if (error instanceof InvalidUsageException) {
            InvalidUsageException usage = (InvalidUsageException)error;
            return "SDK rejected the request: " + usage.getInfo() + " · " + usage.getVendorMessage();
        }
        if (error instanceof OperationFailureException) {
            OperationFailureException sdk = (OperationFailureException)error;
            if (sdk.getResults() == RFIDResults.RFID_READER_REGION_NOT_CONFIGURED)
                return "Set the correct regulatory region in Zebra 123RFID Mobile, then reconnect";
            return "Reader error: " + sdk.getResults() + (sdk.getVendorMessage() == null ? "" : " · " + sdk.getVendorMessage());
        }
        String text = error.getMessage();
        return text == null || text.isEmpty() ? "Reader operation could not be confirmed (" + error.getClass().getSimpleName() + ")" : text;
    }

    private void evaluate(String script) {
        main.post(() -> { if (!disposed) web.evaluateJavascript(script, null); });
    }
    private void reply(String id, JSONObject result) {
        evaluate("window.NativeRfid && window.NativeRfid.reply(" + JSONObject.quote(id) + "," + result + ")");
    }
    private void emitState() {
        JSONObject state = new JSONObject();
        try {
            boolean connected = reader != null && reader.isConnected() && initialized && !connectionLost;
            state.put("triggerHeld", triggerLatch.held()).put("connected", connected).put("reading", connected && readingKnown && reading)
                    .put("powerDbm", connected && powerDbm != null ? powerDbm : JSONObject.NULL).put("tidScan", tidScan)
                    .put("message", message);
            int[] levels = powerValues;
            if (connected && levels != null && levels.length > 0) {
                int min = levels[0], max = levels[0];
                JSONArray options = new JSONArray();
                for (int level : levels) { min = Math.min(min, level); max = Math.max(max, level); options.put(WritePolicy.serialPowerDbm(level)); }
                state.put("minDbm", WritePolicy.serialPowerDbm(min)).put("maxDbm", WritePolicy.serialPowerDbm(max)).put("powerLevels", options);
            } else state.put("minDbm", JSONObject.NULL).put("maxDbm", JSONObject.NULL);
        } catch (JSONException ignored) { }
        evaluate("window.NativeRfid && window.NativeRfid.state(" + state + ")");
    }

    private boolean scanBeepEligible() {
        return initialized && !connectionLost && foreground && readingKnown && reading && !accessing && !disposed;
    }

    /** No audio service calls on the SDK read callback; at most one beep is pending. */
    private void queueScanBeep() {
        if (!scanBeepEligible() || !beepPending.compareAndSet(false, true)) return;
        int epoch = beepEpoch.get();
        main.post(() -> {
            beepPending.set(false);
            if (!beepGate.shouldPlay(SystemClock.elapsedRealtime(), scanBeepEligible() && epoch == beepEpoch.get(), true)) return;
            try {
                if (scanTone == null) scanTone = new ToneGenerator(AudioManager.STREAM_MUSIC, 100);
                scanTone.stopTone();
                scanTone.startTone(ToneGenerator.TONE_PROP_BEEP, 20);
            } catch (RuntimeException error) {
                Log.w("MC3390R.Rfid", "Scan sound unavailable", error);
            }
        });
    }

    void pause() {
        foreground = false;
        beepEpoch.incrementAndGet();
        main.post(() -> { if (scanTone != null) scanTone.stopTone(); });
        if (disposed) return;
        executor.execute(() -> {
            continuousReading = false;
            triggerLatch.clear();
            try { if (reader != null && reader.isConnected()) setReading(false); }
            catch (Exception error) { message = explain(error); }
            emitState();
        });
    }
    void dispose() {
        disposed = true;
        inventoryPump.close();
        foreground = false;
        beepEpoch.incrementAndGet();
        main.post(() -> {
            if (scanTone != null) { scanTone.stopTone(); scanTone.release(); scanTone = null; }
        });
        executor.execute(this::releaseReader);
        executor.shutdown();
    }
    private void releaseReader() {
        triggerLatch.clear();
        inventoryBatch.clear();
        beepEpoch.incrementAndGet();
        RFIDReader rd = reader;
        if (rd != null) {
            try { if (rd.isConnected()) { rd.Actions.Inventory.stop(); } } catch (Exception ignored) { }
            try { rd.Events.removeEventsListener(events); } catch (Exception ignored) { }
            try { if (rd.isConnected()) rd.disconnect(); } catch (Exception ignored) { }
        }
        reader = null;
        initialized = false;
        connectionLost = false;
        reading = false;
        readingKnown = false;
        powerDbm = null;
        lastUserWritePower = null;
        powerValues = null;
        powerStateSupported = true;
        powerStateDiagnostic = "Not queried";
        if (readers != null) { readers.Dispose(); readers = null; }
    }

    private boolean drainInventory() {
        RFIDReader rd = reader;
        if (rd == null || !foreground || accessing || disposed) return false;
        try {
            for (int chunk = 0; chunk < 8; chunk++) {
                TagDataArray data = rd.Actions.getReadTagsEx(1000);
                int count = data == null ? 0 : data.getLength();
                if (count == 0) return false;
                TagData[] tags = data.getTags();
                boolean valid = false;
                for (int i = 0; i < count; i++) {
                    TagData t = tags[i];
                    String tid = null;
                    if (t.getOpCode() == ACCESS_OPERATION_CODE.ACCESS_OPERATION_READ) {
                        // Only the TID inventory's own reads are scan reports; memory-access reads are not.
                        if (!tidInventoryActive) continue;
                        if (t.getMemoryBank() == MEMORY_BANK.MEMORY_BANK_TID && t.getOpStatus() == ACCESS_OPERATION_STATUS.ACCESS_SUCCESS)
                            tid = t.getMemoryBankData();
                    }
                    valid |= inventoryBatch.add(t.getTagID(), tid, t.getPeakRSSI(), t.getAntennaID(),
                            t.getPC(), t.getCRC(), t.getTagSeenCount(), System.currentTimeMillis());
                }
                if (valid) { queueScanBeep(); queueInventoryDelivery(); }
                if (count < 1000) return false;
            }
            return true; // Yield to stop/access requests before draining another bounded chunk.
        } catch (Exception error) { message = explain(error); emitState(); return false; }
    }

    private void queueInventoryDelivery() {
        if (!deliveryPending.compareAndSet(false, true)) return;
        main.postDelayed(() -> {
            deliveryPending.set(false);
            java.util.List<InventoryBatch.Report> reports = inventoryBatch.take();
            if (disposed || !foreground || reports.isEmpty()) return;
            JSONArray batch = new JSONArray();
            try {
                for (InventoryBatch.Report r : reports) batch.put(new JSONObject().put("epc", r.epc)
                        .put("tid", r.tid == null ? JSONObject.NULL : r.tid).put("rssi", r.rssi).put("antenna", r.antenna).put("pc", r.pc).put("crc", r.crc)
                        .put("seenCount", r.seenCount).put("reportCount", r.reportCount).put("receivedAt", r.receivedAt));
                web.evaluateJavascript("window.NativeRfid && window.NativeRfid.tags(" + batch + ")", null);
            } catch (JSONException error) { Log.e("MC3390R.Rfid", "Inventory delivery failed", error); }
        }, 50); // Display batching only: RF and SDK draining never sleep.
    }

    private JSONObject scanDiagnostics() throws Exception {
        RFIDReader rd = requireReader();
        Antennas.SingulationControl singulation = rd.Config.Antennas.getSingulationControl(1);
        Antennas.AntennaRfConfig rf = rd.Config.Antennas.getAntennaRfConfig(1);
        long[] counts = inventoryBatch.counters();
        JSONObject result = success().put("reports", counts[0]).put("sdkSeenCount", counts[1])
                .put("invalidReports", counts[2]).put("deliveryOverflow", counts[3]).put("pendingTags", counts[4])
                .put("bufferWarnings", bufferWarnings.get()).put("bufferFull", bufferFull.get())
                .put("inventoryStarts", inventoryStarts.get()).put("bankRequests", bankRequests.get())
                .put("session", singulation.getSession().getValue()).put("population", singulation.getTagPopulation())
                .put("inventoryState", singulation.Action.getInventoryState().getValue())
                .put("rfMode", rf.getrfModeTableIndex()).put("tari", rf.getTari()).put("powerDbm", powerDbm)
                .put("readerPowerDbm", WritePolicy.serialPowerDbm(powerValues[rf.getTransmitPowerIndex()]));
        JSONArray modes = new JSONArray();
        for (int i = 0; i < rd.ReaderCapabilities.RFModes.Length(); i++) {
            RFModeTable table = rd.ReaderCapabilities.RFModes.getRFModeTableInfo(i);
            for (int j = 0; j < table.length(); j++) {
                RFModeTableEntry m = table.getRFModeTableEntryInfo(j);
                modes.put(new JSONObject().put("id", m.getModeIdentifer()).put("bdr", m.getBdrValue())
                        .put("modulation", String.valueOf(m.getModulation())).put("minTari", m.getMinTariValue()));
            }
        }
        result.put("modes", modes).put("uniqueTagReporting", String.valueOf(rd.Config.getUniqueTagReport()));
        try { result.put("dpo", rd.Config.getDPOState().getValue()); } catch (Exception ignored) { }
        return result;
    }

    private JSONObject scanConfig(JSONObject payload) throws Exception {
        RFIDReader rd = requireReader();
        if (reading || accessing) throw new IllegalStateException("Stop inventory before changing scan settings");
        Antennas.SingulationControl sc = rd.Config.Antennas.getSingulationControl(1);
        if (payload.has("session")) {
            int session = integer(payload, "session");
            if (session < 0 || session > 3) throw new IllegalArgumentException("Invalid session");
            sc.setSession(new SESSION[]{SESSION.SESSION_S0, SESSION.SESSION_S1, SESSION.SESSION_S2, SESSION.SESSION_S3}[session]);
        }
        if (payload.has("population")) {
            int population = integer(payload, "population");
            if (population < 1 || population > 1000) throw new IllegalArgumentException("Invalid population");
            sc.setTagPopulation((short)population);
        }
        if (payload.has("inventoryState")) {
            int state = integer(payload, "inventoryState");
            if (state < 0 || state > 2) throw new IllegalArgumentException("Invalid inventory state");
            sc.Action.setInventoryState(new INVENTORY_STATE[]{INVENTORY_STATE.INVENTORY_STATE_A, INVENTORY_STATE.INVENTORY_STATE_B, INVENTORY_STATE.INVENTORY_STATE_AB_FLIP}[state]);
        }
        rd.Config.Antennas.setSingulationControl(1, sc);
        if (payload.has("rfMode")) {
            long mode = integer(payload, "rfMode"); boolean supported = false;
            for (int i = 0; i < rd.ReaderCapabilities.RFModes.Length(); i++) {
                RFModeTable table = rd.ReaderCapabilities.RFModes.getRFModeTableInfo(i);
                for (int j = 0; j < table.length(); j++) if (table.getRFModeTableEntryInfo(j).getModeIdentifer() == mode) supported = true;
            }
            if (!supported) throw new IllegalArgumentException("Unsupported RF mode");
            Antennas.AntennaRfConfig rf = rd.Config.Antennas.getAntennaRfConfig(1);
            rf.setrfModeTableIndex(mode); rd.Config.Antennas.setAntennaRfConfig(1, rf);
        }
        if (payload.has("dpo")) rd.Config.setDPOState(payload.getBoolean("dpo") ? DYNAMIC_POWER_OPTIMIZATION.ENABLE : DYNAMIC_POWER_OPTIMIZATION.DISABLE);
        return scanDiagnostics();
    }

    private final class EventHandler implements RfidEventsListener {
        @Override public void eventReadNotify(RfidReadEvents event) {
            if (reader != null && foreground && !accessing && !disposed) inventoryPump.signal();
        }
        @Override public void eventStatusNotify(RfidStatusEvents event) {
            if (disposed || event == null || event.StatusEventData == null) return;
            STATUS_EVENT_TYPE type = event.StatusEventData.getStatusEventType();
            Log.d("MC3390R.Rfid", "SDK status: " + type);
            if (type == STATUS_EVENT_TYPE.BUFFER_FULL_WARNING_EVENT) bufferWarnings.incrementAndGet();
            if (type == STATUS_EVENT_TYPE.BUFFER_FULL_EVENT) bufferFull.incrementAndGet();
            if (type == STATUS_EVENT_TYPE.INVENTORY_START_EVENT || type == STATUS_EVENT_TYPE.INVENTORY_STOP_EVENT) {
                // Access sequences emit inventory-looking events on this firmware. They are
                // not trigger inventory transitions and must not leave the UI/radio state stuck.
                if (accessing && !inventoryCommandPending) {
                    Log.d("MC3390R.Rfid", "Ignoring access-sequence inventory event: " + type);
                    return;
                }
                if (type == STATUS_EVENT_TYPE.INVENTORY_START_EVENT) inventoryStarts.incrementAndGet();
                if (type == STATUS_EVENT_TYPE.INVENTORY_STOP_EVENT) beepEpoch.incrementAndGet();
                synchronized (inventoryMonitor) {
                    reading = type == STATUS_EVENT_TYPE.INVENTORY_START_EVENT;
                    readingKnown = true;
                    inventoryMonitor.notifyAll();
                }
                emitState();
                if (type == STATUS_EVENT_TYPE.INVENTORY_STOP_EVENT && !inventoryCommandPending && !accessing
                        && triggerLatch.wantsInventory(barcodeMode, foreground, disposed)) {
                    executor.execute(() -> {
                        if (accessing || !triggerLatch.wantsInventory(barcodeMode, foreground, disposed)) return;
                        try { setReading(true); } catch (Exception error) { message = explain(error); }
                        emitState();
                    });
                }
            } else if (type == STATUS_EVENT_TYPE.DISCONNECTION_EVENT) {
                beepEpoch.incrementAndGet();
                connectionLost = true;
                synchronized (inventoryMonitor) { reading = false; readingKnown = false; inventoryMonitor.notifyAll(); }
                message = "Reader disconnected";
                emitState();
            } else if (type == STATUS_EVENT_TYPE.HANDHELD_TRIGGER_EVENT && foreground) {
                HANDHELD_TRIGGER_EVENT_TYPE trigger = event.StatusEventData.HandheldTriggerEventData.getHandheldEvent();
                triggerLatch.event(trigger == HANDHELD_TRIGGER_EVENT_TYPE.HANDHELD_TRIGGER_PRESSED);
                emitState();
                executor.execute(() -> {
                    if (barcodeMode || continuousReading || accessing || !foreground || disposed) return;
                    try { setReading(triggerLatch.held()); }
                    catch (Exception error) { message = explain(error); }
                    emitState();
                });
            }
        }
    }
    private static final class Completed {
        final String signature; final JSONObject result;
        Completed(String signature, JSONObject result) { this.signature = signature; this.result = result; }
    }
    private static final class BankReadException extends Exception {
        final boolean memoryOverrun;
        BankReadException(String message, boolean memoryOverrun) { super(message); this.memoryOverrun = memoryOverrun; }
    }
}
