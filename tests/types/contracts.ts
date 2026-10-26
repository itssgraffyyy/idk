import {
  Instrument,
  Role,
  RevisionedAction,
  CursorPage,
  Evidence,
  PrivateStorage,
  validateEnvelope,
} from "../../src/contracts.js";
const instrument: Instrument = {
  reference: "TEST",
  amountPaise: 100,
  bank: "Test",
  ifsc: "HDFC0001234",
  issued: "2026-01-01",
  matures: "2031-01-01",
  currency: "INR",
};
const role: Role = "audit_reviewer";
const action: RevisionedAction = { revision: 1, reason: "test" };
const page: CursorPage<Evidence<Instrument>> = { items: [], nextCursor: null };
// @ts-expect-error unsupported roles cannot enter typed clients
const invalidRole: Role = "owner";
// @ts-expect-error financial amounts are numeric integer paise
const invalidInstrument: Instrument = { ...instrument, amountPaise: "100" };
// @ts-expect-error unsupported currency is rejected by the contract
const invalidCurrency: Instrument = { ...instrument, currency: "USD" };
declare const storage: PrivateStorage;
storage.write("uuid", new Uint8Array());
validateEnvelope(action);
void [role, page, invalidRole, invalidInstrument, invalidCurrency];
