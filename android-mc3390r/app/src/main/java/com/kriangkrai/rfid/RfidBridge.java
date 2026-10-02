package com.kriangkrai.rfid;

import android.content.Context;
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
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** SDK calls and access operations share one executor; SDK events never wait on it. */
public final class RfidBridge {
    private final Context context;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object inventoryMonitor = new Object();
    private final AntennaInfo antenna = new AntennaInfo(new short[]{1});
    private final LinkedHashMap<String, Completed> completed = new LinkedHashMap<>();
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
    private boolean continuousReading;
    private int[] powerValues;
    private volatile Double powerDbm;
    private volatile String message = "Connect the integrated RFID reader";
    private boolean powerStateSupported = true;
    private String powerStateDiagnostic = "Not queried";

    RfidBridge(Context context, WebView web) { this.context = context; this.web = web; }
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
                    case "power": result = setPower(payload.getDouble("powerDbm")); break;
                    case "banks": result = banks(payload); break;
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
        TriggerInfo trigger = new TriggerInfo();
        trigger.StartTrigger.setTriggerType(START_TRIGGER_TYPE.START_TRIGGER_TYPE_IMMEDIATE);
        trigger.StopTrigger.setTriggerType(STOP_TRIGGER_TYPE.STOP_TRIGGER_TYPE_IMMEDIATE);
        reader.Config.setStartTrigger(trigger.StartTrigger);
        reader.Config.setStopTrigger(trigger.StopTrigger);
        reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.RFID_MODE, true);
        reader.Config.setAccessOperationWaitTimeout(5000);
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
        try {
            if (enabled) rd.Actions.Inventory.perform(); else rd.Actions.Inventory.stop();
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

    private JSONObject setPower(double dbm) throws Exception {
        RFIDReader rd = requireReader();
        int index = WritePolicy.powerIndex(powerValues, dbm);
        boolean resume = reading;
        accessing = true;
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
            try { if (resume && foreground) setReading(true); }
            finally { accessing = false; }
        }
        message = "Connected";
        return result;
    }

    private JSONObject banks(JSONObject payload) throws Exception {
        requireReader();
        String epc = WritePolicy.hex(payload.getString("epc"), false);
        if (epc.length() % 4 != 0 || epc.length() > 124) throw new IllegalArgumentException("Invalid Gen2 EPC");
        String passwordText = payload.optString("accessPassword", "");
        if (!passwordText.isEmpty() && !passwordText.matches("[A-Fa-f0-9]{8}")) throw new IllegalArgumentException("Access password must be 8 HEX digits");
        long password = WritePolicy.password(passwordText);
        boolean resume = reading;
        accessing = true;
        JSONObject values = new JSONObject(), errors = new JSONObject();
        try {
            if (resume) setReading(false);
            for (String bank : new String[]{"EPC", "TID", "USER", "RESERVED"}) {
                try {
                    String data;
                    if (bank.equals("EPC")) data = read(epc, bank, 0, epc.length() / 4 + 2, password);
                    else if (bank.equals("RESERVED")) data = read(epc, bank, 0, 4, password);
                    else data = probeBank(epc, bank, bank.equals("USER") ? 128 : 32, password);
                    values.put(bank, data);
                } catch (Exception error) { errors.put(bank, explain(error)); }
            }
        } finally {
            try { if (resume && foreground) setReading(true); }
            finally { accessing = false; }
        }
        return success().put("epc", epc).put("banks", values).put("readableErrors", errors);
    }

    /** Binary search only after explicit memory-overrun; RF/password errors never imply capacity. */
    private String probeBank(String epc, String bank, int ceilingWords, long password) throws Exception {
        int low = 1, high = ceilingWords;
        String observed = null;
        while (low <= high) {
            int count = observed == null && high == ceilingWords ? high : (low + high) / 2;
            try {
                String data = read(epc, bank, 0, count, password);
                observed = data;
                low = count + 1;
            } catch (OperationFailureException error) {
                if (error.getResults() != RFIDResults.RFID_ACCESS_TAG_MEMORY_OVERRUN_ERROR) throw error;
                high = count - 1;
            } catch (BankReadException error) {
                if (!error.memoryOverrun) throw error;
                high = count - 1;
            }
        }
        if (observed == null) throw new IllegalStateException("No readable memory found in this bank");
        return observed;
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

    private String read(String epc, String bank, int offsetWords, int countWords, long password) throws Exception {
        RFIDReader rd = requireReader();
        TagAccess.ReadAccessParams params = rd.Actions.TagAccess.new ReadAccessParams();
        params.setMemoryBank(memoryBank(bank));
        params.setOffset(offsetWords);
        params.setCount(countWords);
        params.setAccessPassword(password);
        TagData tag = rd.Actions.TagAccess.readWait(epc, params, antenna);
        if (tag == null) throw new IllegalStateException("No read-back returned by the reader");
        ACCESS_OPERATION_STATUS status = tag.getOpStatus();
        if (status != null && status != ACCESS_OPERATION_STATUS.ACCESS_SUCCESS) {
            throw new BankReadException("Read failed: " + status,
                    status == ACCESS_OPERATION_STATUS.ACCESS_TAG_MEMORY_OVERRUN_ERROR);
        }
        String data = WritePolicy.hex(tag.getMemoryBankData(), false);
        if (data.length() != countWords * 4) throw new IllegalStateException("Reader returned a shorter memory range than requested");
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
        boolean resume = reading, issued = false;
        accessing = true;
        JSONObject result;
        try {
            if (resume) setReading(false);
            int words = WritePolicy.paddedLength(length) / 2;
            // Prove this exact memory range is readable before making any change.
            String before = read(epc, bank, offset / 2, words, password);
            String wordData = WritePolicy.wordData(data, before);
            long verifyPassword = password;
            if (bank.equals("RESERVED") && offset + WritePolicy.paddedLength(length) > 4) {
                String reserved = read(epc, bank, 0, 4, password);
                reserved = reserved.substring(0, offset * 2) + wordData
                        + reserved.substring((offset + words * 2) * 2);
                verifyPassword = Long.parseLong(reserved.substring(8, 16), 16);
            }
            TagAccess.WriteAccessParams params = rd.Actions.TagAccess.new WriteAccessParams();
            params.setMemoryBank(memoryBank(bank));
            params.setOffset(offset / 2);
            params.setWriteData(wordData);
            params.setWriteDataLength(words); // SDK lengths are 16-bit words, not bytes.
            params.setWriteRetries(1);         // SDK counts total attempts and rejects 0; 1 means no retry.
            params.setAccessPassword(password);
            TagData written = new TagData();
            issued = true;
            rd.Actions.TagAccess.writeWait(epc, params, antenna, written);
            if (written.getOpStatus() != null && written.getOpStatus() != ACCESS_OPERATION_STATUS.ACCESS_SUCCESS)
                throw new IllegalStateException("Write returned " + written.getOpStatus() + "; check the tag before retrying");
            String newEpc = WritePolicy.newEpc(epc, bank, offset, data);
            String after = read(newEpc, bank, offset / 2, words, verifyPassword);
            if (!after.equals(wordData)) throw new IllegalStateException("Read-back did not match the complete written word range; check the tag before retrying");
            result = success().put("epc", epc).put("newEpc", newEpc).put("memoryBank", bank)
                    .put("offsetBytes", offset).put("beforeHex", before).put("afterHex", after)
                    .put("message", "Written and read back from MC3390R" + (length % 2 == 1 ? " · adjacent byte preserved" : ""));
        } catch (Exception error) {
            Log.e("MC3390R.Rfid", "Tag access failed (write issued=" + issued + ")", error);
            result = failure(explain(error), issued).put("epc", epc).put("memoryBank", bank);
        } finally {
            try {
                if (resume && foreground) setReading(true);
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
            state.put("connected", connected).put("reading", connected && readingKnown && reading)
                    .put("powerDbm", connected && powerDbm != null ? powerDbm : JSONObject.NULL)
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

    void pause() {
        foreground = false;
        if (disposed) return;
        executor.execute(() -> {
            continuousReading = false;
            try { if (reader != null && reader.isConnected()) setReading(false); }
            catch (Exception error) { message = explain(error); }
            emitState();
        });
    }
    void dispose() {
        disposed = true;
        foreground = false;
        executor.execute(this::releaseReader);
        executor.shutdown();
    }
    private void releaseReader() {
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
        powerValues = null;
        powerStateSupported = true;
        powerStateDiagnostic = "Not queried";
        if (readers != null) { readers.Dispose(); readers = null; }
    }

    private final class EventHandler implements RfidEventsListener {
        @Override public void eventReadNotify(RfidReadEvents event) {
            RFIDReader rd = reader;
            if (rd == null || !foreground || accessing || disposed) return;
            try {
                TagData[] tags = rd.Actions.getReadTags(1000);
                if (tags == null || tags.length == 0) return;
                JSONArray batch = new JSONArray();
                for (TagData tag : tags) {
                    String epc = tag.getTagID();
                    if (epc != null && epc.matches("[A-Fa-f0-9]+"))
                        batch.put(new JSONObject().put("epc", epc.toUpperCase(Locale.ROOT)).put("rssi", tag.getPeakRSSI()));
                }
                evaluate("window.NativeRfid && window.NativeRfid.tags(" + batch + ")");
            } catch (Exception error) { message = explain(error); emitState(); }
        }
        @Override public void eventStatusNotify(RfidStatusEvents event) {
            if (disposed || event == null || event.StatusEventData == null) return;
            STATUS_EVENT_TYPE type = event.StatusEventData.getStatusEventType();
            Log.d("MC3390R.Rfid", "SDK status: " + type);
            if (type == STATUS_EVENT_TYPE.INVENTORY_START_EVENT || type == STATUS_EVENT_TYPE.INVENTORY_STOP_EVENT) {
                synchronized (inventoryMonitor) {
                    reading = type == STATUS_EVENT_TYPE.INVENTORY_START_EVENT;
                    readingKnown = true;
                    inventoryMonitor.notifyAll();
                }
                emitState();
            } else if (type == STATUS_EVENT_TYPE.DISCONNECTION_EVENT) {
                connectionLost = true;
                synchronized (inventoryMonitor) { reading = false; readingKnown = false; inventoryMonitor.notifyAll(); }
                message = "Reader disconnected";
                emitState();
            } else if (type == STATUS_EVENT_TYPE.HANDHELD_TRIGGER_EVENT && !accessing && foreground) {
                HANDHELD_TRIGGER_EVENT_TYPE trigger = event.StatusEventData.HandheldTriggerEventData.getHandheldEvent();
                executor.execute(() -> {
                    if (continuousReading || accessing || !foreground || disposed) return;
                    try { setReading(trigger == HANDHELD_TRIGGER_EVENT_TYPE.HANDHELD_TRIGGER_PRESSED); }
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
