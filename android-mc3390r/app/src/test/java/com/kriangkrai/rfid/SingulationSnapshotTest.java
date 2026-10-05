package com.kriangkrai.rfid;
import com.zebra.rfid.api3.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class SingulationSnapshotTest {
    @Test public void restoresValuesEvenWhenAccessMutatesOriginalSdkObject() {
        Antennas.SingulationControl original = new Antennas.SingulationControl();
        original.setSession(SESSION.SESSION_S0);
        original.setTagPopulation((short)32);
        original.setTagTransitTime((short)7);
        original.Action.setInventoryState(INVENTORY_STATE.INVENTORY_STATE_AB_FLIP);
        original.Action.setPerformStateAwareSingulationAction(true);
        SingulationSnapshot snapshot = new SingulationSnapshot(original);
        original.setSession(SESSION.SESSION_S1);
        original.setTagPopulation((short)1);
        original.Action.setInventoryState(INVENTORY_STATE.INVENTORY_STATE_B);
        original.Action.setPerformStateAwareSingulationAction(false);
        snapshot.applyTo(original);
        assertEquals(SESSION.SESSION_S0, original.getSession());
        assertEquals(32, original.getTagPopulation());
        assertEquals(7, original.getTagTransitTime());
        assertEquals(INVENTORY_STATE.INVENTORY_STATE_AB_FLIP, original.Action.getInventoryState());
        assertTrue(original.Action.isPerformStateAwareSingulationActionSet());
    }
}
