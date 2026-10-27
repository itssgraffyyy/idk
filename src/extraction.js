import { analyzeIFSC } from "./ifsc-extraction.js";
import {
  segmentRecognizedLabels,
  recognizedSegmentWords,
  unionOCRBoxes,
} from "./ocr-layout.js";
export function pdfItemBox(item) {
  const t = item.transform;
  if (
    !Array.isArray(t) ||
    t.length !== 6 ||
    ![...t, item.width, item.height].every(Number.isFinite) ||
    item.width <= 0 ||
    item.height <= 0
  )
    return null;
  const [a, b, c, d, x, y] = t,
    advance = Math.hypot(a, b),
    up = Math.hypot(c, d);
  if (!advance || !up) return null;
  const dx = (a / advance) * item.width,
    dy = (b / advance) * item.width,
    hx = (c / up) * item.height,
    hy = (d / up) * item.height,
    points = [
      [x, y],
      [x + dx, y + dy],
      [x + hx, y + hy],
      [x + dx + hx, y + dy + hy],
    ];
  return {
    x0: Math.min(...points.map((p) => p[0])),
    y0: Math.min(...points.map((p) => p[1])),
    x1: Math.max(...points.map((p) => p[0])),
    y1: Math.max(...points.map((p) => p[1])),
  };
}
const aliases = {
  reference: String.raw`reference|FDR\s*(?:number|no\.?|reference)|receipt\s*(?:number|no\.?)`,
  amountPaise: String.raw`amountPaise|deposit\s*amount(?:\s*\(INR\))?|principal\s*amount(?:\s*\(INR\))?`,
  bank: String.raw`bank|bank\s*name`,
  ifsc: String.raw`ifsc|ifsc\s*code`,
  issued: String.raw`issued|issue\s*date|deposit\s*date`,
  matures: String.raw`matures|maturity\s*date`,
  institutionName: String.raw`institution(?:\s*name)?|college\s*name`,
  depositor: String.raw`depositor(?:\s*name)?|holder(?:\s*name)?`,
  branch: String.raw`branch(?:\s*name)?`,
  currency: String.raw`currency`,
  type: String.raw`instrument\s*type|deposit\s*type`,
};
export function extract(
  text,
  {
    blocks,
    pages,
    fieldAttempts,
    documentVersionId,
    processedAt,
    pageNumber = 1,
    items,
  } = {},
) {
  if (pages?.length) {
    const combined = {};
    for (const page of pages) {
      const values = extract(page.text, {
        blocks: page.blocks,
        fieldAttempts: page.fieldAttempts,
        items: page.items,
        pageNumber: page.page,
        documentVersionId,
        processedAt,
      });
      for (const [key, field] of Object.entries(values)) {
        if (!combined[key]) combined[key] = field;
        else {
          const old = combined[key];
          const observations = old.observations || [
            { value: old.value, page: old.page, bbox: old.bbox },
          ];
          observations.push({
            value: field.value,
            page: field.page,
            bbox: field.bbox,
          });
          combined[key] = {
            ...old,
            observations,
            ...(old.value !== field.value
              ? {
                  value: undefined,
                  status: "REQUIRES_REVIEW",
                  reasons: ["Conflicting field values across PDF pages"],
                }
              : {}),
          };
        }
      }
    }
    return combined;
  }
  const result = {},
    segmentedText = segmentRecognizedLabels(text, aliases);
  for (const [key, label] of Object.entries(aliases)) {
    const matches = [
      ...segmentedText.matchAll(
        new RegExp("^\\s*(" + label + ")\\s*[:=]\\s*(.+)$", "gmi"),
      ),
    ];
    for (const match of matches) {
      const raw = match[2].trim();
      let value = raw,
        normalizations = [];
      if (key === "type") {
        const type = raw.toUpperCase().replace(/[ _-]+/g, " ");
        value = ["FDR", "FIXED DEPOSIT RECEIPT", "FIXED DEPOSIT"].includes(type)
          ? "FDR"
          : type === "TERM DEPOSIT"
            ? "TERM_DEPOSIT"
            : undefined;
        if (value !== raw)
          normalizations.push(
            "Explicit instrument-type label normalized; no type inferred from filename or missing evidence",
          );
      }
      if (key === "currency") {
        value = raw.toUpperCase();
        if (!["INR", "USD", "EUR", "GBP"].includes(value)) continue;
      }
      if (key === "amountPaise") {
        if (match[1].toLowerCase() === "amountpaise") {
          if (!/^\d+$/.test(raw)) continue;
          value = Number(raw);
        } else {
          const displayed = raw.replace(/^(?:INR|Rs\.?|₹)\s*/i, "");
          if (
            !/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(
              displayed,
            )
          )
            continue;
          const clean = displayed.replace(/,/g, ""),
            [whole, fraction = ""] = clean.split("."),
            minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
          if (minor > BigInt(Number.MAX_SAFE_INTEGER)) continue;
          value = Number(minor);
          normalizations.push("INR decimal to integer paise");
        }
        if (!Number.isSafeInteger(value) || value <= 0) continue;
      }
      if (key === "ifsc") {
        value = raw.replace(/\s+/g, "").toUpperCase();
        if (value !== raw)
          normalizations.push(
            "Whitespace/case normalization; no character substitution",
          );
      }
      if (["issued", "matures"].includes(key)) {
        const m = raw.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})$/);
        if (m) {
          const month =
            [
              "jan",
              "feb",
              "mar",
              "apr",
              "may",
              "jun",
              "jul",
              "aug",
              "sep",
              "oct",
              "nov",
              "dec",
            ].indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
          if (month) {
            value =
              m[3] +
              "-" +
              String(month).padStart(2, "0") +
              "-" +
              m[1].padStart(2, "0");
            normalizations.push("Named-month date to ISO");
          }
        }
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value
        )
          continue;
      }
      const lines = (blocks || []).flatMap((b) =>
          (b.paragraphs || []).flatMap((p) => p.lines || []),
        ),
        line = lines.find((l) => l.text?.trim().includes(match[0].trim())),
        segmentWords = recognizedSegmentWords(line, match[0].trim());
      const candidate = {
        value,
        rawValue: raw,
        confidence: null,
        engineConfidence: (() => {
          const words = (
            segmentWords.length ? segmentWords : line?.words
          )?.filter(
            (w) => raw.includes(w.text) && ![":", "="].includes(w.text),
          );
          return words?.length
            ? Math.min(...words.map((w) => w.confidence))
            : null;
        })(),
        confidenceCalibration: "uncalibrated",
        bbox: segmentWords.length
          ? unionOCRBoxes(segmentWords)
          : line?.text?.trim() === match[0].trim()
            ? line.bbox
            : null,
        method: "label-parser-v3-segmented",
        line: match[0],
        sourceLine: line?.text || match[0],
        normalizations,
        ...(key === "type" && value === undefined
          ? {
              status: "REQUIRES_REVIEW",
              reasons: ["Unsupported explicitly stated instrument type"],
            }
          : {}),
      };
      const previous = result[key];
      if (!previous) result[key] = candidate;
      else {
        const observations = [
          ...(previous.observations || [
            {
              value: previous.value,
              rawValue: previous.rawValue,
              bbox: previous.bbox,
            },
          ]),
          {
            value: candidate.value,
            rawValue: candidate.rawValue,
            bbox: candidate.bbox,
          },
        ];
        result[key] = {
          ...previous,
          observations,
          ...(previous.value !== candidate.value
            ? {
                value: undefined,
                status: "REQUIRES_REVIEW",
                reasons: [
                  "Conflicting explicitly labelled values in the same source page",
                ],
              }
            : {}),
        };
      }
    }
  }
  const ifsc = analyzeIFSC(segmentedText, {
    bank: result.bank?.value,
    engineConfidence: result.ifsc?.engineConfidence ?? null,
  });
  if (ifsc.status !== "MISSING")
    result.ifsc = { ...result.ifsc, ...ifsc, value: ifsc.value };
  if (result.ifsc?.candidates?.some((c) => c.joinedFragments)) {
    const candidate =
      result.ifsc.candidates.length === 1 ? result.ifsc.candidates[0] : null;
    const lines = (blocks || []).flatMap((b) =>
      (b.paragraphs || []).flatMap((p) => p.lines || []),
    );
    const sourceLines =
      candidate?.fragments
        .map((fragment) =>
          lines.filter(
            (line) => line.text?.trim() === fragment.sourceLine.trim(),
          ),
        )
        .filter((matches) => matches.length === 1)
        .map((matches) => matches[0]) || [];
    result.ifsc.bbox =
      candidate && sourceLines.length === candidate.fragments.length
        ? unionOCRBoxes(sourceLines)
        : null;
    result.ifsc.sourceFragments =
      candidate?.fragments ||
      result.ifsc.candidates.flatMap((c) => c.fragments || []);
  }
  const attempt = fieldAttempts?.ifsc;
  if (
    attempt?.reliable &&
    attempt.value &&
    ifsc.candidates?.length === 1 &&
    (!result.ifsc?.value || result.ifsc.value !== attempt.value)
  ) {
    const reviewed = analyzeIFSC("IFSC: " + attempt.value, {
      bank: result.bank?.value,
    });
    result.ifsc = {
      ...result.ifsc,
      ...reviewed,
      rawValue: result.ifsc?.rawValue,
      value: attempt.value,
      status: "REQUIRES_REVIEW",
      reasons: [
        ...(reviewed.reasons || []),
        "Secondary visual OCR differs from primary OCR; reviewer confirmation required",
      ],
      method: attempt.method,
      bbox: attempt.bbox,
      correctionProposal: {
        from: ifsc.rawValue,
        to: attempt.value,
        evidence: attempt,
      },
      primaryCandidates: ifsc.candidates,
    };
  }
  for (const [key, attempt] of Object.entries(fieldAttempts?.roi || {})) {
    const original = result[key];
    if (!original || !attempt.value || attempt.value === original.value)
      continue;
    if (
      key === "ifsc" &&
      original.correctionProposal?.to &&
      original.correctionProposal.to !== attempt.value
    ) {
      result[key] = {
        ...original,
        value: undefined,
        status: "REQUIRES_REVIEW",
        reasons: [
          ...(original.reasons || []),
          "Secondary visual recognizers disagree; no identifier selected",
        ],
        secondaryOCR: attempt,
      };
      continue;
    }
    const confidences = [
      original.engineConfidence,
      attempt.engineConfidence,
    ].filter(Number.isFinite);
    result[key] = {
      ...original,
      value: key === "ifsc" ? attempt.value : undefined,
      primaryValue: original.value ?? null,
      primaryBBox: original.bbox,
      bbox: attempt.bbox,
      status: "REQUIRES_REVIEW",
      method: attempt.method,
      engineConfidence: confidences.length ? Math.min(...confidences) : null,
      secondaryOCR: attempt,
      observations: [
        ...(original.observations || [
          {
            value: original.value,
            rawValue: original.rawValue,
            method: original.method,
            bbox: original.bbox,
          },
        ]),
        {
          value: attempt.value,
          rawValue: attempt.rawText,
          method: attempt.method,
          bbox: attempt.bbox,
        },
      ],
      reasons: [
        ...(original.reasons || []),
        "Secondary genuine OCR differs from primary recognition; explicit human review required",
      ],
      correctionProposal: {
        from: original.rawValue,
        to: attempt.value,
        evidence: attempt,
      },
    };
  }
  for (const field of Object.values(result)) {
    field.documentVersionId = documentVersionId ?? null;
    field.page = pageNumber;
    field.processedAt = processedAt ?? null;
    if (items) {
      const item = items.find(
        (i) =>
          i.text?.trim() &&
          (i.text.includes(field.line?.trim()) || field.line?.includes(i.text)),
      );
      if (item) {
        field.bbox = pdfItemBox(item);
        field.coordinateSystem = field.bbox ? "pdf-points-bottom-left" : null;
      }
    }
    if (!field.coordinateSystem)
      field.coordinateSystem = field.bbox ? "raster-pixels-top-left" : null;
  }
  return result;
}
