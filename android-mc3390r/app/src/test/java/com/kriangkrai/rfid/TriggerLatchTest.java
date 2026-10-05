package com.kriangkrai.rfid;
import org.junit.Test;
import static org.junit.Assert.*;
public class TriggerLatchTest {
 @Test public void accessAndInventoryStopDoNotReleaseHeldTrigger(){
  TriggerLatch latch=new TriggerLatch(); latch.event(true);
  for(int i=0;i<100000;i++) assertTrue(latch.wantsInventory(false,true,false));
  latch.event(false);assertFalse(latch.wantsInventory(false,true,false));
 }
 @Test public void latestReleaseWinsOverDelayedPressCommand(){
  TriggerLatch latch=new TriggerLatch();latch.event(true);latch.event(false);assertFalse(latch.held());
 }
 @Test public void barcodePauseAndDisposeNeverResumeRfid(){
  TriggerLatch latch=new TriggerLatch();latch.event(true);
  assertFalse(latch.wantsInventory(true,true,false));assertFalse(latch.wantsInventory(false,false,false));assertFalse(latch.wantsInventory(false,true,true));
  latch.clear();assertFalse(latch.held());
 }
}
