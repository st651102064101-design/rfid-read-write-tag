# MC3390R performance validation — 2026-10-06

Zebra advertises a fastest inventory read rate of 900+ tags/sec for MC3390R and MC3390xR. These specifications do not give a per-tag write latency or guarantee that a small set of tags, repeated EPCs, TID reads, or complete USER rewrites achieves that inventory rate.

Sources:
- https://www.zebra.com/us/en/products/spec-sheets/rfid/rfid-handhelds/mc3390r.html
- https://www.zebra.com/us/en/products/spec-sheets/rfid/rfid-handhelds/mc3390xr.html

## Physical measurement

MC3390R, existing tags in the field, 29.7 dBm, session S0, AB flip. EPC inventory (TID inventory temporarily disabled and restored). Reports are repeated observations, not a count of distinct physical tags.

Before restoring immediate start/stop triggers on every inventory start: 1–2 reports per 10-second run. After the fix, three runs at RF mode 21/population 32: 108.26, 106.28, 106.56 reports/sec. SDK and UI report totals matched; no delivery overflow or buffer-full event.

Mode comparison, population 8, approximately 3 seconds per mode:

| RF mode | Reports/sec |
| --- | ---: |
| 0 | 80.90 |
| 3 | 101.41 |
| 11 | 99.91 |
| 17 | 81.76 |
| 21 | 106.51 |

The 900+ target is **not achieved** in this setup. This is not evidence of the hardware's maximum capability. TID+EPC inventory must be measured separately.

## Correctness

Every start restores immediate triggers because SDK access operations can replace the stop trigger. USER planning may skip matching chunks, but a cached baseline is never sufficient for a successful no-op: actual tag memory is read and checked. Write success remains conditional on read-back.

Java and UI unit tests test application behavior, not RF speed. They cannot establish a millisecond hardware latency. The user authorized writes in the pile. Three tags were temporarily assigned unique test EPCs; actual complete EPC read-back was required. USER data was backed up before testing.

| Operation | Native time | Total command time | Verified |
| --- | ---: | ---: | --- |
| Single EPC, 12 bytes | 879 ms | 941 ms | Yes |
| Batch EPC target 1 | 958 ms | 1,005 ms | Yes |
| Batch EPC target 2 | 755 ms | 787 ms | Yes |
| Both batch targets | — | 1,792 ms | Both |
| USER 256-byte replacement, 8-byte chunks, before | 8,586 ms | 8,637 ms | Yes |
| USER 256-byte replacement, 32-byte chunks, after | 3,596 ms | 3,651 ms | Yes |
| Short USER text change before chunk increase | 806 ms | 851 ms | Yes |

The USER before/after runs used the same complete initial and desired contents. They also differed in retry/power behavior (3 versus 1 retries), so this is an observed end-to-end improvement, not a controlled attribution to chunk size alone. A cold 32-byte-chunk write still took 4,662 ms with 2 retries. USER data was subsequently restored and read-back verified (4,522 ms). Full factory reset was not benchmarked; no 1-second claim is made for it, for arbitrary multi-tag batches, or for USER replacement.

The app now reuses the previously proven write power before trying other supported levels. Changed USER chunks remain idempotent and complete-range read-back checks prevent speed optimization from inventing success.

## Reproduce

Connect ADB, forward the app WebView devtools socket to TCP 9223, and run:

```powershell
node android-mc3390r/.sdk-inspect/cdp.mjs --file scripts/mc3390r-epc-performance.js
```

The benchmark performs inventory only, verifies delivery totals, and restores the original RF settings and TID scan mode. Keep tags stationary and do not pull the trigger during the measurement.
