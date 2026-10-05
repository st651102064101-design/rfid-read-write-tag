package com.kriangkrai.rfid;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Validation and Gen2 word planning independent of Android and the SDK. */
public final class WritePolicy {
    private WritePolicy() {}

    public static String hex(String value, boolean emptyAllowed) {
        if (value == null || (!emptyAllowed && value.isEmpty()) || value.length() % 2 != 0
                || !value.matches("[0-9a-fA-F]*")) {
            throw new IllegalArgumentException("Use complete HEX bytes (0–9 and A–F)");
        }
        return value.toUpperCase(Locale.ROOT);
    }

    public static void validate(String epc, String bank, int offset, int length, String data,
                                String password, boolean confirmed) {
        hex(epc, false);
        hex(data, false);
        if (epc.length() > 124 || epc.length() % 4 != 0) {
            throw new IllegalArgumentException("Invalid Gen2 EPC");
        }
        if (!bank.matches("EPC|USER|TID|RESERVED")) {
            throw new IllegalArgumentException("Invalid memory bank");
        }
        if (offset < 0 || offset % 2 != 0 || offset > 2046 || length < 1 || length > 1024
                || length != data.length() / 2 || offset + length > 2048) {
            throw new IllegalArgumentException("Invalid byte offset or data length");
        }
        if (password == null || (!password.isEmpty() && !password.matches("[0-9a-fA-F]{8}"))) {
            throw new IllegalArgumentException("Access password must be 8 HEX digits");
        }
        if (bank.equals("EPC") && (offset < 4 || offset + paddedLength(length) > epc.length() / 2 + 4)) {
            throw new IllegalArgumentException("EPC CRC/PC are protected; write within the current EPC length");
        }
        if (bank.equals("RESERVED") && offset + paddedLength(length) > 8) {
            throw new IllegalArgumentException("Reserved memory is bytes 0–7");
        }
        if ((bank.equals("TID") || bank.equals("RESERVED")) && !confirmed) {
            throw new IllegalArgumentException("Confirm the sensitive memory bank before writing");
        }
    }

    public static boolean matchesBaseline(String chunk, String baseline, int offsetWords) {
        String expected = hex(chunk, false), actual = hex(baseline, false);
        if (expected.length() % 4 != 0 || offsetWords < 0)
            throw new IllegalArgumentException("Invalid word range");
        int start = offsetWords * 4;
        return start <= actual.length() && expected.length() <= actual.length() - start
                && actual.regionMatches(start, expected, 0, expected.length());
    }

    public static int paddedLength(int length) { return length + length % 2; }

    public static boolean allTrue(boolean[] values) {
        for (boolean value : values) if (!value) return false;
        return true;
    }

    public static double maxSupportedDbm(int[] levels) {
        if (levels == null || levels.length == 0) throw new IllegalArgumentException("Reader power levels are unavailable");
        double max = serialPowerDbm(levels[0]);
        for (int level : levels) max = Math.max(max, serialPowerDbm(level));
        return max;
    }

    private static void addSupported(List<Double> powers, int[] levels, double... candidates) {
        for (double candidate : candidates) {
            if (!Double.isFinite(candidate)) continue;
            boolean supported = false;
            for (int level : levels) if (Math.abs(serialPowerDbm(level) - candidate) < 0.00001) supported = true;
            if (supported && !powers.contains(candidate)) powers.add(candidate);
        }
    }

    /** Split complete word data into bounded writes; callers verify every returned chunk. */
    public static List<String> wordChunks(String data, int maxWords) {
        String normalized = hex(data, false);
        if (normalized.length() % 4 != 0 || maxWords < 1) {
            throw new IllegalArgumentException("Write data must contain complete words and use a positive chunk size");
        }
        int maxHex = maxWords * 4;
        List<String> chunks = new ArrayList<>();
        for (int first = 0; first < normalized.length(); first += maxHex) {
            chunks.add(normalized.substring(first, Math.min(normalized.length(), first + maxHex)));
        }
        return chunks;
    }

