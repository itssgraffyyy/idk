import { createHmac, timingSafeEqual } from "node:crypto";
const bad = () => {
  throw Object.assign(Error("Invalid or mismatched pagination cursor"), {
    status: 400,
  });
};
export function paginate(
  db,
  {
    table,
    alias = "t",
    where,
    params = [],
    url,
    scope,
    key,
    descending = false,
    defaultLimit = 50,
  },
) {
  const raw = url.searchParams.get("limit"),
    limit = raw === null ? defaultLimit : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad();
  let ceiling = db
      .prepare(
        `SELECT coalesce(max(${alias}.rowid),0) n FROM ${table} WHERE ${where}`,
      )
      .get(...params).n,
    k = descending ? ceiling + 1 : 0;
  const signature = (s) =>
    createHmac("sha256", key).update(s).digest("base64url");
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      const [data, mac] = cursor.split("."),
        expected = signature(data);
      if (
        mac?.length !== expected.length ||
        !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
      )
        bad();
      const p = JSON.parse(Buffer.from(data, "base64url"));
      if (
        p.scope !== scope ||
        !Number.isSafeInteger(p.k) ||
        !Number.isSafeInteger(p.ceiling)
      )
        bad();
      k = p.k;
      ceiling = p.ceiling;
    } catch {
      bad();
    }
  }
  const rows = db
      .prepare(
        `SELECT ${alias}.rowid AS sequence,${alias}.* FROM ${table} WHERE ${where} AND ${alias}.rowid<=? AND ${alias}.rowid${descending ? "<" : ">"}? ORDER BY ${alias}.rowid ${descending ? "DESC" : "ASC"} LIMIT ?`,
      )
      .all(...params, ceiling, k, limit + 1),
    more = rows.length > limit;
  rows.splice(limit);
  let nextCursor = null;
  if (more) {
    const data = Buffer.from(
      JSON.stringify({ scope, k: rows.at(-1).sequence, ceiling }),
    ).toString("base64url");
    nextCursor = data + "." + signature(data);
  }
  return {
    items: descending ? rows.reverse() : rows,
    nextCursor,
    limit,
    snapshotCeiling: ceiling,
  };
}
export function accessibleCases(user) {
  return user.role === "officer"
    ? { where: "c.assigned=?", params: [user.id] }
    : ["institution", "institution_admin"].includes(user.role)
      ? { where: "c.tenant=?", params: [user.tenant] }
      : {
          where:
            "EXISTS(SELECT 1 FROM users a WHERE a.id=c.assigned AND a.tenant=?)",
          params: [user.tenant],
        };
}
