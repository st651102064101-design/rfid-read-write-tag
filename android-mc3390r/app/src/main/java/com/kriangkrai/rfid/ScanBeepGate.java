package com.kriangkrai.rfid;

/** Monotonic, event-driven gate: no timer or accumulated beeps after a pause. */
final class ScanBeepGate {
    private static final long INTERVAL_MS = 300;
    private long lastPlayedMs = -1;

    static boolean isCompleteEpc(String epc) {
        return epc != null && epc.matches("(?:[0-9a-fA-F]{2})+");
    }

    synchronized boolean shouldPlay(long nowMs, boolean active, boolean validBatch) {
        if (!active || !validBatch || nowMs < 0) return false;
        if (lastPlayedMs >= 0 && (nowMs < lastPlayedMs || nowMs - lastPlayedMs < INTERVAL_MS)) return false;
        lastPlayedMs = nowMs;
        return true;
    }
}
