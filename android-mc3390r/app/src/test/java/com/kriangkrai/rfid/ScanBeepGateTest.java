package com.kriangkrai.rfid;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScanBeepGateTest {
    @Test public void followsActualReadEventsAtThirtyMillisecondsAndFaster() {
        ScanBeepGate gate = new ScanBeepGate();
        for (int ms = 0; ms <= 3000; ms += 30) assertTrue(gate.shouldPlay(ms, true, true));
        assertTrue(gate.shouldPlay(3001, true, true));
        assertTrue(gate.shouldPlay(3002, true, true));
    }
    @Test public void emptyOrInvalidEpcsDoNotProduceScanSounds() {
        assertFalse(ScanBeepGate.isCompleteEpc(null));
        assertFalse(ScanBeepGate.isCompleteEpc(""));
        assertFalse(ScanBeepGate.isCompleteEpc("E2801"));
        assertFalse(ScanBeepGate.isCompleteEpc("E280ZZ"));
        assertFalse(ScanBeepGate.isCompleteEpc("E280 1234"));
        assertTrue(ScanBeepGate.isCompleteEpc("000000000054455354303036"));
        assertTrue(ScanBeepGate.isCompleteEpc("e2801234"));
        ScanBeepGate gate = new ScanBeepGate();
        assertFalse(gate.shouldPlay(1000, true, false));
        assertTrue(gate.shouldPlay(1000, true, true));
    }
    @Test public void inactiveBaselineBackgroundAndAccessOperationsCannotConsumeSoundBudget() {
        ScanBeepGate gate = new ScanBeepGate();
        assertFalse(gate.shouldPlay(100, false, true));
        assertTrue(gate.shouldPlay(100, true, true));
        assertFalse(gate.shouldPlay(400, false, true));
        assertFalse(gate.shouldPlay(800, false, true));
        assertTrue(gate.shouldPlay(800, true, true));
    }
    @Test public void aLongGapDoesNotAccumulateCatchupBeeps() {
        ScanBeepGate gate = new ScanBeepGate();
        assertTrue(gate.shouldPlay(1000, true, true));
        assertTrue(gate.shouldPlay(1000000, true, true));
        assertTrue(gate.shouldPlay(1000030, true, true));
        assertTrue(gate.shouldPlay(1000300, true, true));
    }
    @Test public void invalidOrRewindingClockDoesNotBypassTheLimit() {
        ScanBeepGate gate = new ScanBeepGate();
        assertFalse(gate.shouldPlay(-1, true, true));
        assertTrue(gate.shouldPlay(1000, true, true));
        assertFalse(gate.shouldPlay(500, true, true));
        assertTrue(gate.shouldPlay(1001, true, true));
        assertTrue(gate.shouldPlay(1300, true, true));
    }
}
