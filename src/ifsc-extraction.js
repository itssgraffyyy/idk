import { lookupIFSC } from "./ifsc.js";
export const validIFSC = (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s);
export function normalizeIFSCCandidate(raw) {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.:'"()[\]{}-]/g, "");
}
const confusions = {
  O: ["O", "0"],
  Q: ["Q", "0"],
  0: ["0", "O"],
  I: ["I", "1"],
  L: ["L", "1"],
  1: ["1", "I"],
  S: ["S", "5"],
  B: ["B", "8"],
};
function alternatives(code) {
  if (code.length !== 11) return [];
  let variants = [""];
  for (let i = 0; i < 11; i++) {
    const c = code[i];
    let chars = confusions[c] || [c];
    if (i < 4) chars = chars.filter((x) => /[A-Z]/.test(x));
    if (i === 4) chars = chars.filter((x) => x === "0");
    variants = variants.flatMap((s) => chars.map((x) => s + x));
    if (variants.length > 256) return [];
  }
  return variants.filter(validIFSC);
}
export function analyzeIFSC(
  text,
  {
    lookup = lookupIFSC,
    bank,
    engineConfidence = null,
    asOf = new Date().toISOString(),
    maxReferenceAgeDays = 180,
  } = {},
) {
  const fullText = String(text),
    lines = fullText.slice(0, 65536).split(/\r?\n/),
    candidates = [];
  let truncated = fullText.length > 65536;
  for (let i = 0; i < lines.length; i++) {
    if (candidates.length >= 8) {
      truncated = true;
      break;
    }
    const m = lines[i].match(
      /\bI\s*F\s*S\s*C(?:\s+CODE)?\s*(?:[:=–-]\s*)?(.*)$/i,
    );
    if (!m) continue;
    const labelIndex = i,
      fragments = [{ lineIndex: i, text: m[1].trim(), sourceLine: lines[i] }];
    let raw = m[1].trim(),
      joined = false;
    const nextDataLine = () => {
      let next = i + 1;
      while (next < lines.length && next <= i + 3 && !lines[next].trim())
        next++;
      return next <= i + 3 ? next : -1;
    };
    if (!raw) {
      const next = nextDataLine();
      if (next >= 0 && lines[next] && !/:|=/.test(lines[next])) {
        i = next;
        raw = lines[i].trim();
        joined = true;
        fragments.push({ lineIndex: i, text: raw, sourceLine: lines[i] });
      }
    }
    const continuation = nextDataLine();
    if (
      /^[A-Z]{4}$/.test(normalizeIFSCCandidate(raw)) &&
      continuation >= 0 &&
      /^[A-Z0-9]{7}$/.test(normalizeIFSCCandidate(lines[continuation] || ""))
    ) {
      const previous = i;
      i = continuation;
      raw += "\n".repeat(i - previous) + lines[i].trim();
      joined = true;
      fragments.push({
        lineIndex: i,
        text: lines[i].trim(),
        sourceLine: lines[i],
      });
    }
    // Bound work and never consume unrelated fields or search declarations.
    if (raw.length > 300) truncated = true;
    for (const part of raw.slice(0, 300).split(/[,;|/]/)) {
      if (candidates.length >= 8) {
        truncated = true;
        break;
      }
      const normalized = normalizeIFSCCandidate(part);
      if (!normalized) continue;
      const reference = validIFSC(normalized) ? lookup(normalized) : null;
      const suggestions = !validIFSC(normalized)
        ? alternatives(normalized)
            .filter((v) => v !== normalized)
            .map((v) => ({ value: v, reference: lookup(v) }))
            .filter((s) => s.reference.status === "reference_match")
        : [];
      candidates.push({
        raw: part.trim(),
        normalized,
        formatValid: validIFSC(normalized),
        reference,
        suggestions,
        line: lines[labelIndex],
        lineIndex: labelIndex,
        joinedFragments: joined,
        fragments,
        normalizations:
          normalized === part.trim()
            ? []
            : [
                "NFKC, case and separator normalization; no identifier character substituted",
              ],
      });
    }
  }
  if (!candidates.length)
    return {
      status: "MISSING",
      candidates,
      reasons: ["No labeled IFSC candidate"],
      confidence: null,
    };
  const unique = [
    ...new Set(
      candidates.filter((c) => c.formatValid).map((c) => c.normalized),
    ),
  ];
  const reasons = [];
  if (candidates.some((c) => c.joinedFragments))
    reasons.push(
      "Identifier spans separate OCR lines; verify the preserved source fragments",
    );
  if (truncated)
    reasons.push(
      "Candidate search truncated at resource limit; inspect original text",
    );
  let value;
  if (
    !truncated &&
    unique.length === 1 &&
    candidates.every((c) => c.formatValid && c.normalized === unique[0])
  )
    value = unique[0];
  else
    reasons.push(
      unique.length > 1 || candidates.length > 1
        ? "Multiple or conflicting IFSC candidates"
        : "Invalid IFSC syntax; no automatic character replacement",
    );
  const chosen = candidates.find((c) => c.normalized === value);
  if (chosen) {
    if (chosen.reference.status !== "reference_match")
      reasons.push(
        "Unknown or unavailable reference; syntax alone is not validation",
      );
    const ageDays =
      (Date.parse(asOf) - Date.parse(chosen.reference.releaseDate)) / 86400000;
    if (!Number.isFinite(ageDays) || ageDays > maxReferenceAgeDays)
      reasons.push(
        "Reference date missing or outside configured freshness window",
      );
    if (
      bank &&
      chosen.reference.bank &&
      bank.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() !==
        chosen.reference.bank
          .normalize("NFKC")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase()
    )
      reasons.push("Bank name differs from reference");
  }
  if (engineConfidence !== null && engineConfidence < 70)
    reasons.push("Low uncalibrated OCR confidence");
  return {
    ...(value ? { value } : {}),
    rawValue: candidates.map((c) => c.raw).join(" | "),
    status: reasons.length ? "REQUIRES_REVIEW" : "REFERENCE_MATCH",
    candidates,
    reasons,
    engineConfidence,
    confidence: null,
    confidenceCalibration: "uncalibrated",
    method: "ifsc-candidates-v1",
    normalizations: candidates.flatMap((c) => c.normalizations),
    independentDepositConfirmation: false,
    correctionPolicy:
      "Suggestions require explicit human correction; raw evidence is never overwritten",
  };
}
