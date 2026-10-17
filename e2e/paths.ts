/** Where the e2e app server saves annotations, so tests never touch the real data/annotations.csv. */
export const ANNOTATIONS_FILE = "e2e-output/annotations.csv";

/** Same for the fine-tuning file reviewed on /annotate, a copy of e2e/fixtures/examples.jsonl made by each test. */
export const SFT_REVIEW_FILE = "e2e-output/examples.jsonl";

/** Where the chat logs the messages it classifies during e2e, apart from the fixed predictions fixture the annotate tests read. */
export const PREDICTIONS_LOG = "e2e-output/live-predictions.csv";
