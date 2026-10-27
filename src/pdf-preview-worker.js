// This worker paints PDF fonts from the document or PDF.js' bundled standard
// fonts. Discovering every host font is unnecessary and can exhaust its budget.
// OCR processing continues to use pdf-worker.js with its existing font setup.
process.env.DISABLE_SYSTEM_FONTS_LOAD = "1";
await import("./pdf-worker.js");
