import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage();
export function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /password|secret|token|authorization|cookie|csrf|credential|^vua$|^pan$/i.test(
          key,
        )
          ? "[REDACTED]"
          : scrub(v),
      ]),
    );
  if (typeof value === "string")
    return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  return value;
}
export const category = (action) =>
  /login|account|access|request_denied/.test(action)
    ? "security"
    : /document|processing|extraction/.test(action)
      ? "document"
      : /evaluation|external|ifsc|proof/.test(action)
        ? "evidence"
        : "administration";
