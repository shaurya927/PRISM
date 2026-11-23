# Third-party media

`scripts/build_scene_media.py` builds the files listed below. The other images in this folder are PRISM's own output.

| File | Source | Author | Licence | Changes |
|---|---|---|---|---|
| `highway.mp4`, `highway.webm`, `highway.jpg` | [Cars driving at night.webm](https://commons.wikimedia.org/wiki/File:Cars_driving_at_night.webm) (Wikimedia Commons) | [Editor (YouTube)](https://www.youtube.com/user/Editor) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 12 s excerpt from 2:08, end crossfaded into the start to loop, scaled to 1600 px, re-encoded as H.264 and VP9, no audio. |
| `highway_day.mp4`, `highway_day.webm`, `highway_day.jpg` | [I495 towards i270 spur from bradley blvd 20201123 171152609.webm](https://commons.wikimedia.org/wiki/File:I495_towards_i270_spur_from_bradley_blvd_20201123_171152609.webm) (Wikimedia Commons) | G. Edward Johnson | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 12 s excerpt from 0:14, end crossfaded into the start to loop, scaled to 1600 × 900, re-encoded as H.264 and VP9, no audio. Built by `scripts/build_day_media.py`. |
| `verna_spin.mp4`, `verna_spin.webm`, `verna_spin.jpg` | Screen recording of a Hyundai Verna 360° studio view, supplied by the PRISM team (`video_assets/`, not committed) | Not recorded | **Not verified.** Studio imagery of a production car is usually the manufacturer's copyright; replace this file before any public or commercial use unless you hold the rights. | 98 frames cut to 70 unique ones (repeated frames dropped), mouse cursor painted out, PRISM's plate read drawn onto the blanked (red) plates, scaled to 1440 px, no audio. |

`highway_tracks.json`, `highway_day_tracks.json` and `verna_spin.json` are derived data, not third-party media. `highway_tracks.json` and `highway_day_tracks.json` hold the YOLO11 + ByteTrack detections PRISM made on `highway.mp4` and `highway_day.mp4`. `verna_spin.json` holds the car and plate box for each frame of `verna_spin.mp4`.
