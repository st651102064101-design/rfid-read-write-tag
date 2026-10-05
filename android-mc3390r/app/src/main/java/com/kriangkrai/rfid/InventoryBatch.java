package com.kriangkrai.rfid;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;

/** Copy SDK's reusable objects immediately; combine display reports without losing counts. */
final class InventoryBatch {
    static final int MAX_PENDING_TAGS = 10000;
    static final class Report {
        final String epc, tid;
        int rssi, antenna, pc, crc;
        long seenCount, reportCount, receivedAt;
        Report(String epc, String tid) { this.epc = epc; this.tid = tid; }
    }
    private final LinkedHashMap<String, Report> pending = new LinkedHashMap<>();
    private long reports, seen, invalid, overflow;
    synchronized boolean add(String epc, int rssi, int antenna, int pc, int crc, int seenCount, long at) {
        return add(epc, null, rssi, antenna, pc, crc, seenCount, at);
    }
    /** Tags sharing an EPC stay separate when the reader reports their factory TID. */
    synchronized boolean add(String epc, String tid, int rssi, int antenna, int pc, int crc, int seenCount, long at) {
        if (!ScanBeepGate.isCompleteEpc(epc)) { invalid++; return false; }
        String id = epc.toUpperCase(Locale.ROOT);
        String chip = tid != null && tid.matches("(?i)([0-9a-f]{4})+") ? tid.toUpperCase(Locale.ROOT) : null;
        String key = chip == null ? id : id + "/" + chip;
        long count = Math.max(1, seenCount);
        reports++; seen += count;
        Report r = pending.get(key);
        if (r == null) {
            if (pending.size() >= MAX_PENDING_TAGS) { overflow++; return false; }
            r = new Report(id, chip); pending.put(key, r);
        }
        r.rssi = rssi; r.antenna = antenna; r.pc = pc; r.crc = crc;
        r.seenCount += count; r.reportCount++; r.receivedAt = at;
        return true;
    }
    synchronized List<Report> take() {
        List<Report> result = new ArrayList<>(pending.values()); pending.clear(); return result;
    }
    synchronized long[] counters() { return new long[]{reports, seen, invalid, overflow, pending.size()}; }
    synchronized void clear() { pending.clear(); }
}
