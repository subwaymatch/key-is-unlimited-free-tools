/** Canonical origin, used for metadata and the sitemap. */
export const SITE_URL = "https://key.is";

export const SITE_NAME = "key.is";

/**
 * The promise, in one place.
 *
 * It appears on every page, and it is only honest with the qualifier attached,
 * so the two are exported together and rendered together. See section 7.3 of
 * agent-outputs/browser-tool-catalogue-and-build-order.md.
 */
export const PROMISE = "Free. Unlimited. No file size limit.";

export const PROMISE_REASON =
  "Everything runs in your browser. Nothing is uploaded, so there is no server to charge you, throttle you, or cap your file.";

/*
 * The qualifier has to resolve the one contradiction a careful reader will
 * find: the headline says "no file size limit" while the tool pages say an
 * output caps out near 1.5 GB. Both are true and they are about different
 * ends of the job - there is no limit on what you put in, and a ceiling on
 * what one output file can be - so the qualifier now says which is which
 * rather than leaving the two claims to argue with each other.
 */
export const PROMISE_QUALIFIER =
  "The only limits are your device's: memory, storage and the browser tab. There is no limit on the file you start from; a single output file caps out near 1.5 GB.";

/** The short form, for a tool page's footer note. */
export const OUTPUT_LIMIT_NOTE =
  "No upload limit. Outputs up to about 1.5 GB each.";
