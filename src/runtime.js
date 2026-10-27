// Security baseline: Node22 security release of21Oct2026. Other majors are unqualified.
export function assertSupportedRuntime(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (
    !match ||
    Number(match[1]) !== 22 ||
    Number(match[2]) < 23 ||
    (Number(match[2]) === 23 && Number(match[3]) < 4)
  )
    throw Error(
      "FDR Sentinel requires patched Node22.23.4 or newer Node22.x; the system runtime is " +
        version,
    );
}
