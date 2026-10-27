import { verifyPassword } from "./security.js";
import { password } from "./store.js";
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export async function accountSecurity({
  db,
  u,
  token,
  path,
  method,
  body,
  mfa,
  requiredRoles,
  tx,
  audit,
  json,
  res,
}) {
  if (!path.startsWith("/api/security/")) return false;
  const action = path.slice("/api/security/".length);
  if (
    ![
      "mfa",
      "mfa/enroll",
      "mfa/confirm",
      "mfa/recovery",
      "mfa/disable",
      "step-up",
      "password",
    ].includes(action)
  )
    return false;
  const current = () => {
    const live = db
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token=? AND s.expires>? AND u.status='active'",
      )
      .get(u.id, token, Date.now());
    if (
      !live ||
      live.role !== u.role ||
      live.tenant !== u.tenant ||
      live.password !== u.password
    )
      fail(401, "Account or session changed; sign in again");
    return live;
  };
  if (action === "mfa" && method === "GET") {
    json(res, 200, {
      ...mfa.status(u.id, token),
      requiredForRole: requiredRoles.includes(u.role),
      enrollmentRequired:
        requiredRoles.includes(u.role) && !mfa.state(u.id)?.enabled,
    });
    return true;
  }
  if (method !== "POST") fail(405, "Method not allowed");
  const allowed =
    action === "password"
      ? ["password", "newPassword", "mfaCode", "recoveryCode"]
      : ["password", "revision", "mfaCode", "recoveryCode"];
  if (
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    typeof body.password !== "string" ||
    body.password.length > 200
  )
    fail(400, "Current password and supported fields required");
  mfa.limit(u.id);
  if (!(await verifyPassword(body.password, u.password)))
    fail(401, "Invalid credentials");
  current();
  if (
    action === "password" &&
    (typeof body.newPassword !== "string" ||
      body.newPassword.length < 12 ||
      body.newPassword.length > 200 ||
      body.newPassword === body.password)
  )
    fail(400, "Use a different password of 12 to 200 characters");
  const result = tx(() => {
    current();
    const enabled = !!mfa.state(u.id)?.enabled;
    if (action === "mfa/confirm") {
      const result = mfa.confirm(u.id, token, body.revision, body.mfaCode);
      audit(u.id, "mfa_enabled", null, {
        recoveryCount: result.recoveryCodes.length,
      });
      return { ...result, enabled: true };
    }
    let factor = { mfa: false };
    if (enabled) factor = mfa.consume(u.id, body);
    if (action === "mfa/enroll") {
      const result = mfa.begin(u.id, token, body.revision);
      audit(u.id, "mfa_enrollment_started", null, {
        revision: result.revision,
      });
      return {
        ...result,
        otpauth:
          "otpauth://totp/" +
          encodeURIComponent("FDR Sentinel:" + u.email) +
          "?secret=" +
          result.secret +
          "&issuer=FDR%20Sentinel&algorithm=SHA1&digits=6&period=30",
      };
    }
    if (action === "mfa/recovery") {
      if (!enabled) fail(409, "Enable MFA before rotating recovery codes");
      const result = mfa.rotate(u.id, token);
      audit(u.id, "mfa_recovery_rotated", null, {
        recoveryCount: result.recoveryCodes.length,
        usedRecoveryId: factor.recoveryId || null,
      });
      return result;
    }
    if (action === "mfa/disable") {
      if (requiredRoles.includes(u.role))
        fail(
          403,
          "MFA is required for this role; replace the authenticator instead",
        );
      if (!enabled) fail(409, "MFA is not enabled");
      mfa.disable(u.id);
      audit(u.id, "mfa_disabled", null, { sessionsRevoked: true });
      return { signedOut: true };
    }
    if (action === "step-up") {
      if (!enabled) fail(409, "Enable MFA before MFA step-up");
      mfa.assure(token);
      audit(u.id, "mfa_step_up", null, {
        usedRecoveryId: factor.recoveryId || null,
      });
      return mfa.status(u.id, token);
    }
    if (action === "password") {
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        password(body.newPassword),
        u.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
      db.prepare(
        "UPDATE user_mfa SET pending_secret=NULL,pending_session=NULL,pending_expires=NULL,revision=revision+1 WHERE user_id=?",
      ).run(u.id);
      audit(u.id, "account_password_changed", null, { sessionsRevoked: true });
      return { signedOut: true };
    }
    fail(405, "Unsupported account security action");
  });
  json(res, 200, result);
  return true;
}
