# Financial providers
DevelopmentDepositProvider.retrieve(instrument, scenario) returns a stable evidence envelope: status, provider, FI type TERM_DEPOSIT, retrieved timestamp, consent state, verification authority, realBankEvidence=false and normalized fields. Scenarios: unavailable, mock_confirmed, mock_conflict. The latter intentionally changes amount. All responses remain fictional and all evaluations retain unresolved independent-bank confirmation.

This is an adapter foundation for account-aggregator-compatible term-deposit evidence. It is not a certified ReBIT/AA protocol implementation, FIU/FIP registration, consent manager connection, banking sandbox session or real bank authentication. No credential is present. A real adapter must implement consent lifecycle, institution ownership, cryptographic response validation, expiry, revocation, provider schema/version checks and secure callbacks before use.

IFSC lookup recognizes only fictional SYNB0000001 → Synthetic Bank; all other codes return unavailable. It does not consult RBI or a production directory. The code shape is validated separately from evidence authenticity.

No mock source is silently upgraded to independent confirmation. Provider scenarios and policy status are visible in portals and immutable case history.
