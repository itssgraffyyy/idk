process.stdout.write(
  JSON.stringify({
    canaryPresent: !!process.env.SENTINEL_TEST_SECRET,
    auditKeyPathPresent: !!process.env.AUDIT_KEY_FILE,
    mfaKeyPathPresent: !!process.env.MFA_KEY_FILE,
    providerSecretPresent: !!process.env.SETU_CLIENT_SECRET,
    hasSystemRoot: !!process.env.SystemRoot,
    fontMode: process.env.DISABLE_SYSTEM_FONTS_LOAD,
  }),
);
