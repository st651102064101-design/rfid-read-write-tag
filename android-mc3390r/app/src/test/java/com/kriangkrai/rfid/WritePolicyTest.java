package com.kriangkrai.rfid;

import org.junit.Test;
import static org.junit.Assert.*;

public class WritePolicyTest {
    private static final String EPC = "E2806F12000000022DF13118";

    @Test public void oddBytePreservesNeighborInsteadOfZeroPadding() {
        assertEquals("414243AB", WritePolicy.wordData("414243", "313233AB"));
        assertEquals("4142", WritePolicy.wordData("4142", "1234"));
    }
    @Test public void fullUserBankIsSplitIntoBoundedCompleteWordWrites() {
        StringBuilder source = new StringBuilder();
        for (int i = 0; i < 128; i++) source.append("ABCD");
        String data = source.toString();
        java.util.List<String> chunks = WritePolicy.wordChunks(data, 4);
        assertEquals(32, chunks.size());
        assertEquals(data, String.join("", chunks));
        for (String chunk : chunks) assertEquals(8, chunk.length() / 2);
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.wordChunks("ABC", 16));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.wordChunks("ABCD", 0));
    }
    @Test public void userWritesStepDownFromSaturatingNearFieldPower() {
        int[] table = new int[298];
        for (int i = 0; i < table.length; i++) table[i] = i;
        assertEquals(java.util.Arrays.asList(20.0, 15.0, 10.0), WritePolicy.userWritePowers(27, table));
        assertEquals(java.util.Arrays.asList(12.5, 15.0, 10.0), WritePolicy.userWritePowers(12.5, table));
        assertEquals(java.util.Arrays.asList(5.0), WritePolicy.userWritePowers(5, new int[]{50}));
        assertEquals(java.util.Arrays.asList(10.0, 20.0, 15.0), WritePolicy.userWritePowers(27, table, 10.0));
    }
    @Test public void shortBaselineNeverProducesAWrite() {
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.wordData("414243", "1234"));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.wordData("414243", "1234567890"));
    }
    @Test public void epcHeaderAndLengthRemainProtected() {
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "EPC", 2, 2, "4142", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "EPC", 14, 3, "414243", "", false));
        WritePolicy.validate(EPC, "EPC", 4, 3, "414243", "", false);
        assertEquals("41424312000000022DF13118", WritePolicy.newEpc(EPC, "EPC", 4, "414243"));
    }
    @Test public void reservedLimitsAndSensitiveConfirmationAreMandatory() {
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "RESERVED", 0, 2, "4142", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "TID", 0, 2, "4142", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "RESERVED", 6, 3, "414243", "", true));
        WritePolicy.validate(EPC, "RESERVED", 6, 1, "41", "FFFFFFFF", true);
        assertEquals(4294967295L, WritePolicy.password("FFFFFFFF"));
    }
    @Test public void inputMustMatchTheActualBytesAndWordOffset() {
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "USER", 1, 2, "4142", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "USER", 0, 3, "4142", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "USER", 0, 2, "41GG", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "USER", 0, 2, "4142", "123", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "USER", 0, 0, "", "", false));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.validate(EPC, "USER", Integer.MAX_VALUE - 1, 2, "4142", "", false));
        WritePolicy.validate(EPC, "USER", 0, 3, "414243", "", false);
    }
    @Test public void powerUsesActualSdkValuesNotPercentageOrArrayLength() {
        int[] levels = {50, 100, 250, 275};
        assertEquals(2, WritePolicy.powerIndex(levels, 25));
        assertEquals(3, WritePolicy.powerIndex(levels, 27.5));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.powerIndex(levels, 30));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.powerIndex(levels, Double.NaN));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.powerIndex(new int[0], 0));
    }
    @Test public void mc3390rSerialPowerTableIsTenthsDbm() {
        int[] actualTable = new int[298];
        for (int i = 0; i < actualTable.length; i++) actualTable[i] = i;
        assertEquals(29.7, WritePolicy.serialPowerDbm(actualTable[297]), 0.000001);
        assertEquals(200, WritePolicy.powerIndex(actualTable, 20));
        assertEquals(297, WritePolicy.powerIndex(actualTable, 29.7));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.powerIndex(actualTable, 30));
        assertThrows(IllegalArgumentException.class, () -> WritePolicy.powerIndex(actualTable, 2.97));
    }

    @Test public void everyBankRequiresExactVerifiedWords() {
        for (String bank : new String[]{"USER", "EPC", "TID", "RESERVED"}) {
            int offset=bank.equals("EPC")?4:0;
            WritePolicy.validate(EPC,bank,offset,3,"414243","",true);
            String words=WritePolicy.wordData("414243","313233AB");
            assertEquals("414243AB",words);
            WritePolicy.verifyReadBack(words,"414243ab");
            assertThrows(IllegalStateException.class,()->WritePolicy.verifyReadBack(words,"41424300"));
            assertThrows(IllegalStateException.class,()->WritePolicy.verifyReadBack(words,"4142"));
        }
    }
    @Test public void reservedReadBackUsesTheNewAccessPasswordNotKillPassword() {
        assertEquals(0xFFFFFFFFL,WritePolicy.reservedVerifyPassword("11223344FFFFFFFF"));
        assertEquals(0,WritePolicy.reservedVerifyPassword("FFFFFFFF00000000"));
        assertThrows(IllegalArgumentException.class,()->WritePolicy.reservedVerifyPassword("1234"));
    }
    @Test public void nonEpcWritesNeverChangeTheTargetIdentifier() {
        for(String bank:new String[]{"USER","TID","RESERVED"})assertEquals(EPC,WritePolicy.newEpc(EPC,bank,0,"4142"));
    }
}
