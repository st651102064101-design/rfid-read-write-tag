package com.kriangkrai.rfid;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/** Coalesces SDK notifications; one bounded drain runs on the SDK owner executor. */
final class InventoryPump {
    private final Executor executor;
    private final BooleanSupplier drain;
    private final AtomicBoolean scheduled = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean notified = new AtomicBoolean();
    InventoryPump(Executor executor, BooleanSupplier drain) { this.executor = executor; this.drain = drain; }
    void close() { closed.set(true); notified.set(false); }
    void signal() {
        if (closed.get()) return;
        notified.set(true);
        if (scheduled.compareAndSet(false, true)) {
            try { executor.execute(this::run); }
            catch (RejectedExecutionException error) { scheduled.set(false); if (!closed.get()) throw error; }
        }
    }
    private void run() {
        boolean more = false;
        notified.set(false);
        try { if (!closed.get()) more = drain.getAsBoolean(); }
        finally {
            scheduled.set(false);
            // Includes notifications arriving during the last fetch or between these atomics.
            if (more || notified.get()) signal();
        }
    }
}
