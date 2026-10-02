package com.kriangkrai.rfid;
import org.junit.Test;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;
public class MemoryReadSessionTest {
 @Test public void busyReadIsStoppedBeforeRetryAndSuccessIsCleanedUp() throws Exception {
  AtomicInteger reads=new AtomicInteger(),stops=new AtomicInteger();
  String value=MemoryReadSession.run(()->{ assertEquals(reads.get(),stops.get()); if(reads.getAndIncrement()==0)throw new Exception("busy");return "E280";},stops::incrementAndGet,e->e.getMessage().equals("busy"),()->{});
  assertEquals("E280",value);assertEquals(2,stops.get());
 }
 @Test public void memoryOverrunIsCleanedUpButNeverRetriedAsBusy() {
  AtomicInteger reads=new AtomicInteger(),stops=new AtomicInteger();
  try{MemoryReadSession.run(()->{reads.incrementAndGet();throw new Exception("overrun");},stops::incrementAndGet,e->false,()->{});fail();}catch(Exception expected){assertEquals("overrun",expected.getMessage());}
  assertEquals(1,reads.get());assertEquals(1,stops.get());
 }
 @Test public void persistentBusyIsBoundedToThreeReadAttempts() {
  AtomicInteger stops=new AtomicInteger();
  try{MemoryReadSession.run(()->{throw new Exception("busy");},stops::incrementAndGet,e->true,()->{});fail();}catch(Exception expected){assertEquals("busy",expected.getMessage());}
  assertEquals(3,stops.get());
 }
}
