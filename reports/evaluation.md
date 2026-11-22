Synthetic plate-sequence benchmark: 120 registry vehicles x 8 degraded frames (raw + CLAHE reads), easy/medium/hard thirds, tau = 0.55. Device: cuda.

**OCR benchmark** (full PRISM fusion + matching)

| OCR backend | Committed-char error | Recovery | Top-1 | Top-5 | False-match | ms/read |
|---|---|---|---|---|---|---|
| parseq | 6.4% | 69.1% | 72.5% | 79.2% | 0.8% | 56.1 |
| fast_plate_ocr | 3.0% | 44.8% | 51.7% | 62.5% | 0.8% | 28.9 |

Winner: **parseq** (highest top-1 with false-match <= 5%, then lowest committed error).

**Ablation** (parseq)

| Variant | Committed error | Recovery | Top-5 | False-match |
|---|---|---|---|---|
| Best single frame, no fusion | 15.6% | 73.3% | 75.8% | 0.0% |
| Majority vote, no confidence masking | 13.9% | 68.3% | 72.5% | 0.0% |
| + confidence masking | 14.9% | 67.4% | 73.3% | 0.0% |
| + two-condition vote | 10.3% | 69.1% | 76.7% | 0.8% |
| + format check + coverage factor (full PRISM) | 6.4% | 69.1% | 79.2% | 0.8% |

**Full PRISM by difficulty**

| Level | Committed error | Recovery | Top-1 | Top-5 | False-match |
|---|---|---|---|---|---|
| easy | 0.0% | 99.2% | 97.5% | 97.5% | 0.0% |
| medium | 2.2% | 93.5% | 95.0% | 97.5% | 2.5% |
| hard | 44.3% | 15.1% | 25.0% | 42.5% | 0.0% |

**Threshold sweep**: lowest tau with false-match rate <= 5% is **0.30** (false-match 3.3%, correct MATCHED 62.5%). Plot: `reports/tau_sweep.png`.

**End-to-end clips** (full pipeline: YOLO11 + ByteTrack + fast-alpr + OCR + OpenCLIP)

| Clip | Degradation | Fused plate | Status (expected) | Top-1 | Committed wrong | Colour/body | False-match | s |
|---|---|---|---|---|---|---|---|---|
| day_clear_white.mp4 | none | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 27.5 |
| night_partial_white.mp4 | none | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 11.0 |
| camB_white.mp4 | none | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.8 |
| day_black_suv.mp4 | none | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 10.1 |
| day_blue_twoline.mp4 | none | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.9 |
| unregistered_white.mp4 | none | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 11.1 |
| camB_white__gauss.mp4 | gauss | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.1 |
| camB_white__motion.mp4 | motion | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.3 |
| camB_white__down2x.mp4 | down2x | `G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 10.0 |
| camB_white__down4x.mp4 | down4x | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 10.2 |
| camB_white__jpeg20.mp4 | jpeg20 | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.8 |
| camB_white__noise_dark.mp4 | noise_dark | `?G04MX4821` | MATCHED (MATCHED) | yes | 0/9 | x/ok | no | 11.2 |
| day_black_suv__gauss.mp4 | gauss | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 9.2 |
| day_black_suv__motion.mp4 | motion | `` | NO CONFIDENT MATCH (MATCHED) | yes | 0/0 | ok/ok | no | 9.2 |
| day_black_suv__down2x.mp4 | down2x | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.4 |
| day_black_suv__down4x.mp4 | down4x | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.1 |
| day_black_suv__jpeg20.mp4 | jpeg20 | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 10.0 |
| day_black_suv__noise_dark.mp4 | noise_dark | `MH12DE5678` | MATCHED (MATCHED) | yes | 0/10 | ok/x | no | 9.2 |
| day_blue_twoline__gauss.mp4 | gauss | `??????` | NO CONFIDENT MATCH (MATCHED) | yes | 0/0 | ok/ok | no | 8.8 |
| day_blue_twoline__motion.mp4 | motion | `???P00?3` | NO CONFIDENT MATCH (MATCHED) | no | 2/4 | ok/ok | no | 9.5 |
| day_blue_twoline__down2x.mp4 | down2x | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.3 |
| day_blue_twoline__down4x.mp4 | down4x | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 9.9 |
| day_blue_twoline__jpeg20.mp4 | jpeg20 | `KA05MN2023` | MATCHED (MATCHED) | yes | 0/10 | ok/ok | no | 10.6 |
| day_blue_twoline__noise_dark.mp4 | noise_dark | `KA05MN` | NO CONFIDENT MATCH (MATCHED) | yes | 0/6 | ok/ok | no | 9.4 |
| day_clear_white__gauss.mp4 | gauss | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 11.0 |
| day_clear_white__motion.mp4 | motion | `??????4?2?` | NO CONFIDENT MATCH (MATCHED) | no | 0/2 | x/ok | no | 10.5 |
| day_clear_white__down2x.mp4 | down2x | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 10.1 |
| day_clear_white__down4x.mp4 | down4x | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 9.6 |
| day_clear_white__jpeg20.mp4 | jpeg20 | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 10.7 |
| day_clear_white__noise_dark.mp4 | noise_dark | `CG04MX4821` | MATCHED (MATCHED) | yes | 0/10 | x/ok | no | 11.0 |
| night_partial_white__gauss.mp4 | gauss | `CG04MX4???` | AMBIGUOUS (AMBIGUOUS) | no | 0/7 | x/ok | no | 11.3 |
| night_partial_white__motion.mp4 | motion | `` | NO CONFIDENT MATCH (AMBIGUOUS) | no | 0/0 | x/ok | no | 10.6 |
| night_partial_white__down2x.mp4 | down2x | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.5 |
| night_partial_white__down4x.mp4 | down4x | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.5 |
| night_partial_white__jpeg20.mp4 | jpeg20 | `CG04MX4881` | NO CONFIDENT MATCH (AMBIGUOUS) | yes | 1/10 | x/ok | no | 10.6 |
| night_partial_white__noise_dark.mp4 | noise_dark | `CG04MX48?1` | AMBIGUOUS (AMBIGUOUS) | yes | 0/9 | x/ok | YES | 9.8 |
| unregistered_white__gauss.mp4 | gauss | `M??4XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/8 | x/ok | no | 9.8 |
| unregistered_white__motion.mp4 | motion | `?H?4XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/8 | x/ok | no | 9.2 |
| unregistered_white__down2x.mp4 | down2x | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.2 |
| unregistered_white__down4x.mp4 | down4x | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 9.9 |
| unregistered_white__jpeg20.mp4 | jpeg20 | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 11.4 |
| unregistered_white__noise_dark.mp4 | noise_dark | `MH14XY0042` | NO CONFIDENT MATCH (NO CONFIDENT MATCH) | no | 0/10 | x/ok | no | 11.2 |

Clips (42): status as designed 83.3%, committed-char error 0.8%, recovery 83.6%, top-1 88.6%, top-5 97.1%, MATCHED to the wrong vehicle 0, false-match with true vehicle removed 9.5%, colour 33.3%, body 90.5%, mean 10.6 s/clip.
