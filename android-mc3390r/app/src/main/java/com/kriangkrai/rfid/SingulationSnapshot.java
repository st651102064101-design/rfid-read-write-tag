package com.kriangkrai.rfid;

import com.zebra.rfid.api3.*;

/** Value snapshot: access filters can mutate the SDK's returned configuration object. */
final class SingulationSnapshot {
    private final SESSION session;
    private final short population, transitTime;
    private final INVENTORY_STATE inventoryState;
    private final SL_FLAG slFlag;
    private final boolean stateAware;

    SingulationSnapshot(Antennas.SingulationControl config) {
        session = config.getSession();
        population = config.getTagPopulation();
        transitTime = config.getTagTransitTime();
        inventoryState = config.Action.getInventoryState();
        slFlag = config.Action.getSLFlag();
        stateAware = config.Action.isPerformStateAwareSingulationActionSet();
    }

    void applyTo(Antennas.SingulationControl config) {
        config.setSession(session);
        config.setTagPopulation(population);
        config.setTagTransitTime(transitTime);
        config.Action.setInventoryState(inventoryState);
        config.Action.setSLFlag(slFlag);
        config.Action.setPerformStateAwareSingulationAction(stateAware);
    }

    void restore(RFIDReader reader) throws InvalidUsageException, OperationFailureException {
        Antennas.SingulationControl config = reader.Config.Antennas.getSingulationControl(1);
        applyTo(config);
        reader.Config.Antennas.setSingulationControl(1, config);
    }
}
