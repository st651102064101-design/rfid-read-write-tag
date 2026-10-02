package com.kriangkrai.rfid;

import java.util.concurrent.Callable;
import java.util.function.Predicate;

/** Only read operations are retried, and only when the SDK reports a busy access session. */
final class MemoryReadSession {
    interface Pause { void await() throws Exception; }
    static <T> T run(Callable<T> read, Runnable stop, Predicate<Exception> busy, Pause pause) throws Exception {
        for (int attempt = 0; ; attempt++) {
            try { return read.call(); }
            catch (Exception error) {
                if (attempt >= 2 || !busy.test(error)) throw error;
            } finally { stop.run(); pause.await(); }
        }
    }
}
