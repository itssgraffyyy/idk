// Document processors receive operating-system paths and explicit rendering/model
// settings only. This minimizes credentials; it is not an OS filesystem sandbox.
const allowed = [
  "SystemRoot",
  "WINDIR",
  "PATH",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "TESSDATA_PREFIX",
  "DISABLE_SYSTEM_FONTS_LOAD",
];
export function workerEnvironment(overrides = {}, source = process.env) {
  const env = {};
  for (const key of allowed) {
    const value = overrides?.[key] ?? source[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}
