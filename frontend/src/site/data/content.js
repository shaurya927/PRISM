// Copy and structure for the project website. Numbers come from evaluation.json / cases.json.
import casesJson from "./cases.json";
import evaluation from "./evaluation.json";

export { evaluation };
export const REPO_URL = "https://github.com/shaurya927/PRISM";
export const TRUE_NIGHT_PLATE = "CG04MX4821"; // REG-0001, the vehicle in night_partial_white.mp4

export const NAV = [
  ["How it works", "/how-it-works"],
  ["Cases", "/cases"],
  ["Evaluation", "/evaluation"],
  ["Guardrails", "/guardrails"],
  ["About", "/about"],
];

const CASE_META = {
  night_partial_white: {
    title: "Night, plate half hidden",
    blurb: "One digit is never readable. Two registry cars differ only at that digit, so PRISM says AMBIGUOUS and names the frame to check.",
    tags: ["low light", "occlusion", "decoy"],
  },
  crosscam_night_partial_white__camB_white: {
    title: "Two cameras, one car",
    blurb: "Camera A lost one digit and camera B lost the first letter. Linked by appearance plus agreeing plate characters, the combined plate resolves the case.",
    tags: ["re-identification", "evidence merge"],
  },
  day_clear_white: {
    title: "Daylight, clear view",
    blurb: "The baseline: a white sedan in good light. All ten characters are read with confidence across many frames.",
    tags: ["baseline"],
  },
  camB_white: {
    title: "Second camera, cut-off edge",
    blurb: "The first letter is lost at the frame edge. Nine known characters are still enough for a confident, explained match.",
    tags: ["partial plate"],
  },
  day_black_suv: {
    title: "Black SUV",
    blurb: "A dark SUV in daylight. Colour, body type and make/model are scored next to the plate, and every part of the score is written out.",
    tags: ["attributes"],
  },
  day_blue_twoline: {
    title: "Two-line plate",
    blurb: "A square plate is split into its two rows before OCR, then read as one registration.",
    tags: ["two-line layout"],
  },
  unregistered_white: {
    title: "Not in the registry",
    blurb: "The plate is read cleanly but no registry record clears the threshold. The correct answer is NO CONFIDENT MATCH, with a written reason.",
    tags: ["negative case"],
  },
  day_scooter_twoline: {
    title: "Scooter from behind",
    blurb: "A grey Honda Activa with a two-line rear plate. YOLO's motorcycle class and CLIP agree on two-wheeler, and decoys differ by one digit or one letter.",
    tags: ["two-wheeler", "two-line layout"],
  },
  day_auto_rickshaw: {
    title: "Auto-rickshaw",
    blurb: "A Bajaj RE with a yellow commercial plate. COCO has no auto-rickshaw class, so the body type comes from the CLIP override.",
    tags: ["auto-rickshaw", "commercial plate"],
  },
  day_white_truck: {
    title: "Mini truck",
    blurb: "A white Tata Ace goods carrier with a yellow commercial plate. CLIP misreads the colour as yellow, which costs the colour part of the score; the plate and body type still decide the match.",
    tags: ["truck", "commercial plate"],
  },
};

export const CASE_ORDER = Object.keys(CASE_META).filter((k) => casesJson[k]);
export const CASES = CASE_ORDER.map((id, i) => ({ id, index: i + 1, ...CASE_META[id], ...casesJson[id] }));
export const caseById = (id) => CASES.find((c) => c.id === id);

export const STAGES = [
  {
    n: "00", name: "Ingest", short: "Hash the clip, flag low light",
    body: "PRISM computes the SHA-256 of the uploaded clip before anything else and records its metadata. A clip whose median frame brightness is below 60 (of 255) is flagged as low light, which shifts the match weights toward the plate.",
    img: "/media/night_partial_white_best.jpg",
  },
  {
    n: "01", name: "Track", short: "YOLO11 + ByteTrack",
    body: "Vehicles (car, motorcycle, bus, truck) are detected and tracked across frames. A track must last at least 5 frames. Each crop is padded by 5% so plates at the edge of a box are not cut off.",
    img: "/media/day_clear_white_best.jpg",
  },
  {
    n: "02", name: "Find plates", short: "Detector inside each vehicle",
    body: "The fast-alpr YOLOv9-t plate detector runs inside each vehicle crop, not on the whole frame. Plates below Laplacian sharpness 45 or narrower than 30 px are dropped; the 12 sharpest frames per track go forward, each as a raw and a CLAHE-enhanced copy. Two-line plates are split into rows.",
    img: "/media/day_blue_twoline_plate0.png", pixel: true,
  },
  {
    n: "03", name: "Read & mask", short: "PARSeq, below 0.70 becomes ?",
    body: "PARSeq reads each plate crop and returns a confidence per character. Any character under 0.70 becomes ?. An Indian plate-format check then runs, and it can only add more ?. It never changes or inserts a character.",
    img: "/media/night_partial_white_plate1.png", pixel: true,
  },
  {
    n: "04", name: "Fuse", short: "Two-condition vote across frames",
    body: "All reads are aligned to the most confident read of the most common length. Each character's evidence is its confidence times a sharpness weight. A position is filled only if the winner has evidence ≥ 0.9, at least 60% of the vote, and was read confidently in at least 40% of one camera's reads.",
    img: "/media/night_partial_white_strip.png",
  },
  {
    n: "05", name: "Describe", short: "Colour, body, make and model",
    body: "OpenCLIP ViT-B-32 scores colour, body type and a constrained make/model list on the three sharpest vehicle crops. Uncertain attributes (below 0.40) are reported as uncertain and earn no score.",
    img: "/media/day_black_suv_best.jpg",
  },
  {
    n: "06", name: "Match", short: "Ranked, explained shortlist",
    body: "Every registry record gets 0.65 × plate + 0.20 × colour + 0.15 × body (0.75 / 0.10 in low light). Plate similarity tolerates a one-character shift and gives partial credit to confusable pairs like 8/B and 0/O. The result is MATCHED, AMBIGUOUS or NO CONFIDENT MATCH, never a silent guess.",
    img: "/media/camB_white_best.jpg",
  },
  {
    n: "07", name: "Explain & report", short: "Advisor, summary, custody, PDF",
    body: "An advisor names the unknown position that would separate the top candidates and the frame that came closest to reading it. A summary is written and every sentence is checked against the evidence. The PDF report carries hashes of the clip, crops, registry and config.",
    img: "/media/unregistered_white_best.jpg",
  },
];

