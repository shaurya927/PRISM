# Vehicle photos used for the two-wheeler, auto-rickshaw and truck demo clips

`scripts/make_demo_clips.py` covers the original plate in each photo with a rendered Indian plate and
animates it into a synthetic CCTV clip. The car clips use `vendor/vehicle-reidentification/reference_vehicles`
(not stored here). These three photos come from Wikimedia Commons, downscaled to 960 px wide:

| File | Source | Author | Licence |
|---|---|---|---|
| `scooter_rear_grey_activa.jpg` | [Honda Activa Rental- Goa 9.jpg](https://commons.wikimedia.org/wiki/File:Honda_Activa_Rental-_Goa_9.jpg) | Bssasidhar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `auto_front_blue_bajaj_re.jpg` | [Bajaj RE (front), Jakarta.jpg](https://commons.wikimedia.org/wiki/File:Bajaj_RE_(front),_Jakarta.jpg) | Sabung.hamster | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `truck_front_white_tata_ace.jpg` | [Tata ACE HT.jpg](https://commons.wikimedia.org/wiki/File:Tata_ACE_HT.jpg) | JUNGAL9992 | [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/) |

Changes for the clips: cropped to the vehicle, the original plate covered with a rendered synthetic plate,
scaled, composited onto a synthetic road, and degraded (blur, noise, JPEG). Because the auto-rickshaw photo is
CC BY-SA 4.0, `data/test_clips/day_auto_rickshaw.mp4` and any crops of it in `reports/` are shared under
CC BY-SA 4.0 too. The plates shown are synthetic and belong to the synthetic registry only.