    /** Writes start at the reader's maximum so a low scan range still reaches the tag; USER may then step down. */
    public static List<Double> userWritePowers(double currentDbm, int[] levels) {
        return userWritePowers(currentDbm, levels, null);
    }

    /** A previously verified write power is tried after maximum if the near field saturates. */
    public static List<Double> userWritePowers(double currentDbm, int[] levels, Double lastVerifiedDbm) {
        List<Double> powers = new ArrayList<>();
        addSupported(powers, levels, maxSupportedDbm(levels), lastVerifiedDbm == null ? Double.NaN : lastVerifiedDbm, 20, 15, 10);
        if (powers.isEmpty()) powers.add(currentDbm);
        return powers;
    }

    /** EPC/RESERVED writes start at maximum, then step through proven high levels if the tag needs less. */
    public static java.util.List<Double> epcWritePowers(double currentDbm, int[] levels) {
        java.util.List<Double> powers = new java.util.ArrayList<>();
        addSupported(powers, levels, maxSupportedDbm(levels), 27, 24, currentDbm);
        if (powers.isEmpty()) powers.add(currentDbm);
        return powers;
    }

    /** Missing-tag errors are safe to wait on before any write is issued. */
    public static boolean tagAbsent(String explained) {
        if (explained == null || explained.isEmpty()) return false;
        String text = explained.toLowerCase(Locale.ROOT);
        // MC3390R appends a stale "Operation In Progress" vendor text to tag read failures while the radio is idle.
        if (text.contains("access_tag_read_failed") && !text.contains("charging")) return true;
        if (text.contains("charging") || text.contains("insufficient") || text.contains("password")
                || text.contains("overrun") || text.contains("operation in progress")) return false;
        return text.contains("no tag") || text.contains("no_tags") || text.contains("timeout")
                || text.contains("not found") || text.contains("out of range")
                || text.contains("no read-back") || text.contains("access_tag_read_failed")
                || text.contains("access_no_tag");
    }

    /** Never fill a neighboring byte with an assumed value. */
    public static String wordData(String data, String before) {
        String normalized = hex(data, false);
        String baseline = hex(before, false);
        int required = paddedLength(normalized.length() / 2) * 2;
        if (baseline.length() != required) {
            throw new IllegalArgumentException("Could not read the entire target word range; nothing was written");
        }
        return normalized.length() % 4 == 0 ? normalized
                : normalized + baseline.substring(normalized.length(), required);
    }

    public static String newEpc(String oldEpc, String bank, int offset, String data) {
        if (!bank.equals("EPC")) return hex(oldEpc, false);
        int first = (offset - 4) * 2;
        return oldEpc.substring(0, first) + hex(data, false)
                + oldEpc.substring(first + data.length());
    }

    public static void verifyReadBack(String expected, String actual) {
        if (!hex(expected, false).equals(hex(actual, false)))
            throw new IllegalStateException("Read-back did not match the complete written word range; check the tag before retrying");
    }

    public static long reservedVerifyPassword(String reserved) {
        String data = hex(reserved, false);
        if (data.length() != 16) throw new IllegalArgumentException("Read the complete RESERVED bank before changing passwords");
        return Long.parseLong(data.substring(8, 16), 16);
    }

    public static long password(String password) {
        return password.isEmpty() ? 0L : Long.parseLong(password, 16);
    }

    public static int powerIndex(int[] values, double dbm) {
        if (!Double.isFinite(dbm) || values == null || values.length == 0) {
            throw new IllegalArgumentException("Reader power levels are unavailable");
        }
        for (int i = 0; i < values.length; i++) {
            if (Math.abs(serialPowerDbm(values[i]) - dbm) < 0.00001) return i;
        }
        throw new IllegalArgumentException("Choose a transmit power supported by this reader");
    }

    /** SERVICE_SERIAL ProtocolASCII values map directly to ZETI power in tenths of dBm. */
    public static double serialPowerDbm(int rawValue) { return rawValue / 10.0; }
}
