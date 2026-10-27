export const syntheticProcedure = {
  version: "SYNTHETIC-CLEARANCE-1",
  scope: "synthetic-test",
  classification: "SYNTHETIC",
  source: "fictional:test-only; not an AICTE procedure",
  effectiveFrom: "2025-01-01",
  effectiveTo: "2035-12-31",
  requirements: [
    {
      id: "academic",
      label: "Synthetic academic review",
      department: "academic",
      mandatory: true,
      dependsOn: [],
      conditions: {},
      evidenceKinds: ["FDR"],
    },
    {
      id: "parallel",
      label: "Synthetic parallel review",
      department: "coordination",
      mandatory: true,
      dependsOn: [],
      conditions: {},
      evidenceKinds: [],
    },
  ],
};
export const syntheticPolicy = {
  version: "SYNTHETIC-2026",
  scope: "synthetic-test",
  classification: "SYNTHETIC",
  source: "fictional:test-only",
  reviewReference: "automated-fixture-review",
  verification: "verified",
  effectiveFrom: "2025-01-01",
  effectiveTo: "2035-12-31",
  rules: [
    {
      id: "minimum",
      type: "minimum_amount",
      amountPaise: 10000000,
      severity: "HIGH",
    },
  ],
};
