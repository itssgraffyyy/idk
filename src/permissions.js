export const roles = [
  "institution",
  "institution_admin",
  "officer",
  "supervisor",
  "audit_reviewer",
];
export const isInstitution = (u) =>
  ["institution", "institution_admin"].includes(u?.role);
export const isReviewer = (u) => ["officer", "supervisor"].includes(u?.role);
export function canReadCase(db, user, c) {
  if (!c || !user) return false;
  if (isInstitution(user)) return c.tenant === user.tenant;
  if (user.role === "officer") return c.assigned === user.id;
  if (["supervisor", "audit_reviewer"].includes(user.role))
    return (
      db.prepare("SELECT tenant FROM users WHERE id=?").get(c.assigned)
        ?.tenant === user.tenant
    );
  return false;
}
export function requireRole(user, allowed) {
  if (!allowed.includes(user.role))
    throw Object.assign(Error("Role does not permit this operation"), {
      status: 403,
    });
}
