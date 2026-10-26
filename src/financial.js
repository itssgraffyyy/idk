export class DevelopmentDepositProvider {
  async retrieve(instrument, scenario = "unavailable") {
    if (!["unavailable", "mock_confirmed", "mock_conflict"].includes(scenario))
      throw Error("Unknown development scenario");
    return {
      status: scenario === "unavailable" ? "unavailable" : "mock_confirmed",
      provider: "fictional-term-deposit-v1",
      fiType: "TERM_DEPOSIT",
      retrievedAt: new Date().toISOString(),
      realBankEvidence: false,
      consent: { status: "not_connected", handle: null },
      verificationAuthority: "none",
      values:
        scenario === "unavailable"
          ? null
          : {
              ...instrument,
              amountPaise:
                scenario === "mock_conflict"
                  ? instrument.amountPaise + 10000
                  : instrument.amountPaise,
            },
    };
  }
}
export function lookupIFSC(code) {
  return {
    code,
    status:
      code === "SYNB0000001" ? "fictional_reference_match" : "unavailable",
    bank: code === "SYNB0000001" ? "Synthetic Bank" : null,
    source: "fictional-local-reference-v1",
    realBankValidation: false,
  };
}
