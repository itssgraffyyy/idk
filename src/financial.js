export const mockScenarios = [
  "unavailable",
  "mock_confirmed",
  "mock_conflict",
  "mock_missing",
  "mock_holder_conflict",
  "mock_stale",
  "mock_malformed",
  "mock_partial",
  "mock_consent_denied",
];
export class DevelopmentDepositProvider {
  async retrieve(instrument, scenario = "unavailable") {
    if (!mockScenarios.includes(scenario))
      throw Error("Unknown development scenario");
    const result = {
      status: scenario === "unavailable" ? "unavailable" : "mock_confirmed",
      provider: "fictional-term-deposit-v1",
      fiType: "TERM_DEPOSIT",
      retrievedAt: new Date().toISOString(),
      realBankEvidence: false,
      classification: "MOCK",
      productionBankConfirmation: "UNCONFIRMED",
      independentDepositConfirmation: false,
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
    if (scenario === "mock_missing")
      Object.assign(result, {
        status: "missing_instrument",
        values: null,
        reason: "No synthetic instrument record",
      });
    if (scenario === "mock_holder_conflict")
      result.values.depositor = "Different Synthetic Holder";
    if (scenario === "mock_stale")
      result.freshness = {
        status: "STALE",
        snapshotTimestamp: "2020-01-01T00:00:00Z",
        policy: "Synthetic stale fixture",
      };
    if (scenario === "mock_malformed")
      Object.assign(result, {
        status: "unavailable",
        values: null,
        reason: "invalid_mock_response",
        raw: { principalAmount: "not-a-number" },
      });
    if (scenario === "mock_partial") {
      result.values = { amountPaise: instrument.amountPaise };
      result.partial = true;
    }
    if (scenario === "mock_consent_denied")
      Object.assign(result, {
        status: "unavailable",
        values: null,
        consent: { status: "DENIED" },
        reason: "mock_consent_denied",
      });
    return result;
  }
}
export { lookupIFSC } from "./ifsc.js";
