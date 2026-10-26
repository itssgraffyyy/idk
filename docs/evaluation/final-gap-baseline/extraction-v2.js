const aliases = {
  reference: String.raw`reference|FDR\s*(?:number|no\.?|reference)|receipt\s*(?:number|no\.?)`,
  amountPaise: String.raw`amountPaise|deposit\s*amount(?:\s*\(INR\))?|principal\s*amount(?:\s*\(INR\))?`,
  bank: String.raw`bank|bank\s*name`,
  ifsc: String.raw`ifsc|ifsc\s*code`,
  issued: String.raw`issued|issue\s*date|deposit\s*date`,
  matures: String.raw`matures|maturity\s*date`,
};
export function extract(text, { blocks } = {}) {
  const result = {};
  for (const [key, label] of Object.entries(aliases)) {
    const match = text.match(
      new RegExp("^\\s*(" + label + ")\\s*[:=]\\s*(.+)$", "mi"),
    );
    if (!match) continue;
    const raw = match[2].trim();
    let value = raw,
      normalizations = [];
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
      line = lines.find((l) => l.text?.trim().includes(match[0].trim()));
    result[key] = {
      value,
      rawValue: raw,
      confidence: null,
      engineConfidence: (() => {
        const words = line?.words?.filter(
          (w) => raw.includes(w.text) && ![":", "="].includes(w.text),
        );
        return words?.length
          ? Math.min(...words.map((w) => w.confidence))
          : null;
      })(),
      confidenceCalibration: "uncalibrated",
      bbox: line?.bbox ?? null,
      method: "label-parser-v2",
      line: match[0],
      normalizations,
    };
  }
  return result;
}
