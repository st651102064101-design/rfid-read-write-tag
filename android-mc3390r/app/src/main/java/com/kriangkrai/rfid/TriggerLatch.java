package com.kriangkrai.rfid;
/** Physical trigger state is independent of inventory events and access-operation timing. */
final class TriggerLatch {
    private volatile boolean held;
    void event(boolean pressed) { held = pressed; }
    boolean held() { return held; }
    boolean wantsInventory(boolean barcode, boolean foreground, boolean disposed) {
        return held && !barcode && foreground && !disposed;
    }
    void clear() { held = false; }
}