export const GUARDRAILS = [
  {
    t: "It never invents a character",
    d: "Only characters read at confidence ≥ 0.70 that fit an Indian plate layout carry any weight, and fusion needs two independent conditions to fill a position. Anything else stays ?.",
    test: "test_every_fused_char_was_read_confidently_in_a_real_frame (Hypothesis)",
  },
  {
    t: "The format check only removes",
    d: "The plate-grammar check returns the input or ? at each position. It cannot turn a 0 into an O to make a plate look valid.",
    test: "test_format_check_never_invents_or_changes (Hypothesis)",
  },
  {
    t: "Disagreement stays unknown",
    d: "If frames split between 8 and B with similar weight, the share test fails and the position stays ?.",
    test: "test_disagreement_8_vs_B_stays_unknown",
  },
  {
    t: "Super-resolution is for eyes only",
    d: "The upscaled plate is saved after OCR has finished and is never read back. The OCR gate refuses super-resolved images by type and by file name.",
    test: "test_pipeline_never_feeds_sr_to_ocr, test_gate_rejects_sr_image_and_sr_paths",
  },
  {
    t: "Contradictions rank last",
    d: "A registry record that contradicts a confidently read character is listed with the mismatch, ranked below every record that does not, and can never be MATCHED.",
    test: "tests/test_matcher.py",
  },
  {
    t: "Close scores are AMBIGUOUS",
    d: "If the top two candidates are within 0.05, or differ only by a similar shade (white/silver, silver/grey, grey/black), PRISM reports AMBIGUOUS and explains what would separate them.",
    test: "tests/test_matcher.py",
  },
  {
    t: "Appearance alone never links cameras",
    d: "Two sightings are linked only with appearance similarity above threshold, no plate conflict, at least 3 agreeing plate characters and the same body type.",
    test: "test_link_requires_appearance_and_plate_and_body",
  },
  {
    t: "It degrades, it doesn't crash",
    d: "Missing super-resolution weights, Re-ID repos, Ollama, Chromium or an OCR backend produce a warning and a fallback, not a failed case.",
    test: "test_super_res_disables_cleanly_without_weights, test_ollama_unavailable_falls_back, test_pdf_export_or_clean_fallback",
  },
];

// Feature tiles on the landing page. `art` picks the small visual in pages/Landing.jsx.
// Links starting with /app are full page loads (the investigator is a separate bundle).
export const FEATURES = [
  {
    id: "fusion", art: "fusion", title: "Multi-frame fusion",
    body: "Every frame is read and the reads are voted together. A position is filled only when enough confident reads agree.",
    to: "/how-it-works?tab=fusion", more: "How fusion works",
  },
  {
    id: "unknown", art: "unknown", title: "Unknown stays ?",
    body: "A character read below 0.70 confidence becomes ?. It stays unknown in the plate, the score and the report.",
    to: "/guardrails", more: "The guardrails",
  },
  {
    id: "shortlist", art: "shortlist", title: "Ranked, explained shortlist",
    body: "Registry records are scored on plate, colour and body, and every part of the score is written out.",
    to: "/app", more: "Open the investigator",
  },
  {
    id: "crosscam", art: "crosscam", title: "Two cameras, one car",
    body: "Two partial views are linked by appearance and agreeing plate characters, and each fills what the other missed.",
    to: "/how-it-works?tab=crosscam", more: "See the cross-camera case",
  },
];

export const QUOTES = [
  { id: "night_partial_white", field: "advisor", who: "Next-best-evidence advisor", role: "night_partial_white.mp4" },
  { id: "unregistered_white", field: "explanation", who: "Match explanation", role: "unregistered_white.mp4" },
  { id: "day_clear_white", field: "summary", who: "Evidence-checked summary", role: "day_clear_white.mp4" },
];

export const STATUS_INFO = {
  MATCHED: "Top score ≥ τ, at least 3 known characters, and a gap of at least 0.05 to the runner-up.",
  AMBIGUOUS: "Two candidates are too close to separate. PRISM names the position and frame that would decide it.",
  "NO CONFIDENT MATCH": "Nothing clears the threshold. PRISM says why, and still shows the closest records.",
};
