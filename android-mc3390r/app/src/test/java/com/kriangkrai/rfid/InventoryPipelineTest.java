package com.kriangkrai.rfid;

import java.util.ArrayDeque;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;

public class InventoryPipelineTest {
    @Test public void shutdownCancelsQueuedDrainsAndRejectsLateNotifications() {
        Queue<Runnable> tasks=new ArrayDeque<>();AtomicInteger drains=new AtomicInteger();
        InventoryPump p=new InventoryPump(tasks::add,()->{drains.incrementAndGet();return true;});
        p.signal();p.close();tasks.remove().run();p.signal();assertTrue(tasks.isEmpty());assertEquals(0,drains.get());
    }
    @Test public void hundredThousandNotificationsQueueOneDrainWithoutDelay() {
        Queue<Runnable> tasks = new ArrayDeque<>(); AtomicInteger drains = new AtomicInteger();
        InventoryPump pump = new InventoryPump(tasks::add, () -> { drains.incrementAndGet(); return false; });
        for (int i=0; i<100000; i++) pump.signal();
        assertEquals(1,tasks.size()); tasks.remove().run(); assertEquals(1,drains.get()); assertTrue(tasks.isEmpty());
        pump.signal(); assertEquals(1,tasks.size()); tasks.remove().run(); assertEquals(2,drains.get());
    }
    @Test public void notificationDuringDrainIsNotLost() {
        Queue<Runnable> tasks = new ArrayDeque<>(); AtomicInteger drains = new AtomicInteger();
        InventoryPump[] holder = new InventoryPump[1];
        holder[0] = new InventoryPump(tasks::add, () -> { if(drains.incrementAndGet()==1)holder[0].signal();return false; });
        holder[0].signal();tasks.remove().run();assertEquals(1,tasks.size());tasks.remove().run();assertEquals(2,drains.get());assertTrue(tasks.isEmpty());
    }
    @Test public void fullChunksYieldToQueuedStopRatherThanStarveControls() {
        Queue<Runnable> tasks = new ArrayDeque<>();StringBuilder order=new StringBuilder();AtomicInteger drains=new AtomicInteger();
        InventoryPump pump=new InventoryPump(tasks::add,()->{order.append('D');return drains.incrementAndGet()<3;});
        pump.signal();tasks.add(()->order.append('S'));while(!tasks.isEmpty())tasks.remove().run();assertEquals("DSDD",order.toString());
    }
    @Test public void millionReportsAcrossThousandTagsPreserveEveryCountAndMetadata() {
        InventoryBatch buffer=new InventoryBatch();String[] epcs=new String[1000];for(int i=0;i<epcs.length;i++)epcs[i]=String.format("E280%08X",i);
        for(int i=0;i<1000000;i++)assertTrue(buffer.add(epcs[i%1000],-45,1,123,456,3,i));
        long[] counters=buffer.counters();assertEquals(1000000,counters[0]);assertEquals(3000000,counters[1]);assertEquals(0,counters[3]);
        List<InventoryBatch.Report> reports=buffer.take();assertEquals(1000,reports.size());long count=0,seen=0;
        for(InventoryBatch.Report r:reports){count+=r.reportCount;seen+=r.seenCount;assertEquals(123,r.pc);assertEquals(456,r.crc);assertEquals(1,r.antenna);}
        assertEquals(1000000,count);assertEquals(3000000,seen);assertTrue(buffer.take().isEmpty());
    }
    @Test public void deliverySnapshotsAreNotMutatedBySubsequentSdkReports() {
        InventoryBatch b=new InventoryBatch();b.add("e2801234",-30,1,12,34,2,100);
        InventoryBatch.Report first=b.take().get(0);b.add("E2801234",-50,2,56,78,5,200);
        assertEquals("E2801234",first.epc);assertEquals(2,first.seenCount);assertEquals(-30,first.rssi);assertEquals(100,first.receivedAt);
        assertEquals(5,b.take().get(0).seenCount);assertEquals(7,b.counters()[1]);
    }
    @Test public void tagsSharingAnEpcStaySeparateByTid() {
        InventoryBatch b=new InventoryBatch();String zero="000000000000000000000000";
        assertTrue(b.add(zero,"e2801191200063b7d1710346",-40,1,0,0,2,1));assertTrue(b.add(zero,"E280689420004026CE01B477",-50,1,0,0,3,2));
        assertTrue(b.add(zero,"E2801191200063B7D1710346",-41,1,0,0,1,3));assertTrue(b.add(zero,null,-60,1,0,0,1,4));assertTrue(b.add(zero,"not-hex",-60,1,0,0,1,5));
        List<InventoryBatch.Report> reports=b.take();assertEquals(3,reports.size());
        assertEquals("E2801191200063B7D1710346",reports.get(0).tid);assertEquals(3,reports.get(0).seenCount);
        assertEquals("E280689420004026CE01B477",reports.get(1).tid);assertNull(reports.get(2).tid);assertEquals(2,reports.get(2).seenCount);
    }
    @Test public void invalidDataAndCapacityOverflowAreExplicitNotCountedAsSuccessfulDelivery() {
        InventoryBatch b=new InventoryBatch();assertFalse(b.add("BAD!",0,0,0,0,1,0));assertEquals(0,b.counters()[0]);assertEquals(1,b.counters()[2]);
        for(int i=0;i<InventoryBatch.MAX_PENDING_TAGS;i++)assertTrue(b.add(String.format("%08X",i),0,0,0,0,1,0));
        assertFalse(b.add("FFFFFFFF",0,0,0,0,1,0));assertEquals(1,b.counters()[3]);assertEquals(InventoryBatch.MAX_PENDING_TAGS,b.take().size());
    }
}
