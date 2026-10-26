// Declared-date scenario analysis only. No legal sufficiency or bank confirmation.
const day = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error("Explicit ISO civil date required");
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value)
    throw Error("Invalid civil date");
  return n / 86400000;
};
const iso = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const norm = (v) =>
  String(v || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
export function analyzeContinuity({ starts, ends, amountPaise, instruments }) {
  const first = day(starts),
    last = day(ends);
  if (last < first || !Number.isSafeInteger(amountPaise) || amountPaise <= 0)
    throw Error("Valid interval and positive integer obligation required");
  if (!Array.isArray(instruments) || instruments.length > 500)
    throw Error("At most 500 instruments supported per analysis");
  const groups = new Map(),
    issues = [],
    excluded = [];
  for (const row of instruments) {
    if (row.proposed) {
      excluded.push({ id: row.id, reason: "PROPOSAL_NOT_REGISTERED" });
      continue;
    }
    const d = row.data || row;
    try {
      const start = day(d.issued),
        end = day(d.matures);
      if (
        end < start ||
        !Number.isSafeInteger(d.amountPaise) ||
        d.amountPaise <= 0 ||
        d.currency !== "INR" ||
        !norm(d.reference) ||
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(norm(d.ifsc))
      )
        throw Error("Incomplete or invalid declared financial facts");
      // IFSC bank code avoids treating different branches as independent deposits.
      const identity = norm(d.ifsc).slice(0, 4) + "|" + norm(d.reference);
      const list = groups.get(identity) || [];
      list.push({
        id: row.id,
        start,
        end,
        amount: BigInt(d.amountPaise),
        signature: JSON.stringify([
          start,
          end,
          d.amountPaise,
          norm(d.depositor),
          norm(d.institutionName),
        ]),
      });
      groups.set(identity, list);
    } catch (e) {
      issues.push({
        code: "INCOMPLETE_INSTRUMENT",
        id: row.id,
        reason: e.message,
      });
    }
  }
  const usable = [];
  for (const [identity, rows] of groups) {
    if (new Set(rows.map((r) => r.signature)).size > 1) {
      issues.push({
        code: "CONFLICTING_DUPLICATE",
        identity,
        ids: rows.map((r) => r.id),
      });
      continue;
    }
    usable.push(rows[0]);
    if (rows.length > 1)
      issues.push({
        code: "DUPLICATE_COUNTED_ONCE",
        identity,
        ids: rows.map((r) => r.id),
      });
  }
  const boundaries = new Set([first, last + 1]);
  for (const r of usable) {
    if (r.start >= first && r.start <= last) boundaries.add(r.start);
    if (r.end >= first && r.end < last) boundaries.add(r.end + 1);
  }
  const points = [...boundaries].sort((a, b) => a - b),
    segments = [];
  const uncertain = issues.some((v) => v.code !== "DUPLICATE_COUNTED_ONCE");
  for (let i = 0; i < points.length - 1; i++) {
    const active = usable.filter(
      (r) => r.start <= points[i] && r.end >= points[i],
    );
    const maximum = active.reduce((m, r) => (r.amount > m ? r.amount : m), 0n);
    segments.push({
      starts: iso(points[i]),
      ends: iso(points[i + 1] - 1),
      instrumentIds: active.map((r) => r.id).sort(),
      maximumSingleAmountPaise: maximum.toString(),
      status:
        maximum >= BigInt(amountPaise)
          ? "POTENTIAL_DECLARED_COVERAGE"
          : uncertain
            ? "UNKNOWN"
            : "POTENTIAL_DECLARED_SHORTFALL",
    });
  }
  return {
    basis: "DECLARED_INCLUSIVE_CIVIL_DATES",
    pooling: "DISALLOWED",
    bankConfirmation: "UNCONFIRMED",
    legalCoverage: "REQUIRES_HUMAN_REVIEW",
    establishedGap: false,
    segments,
    issues,
    excluded,
  };
}
