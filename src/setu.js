import { readBoundedJSON } from "./http-client.js";
import { createHash } from "node:crypto";
export const SETU_CONTRACT = {
  version: "setu-aa-gateway-v2-reviewed-2026-10-26",
  baseURL: "https://fiu-sandbox.setu.co/v2",
  sources: [
    "https://docs.setu.co/data/account-aggregator/api-integration/consent-flow",
    "https://docs.setu.co/data/account-aggregator/api-integration/data-apis",
    "https://docs.setu.co/data/account-aggregator/fi-data-types",
  ],
};
const id = (v) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(v))
    throw Error("Invalid provider identifier");
  return v;
};
export function paise(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value))
    throw Error("Invalid INR decimal");
  const [whole, cents = ""] = value.split("."),
    n = BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0"));
  if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Amount outside safe range");
  return Number(n);
}
export class SetuSandboxProvider {
  constructor({
    fetcher = fetch,
    accessToken = process.env.SETU_ACCESS_TOKEN,
    productInstanceId = process.env.SETU_PRODUCT_INSTANCE_ID,
    clientId = process.env.SETU_CLIENT_ID,
    clientSecret = process.env.SETU_CLIENT_SECRET,
    timeoutMs = 10000,
    now = () => Date.now(),
    maxDataAgeMs = 86400000,
  } = {}) {
    this.fetcher = fetcher;
    this.token = accessToken;
    this.product = productInstanceId;
    this.timeoutMs = timeoutMs;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.now = now;
    this.maxDataAgeMs = maxDataAgeMs;
  }
  get configured() {
    return !!(
      (this.token || (this.clientId && this.clientSecret)) &&
      this.product
    );
  }
  async request(path, method = "GET", body) {
    if (!this.configured) throw Error("not_configured");
    if (!this.token) {
      const auth = await this.fetcher(
        "https://orgservice-prod.setu.co/v1/users/login",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { client: "bridge", "Content-Type": "application/json" },
          body: JSON.stringify({
            clientID: this.clientId,
            secret: this.clientSecret,
            grant_type: "client_credentials",
          }),
        },
      );
      if (!auth.ok) throw Error("authentication_failed");
      const data = await readBoundedJSON(auth, 20000);
      if (typeof data.access_token !== "string")
        throw Error("invalid_token_response");
      this.token = data.access_token;
    }
    const r = await this.fetcher(SETU_CONTRACT.baseURL + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        Authorization: "Bearer " + this.token,
        "x-product-instance-id": this.product,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw Error("provider_http_" + r.status);
    return readBoundedJSON(r, 4000000);
  }
  async createConsent(input) {
    if (!/^\d{10}(?:@[A-Za-z0-9.-]+)?$/.test(input.vua))
      throw Error("Invalid customer VUA");
    if (
      !input.dataRange ||
      !Number.isFinite(Date.parse(input.dataRange.from)) ||
      !Number.isFinite(Date.parse(input.dataRange.to)) ||
      Date.parse(input.dataRange.from) >= Date.parse(input.dataRange.to)
    )
      throw Error("Invalid data range");
    const r = await this.request("/consents", "POST", {
      vua: input.vua,
      dataRange: input.dataRange,
      consentDuration: { unit: "MONTH", value: "1" },
      fiTypes: ["TERM_DEPOSIT"],
      consentTypes: ["PROFILE", "SUMMARY"],
      fetchType: "ONETIME",
      context: [],
    });
    if (
      typeof r.id !== "string" ||
      r.status !== "PENDING" ||
      !r.url?.startsWith("https://fiu-sandbox.setu.co/")
    )
      throw Error("Invalid consent response");
    return {
      ...r,
      environment: "sandbox",
      contractVersion: SETU_CONTRACT.version,
    };
  }
  async consent(consentId) {
    const r = await this.request("/consents/" + id(consentId));
    if (r.id !== consentId || typeof r.status !== "string")
      throw Error("Invalid consent binding");
    return r;
  }
  async createSession(consentId, dataRange) {
    const c = await this.consent(consentId);
    if (
      c.status !== "ACTIVE" ||
      !c.detail?.fiTypes?.includes("TERM_DEPOSIT") ||
      !Number.isFinite(Date.parse(c.detail.consentExpiry)) ||
      Date.parse(c.detail.consentExpiry) <= this.now()
    )
      throw Error("Active unexpired TERM_DEPOSIT consent required");
    if (
      !dataRange ||
      !c.detail.dataRange ||
      !Number.isFinite(Date.parse(c.detail.dataRange.from)) ||
      !Number.isFinite(Date.parse(c.detail.dataRange.to)) ||
      Date.parse(dataRange.from) < Date.parse(c.detail.dataRange.from) ||
      Date.parse(dataRange.to) > Date.parse(c.detail.dataRange.to) ||
      !Number.isFinite(Date.parse(dataRange.from)) ||
      !Number.isFinite(Date.parse(dataRange.to)) ||
      Date.parse(dataRange.from) >= Date.parse(dataRange.to)
    )
      throw Error("Data range outside consent");
    const r = await this.request("/sessions", "POST", {
      consentId,
      dataRange,
      format: "json",
    });
    if (r.consentId !== consentId || typeof r.id !== "string")
      throw Error("Invalid session binding");
    return {
      ...r,
      environment: "sandbox",
      contractVersion: SETU_CONTRACT.version,
    };
  }
  async retrieve({ consentId, sessionId, linkRefNumber }) {
    const base = {
      provider: "setu-aa-sandbox",
      environment: "sandbox",
      contractVersion: SETU_CONTRACT.version,
      realBankEvidence: false,
      independentDepositConfirmation: false,
      consentId,
      sessionId,
      retrievedAt: new Date().toISOString(),
    };
    if (!this.configured)
      return {
        ...base,
        status: "unavailable",
        reason: "not_configured",
        values: null,
      };
    try {
      const consent = await this.consent(consentId);
      if (
        consent.status !== "ACTIVE" ||
        !consent.detail?.fiTypes?.includes("TERM_DEPOSIT") ||
        !Number.isFinite(Date.parse(consent.detail.consentExpiry)) ||
        Date.parse(consent.detail.consentExpiry) <= this.now()
      )
        return {
          ...base,
          status: "unavailable",
          reason: "consent_not_active_or_expired",
          values: null,
        };
      const r = await this.request("/sessions/" + id(sessionId));
      if (
        r.id !== sessionId ||
        r.consentId !== consentId ||
        r.format !== "json"
      )
        throw Error("Session consent mismatch");
      if (!["COMPLETED", "PARTIAL"].includes(r.status))
        return {
          ...base,
          status: "unavailable",
          reason: "session_" + String(r.status).toLowerCase(),
          values: null,
        };
      const range = r.dataRange,
        permitted = consent.detail.dataRange;
      if (
        !range ||
        !permitted ||
        ![range.from, range.to, permitted.from, permitted.to].every(
          (v) => typeof v === "string" && Number.isFinite(Date.parse(v)),
        ) ||
        Date.parse(range.from) >= Date.parse(range.to) ||
        Date.parse(range.from) < Date.parse(permitted.from) ||
        Date.parse(range.to) > Date.parse(permitted.to) ||
        Date.parse(range.to) > this.now() + 300000
      )
        throw Error("Invalid or out-of-consent data range");
      const accounts = (r.fips || [])
        .flatMap((f) =>
          (f.accounts || []).map((a) => ({ ...a, fipID: f.fipID })),
        )
        .filter(
          (a) =>
            a.linkRefNumber === linkRefNumber &&
            (a.FIstatus || a.status) === "DELIVERED" &&
            (!a.FIstatus || !a.status || a.FIstatus === a.status),
        );
      if (accounts.length !== 1)
        throw Error("Delivered account not uniquely matched");
      const selected = accounts[0],
        account = selected.data?.account;
      if (
        typeof selected.fipID !== "string" ||
        !selected.fipID.trim() ||
        selected.fipID.length > 150
      )
        throw Error("Missing FIP identity");
      if (
        !account ||
        !["term_deposit", "term-deposit"].includes(account.type) ||
        account.linkedAccRef !== linkRefNumber
      )
        throw Error("Unsupported or mismatched FI schema");
      const s = account.summary;
      if (!s || !["1.2", "2.0.0"].includes(account.version))
        throw Error("Unsupported term-deposit schema");
      if (s.currency && s.currency !== "INR")
        throw Error("Only INR term deposits supported");
      const values = {},
        limitations = [];
      if (s.branch !== undefined) {
        if (
          typeof s.branch !== "string" ||
          !s.branch.trim() ||
          s.branch.length > 150
        )
          throw Error("Invalid branch");
        values.branch = s.branch;
      }
      if (s.currency) values.currency = s.currency;
      const holders = account.profile?.holders?.holder;
      if (
        Array.isArray(holders) &&
        holders.length === 1 &&
        typeof holders[0].name === "string" &&
        holders[0].name.trim() &&
        holders[0].name.length <= 150
      )
        values.depositor = holders[0].name.trim();
      else
        limitations.push(
          "Holder identity absent or ambiguous; not inferred from account reference",
        );
      if (s.principalAmount !== undefined && s.currency === "INR")
        values.amountPaise = paise(String(s.principalAmount));
      else limitations.push("Currency absent: principal amount not compared");
      if (s.ifsc !== undefined) {
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s.ifsc)) throw Error("Invalid IFSC");
        values.ifsc = s.ifsc;
      }
      for (const [to, from] of [
        ["issued", "openingDate"],
        ["matures", "maturityDate"],
      ])
        if (s[from] !== undefined) {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(s[from]) ||
            new Date(s[from]).toISOString().slice(0, 10) !== s[from]
          )
            throw Error("Invalid FI date");
          values[to] = s[from];
        }
      return {
        ...base,
        status: "sandbox_evidence",
        values,
        fipID: selected.fipID,
        linkRefNumber,
        partial: r.status === "PARTIAL",
        classification: "SANDBOX",
        productionBankConfirmation: "UNCONFIRMED",
        instrumentIdentity:
          "UNCONFIRMED: linked account is not an FDR reference",
        dataRange: range,
        freshness: {
          status:
            this.now() - Date.parse(range.to) > this.maxDataAgeMs
              ? "STALE"
              : "RANGE_RECENT_SNAPSHOT_UNCONFIRMED",
          rangeEnd: range.to,
          snapshotTimestamp: null,
          maxDataAgeMs: this.maxDataAgeMs,
          policy:
            "Local review window; session retrieval time is not the financial snapshot time",
        },
        payloadSHA256: createHash("sha256")
          .update(JSON.stringify(r))
          .digest("hex"),
        sourceFields: Object.keys(s),
        rawSummary: s,
        sourceMap: {
          branch: "summary.branch",
          currency: "summary.currency",
          depositor: "profile.holders.holder[0].name (single holder only)",
          amountPaise: "summary.principalAmount",
          ifsc: "summary.ifsc",
          issued: "summary.openingDate",
          matures: "summary.maturityDate",
        },
        limitations: [
          ...limitations,
          "FDR reference and bank name are not inferred from linkedAccRef or FIP identifier",
          "Sandbox evidence cannot independently confirm a bank deposit",
        ],
      };
    } catch {
      return {
        ...base,
        status: "unavailable",
        reason: "provider_failure_or_invalid_evidence",
        values: null,
      };
    }
  }
}
