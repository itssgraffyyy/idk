window.mountReviewWorkspace = function ({ c, user, api, run, detail, escape }) {
  const id = c.id,
    h = c.history,
    last = (k) => (c.currentEvidence || h).filter((e) => e.kind === k).at(-1),
    ctx = last("regulatory_context"),
    report = last("evaluation"),
    host = document.querySelector("#detail .columns > div:last-child");
  const latestDocument = (c.currentEvidence || h)
      .filter(
        (e) =>
          e.kind === "document" &&
          (!e.payload.documentKind || e.payload.documentKind === "fdr"),
      )
      .at(-1),
    latestExtraction = last("extraction");
  const ifsc =
    latestExtraction?.payload.documentId === latestDocument?.id
      ? latestExtraction?.payload.fields.ifsc
      : null;
  if (ifsc?.status) {
    const review = document.createElement("div");
    review.className = "card";
    review.innerHTML =
      "<h2>IFSC extraction review</h2><p><b>" +
      escape(ifsc.status) +
      '</b></p><p class="source">Raw OCR: ' +
      escape(ifsc.rawValue) +
      "</p><p>" +
      escape((ifsc.reasons || []).join("; ")) +
      '</p><p class="source">Directory lookup identifies a branch; it does not authenticate the deposit. Suggestions are not applied automatically.</p>' +
      (ifsc.candidates || [])
        .map(
          (candidate) =>
            "<details><summary>" +
            escape(candidate.normalized) +
            " · " +
            escape(candidate.reference?.status || "invalid syntax") +
            "</summary><pre>" +
            escape(JSON.stringify(candidate, null, 2)) +
            "</pre></details>",
        )
        .join("");
    host.append(review);
  }
  const financial = last("external")?.payload;
  if (financial) {
    const state = document.createElement("div");
    state.className = "card";
    state.innerHTML =
      "<h2>Financial evidence status</h2><p>" +
      escape(
        financial.classification || financial.environment || financial.status,
      ) +
      " · " +
      escape(financial.provider) +
      '</p><p>Production bank confirmation: UNCONFIRMED</p><p class="source">' +
      escape(
        financial.freshness?.status ||
          "Financial snapshot freshness unconfirmed",
      ) +
      " · " +
      escape(
        financial.instrumentIdentity ||
          "Mock evidence cannot establish an FDR exists",
      ) +
      "</p>";
    host.append(state);
  }
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML =
    '<h2>Regulatory applicability</h2><p class="source">AICTE publication copies are source-pinned. Issuer confirmation and authorized review remain required.</p>';
  const labels = {
    academicYear: "Academic year",
    programme: "Programme",
    level: "Qualification level",
    entity: "Institution category",
    ownership: "Funding category",
    application: "Application category",
    property: "Land and building",
    concession: "Concession claim",
    applicationDate: "Application date",
    ugcRecognitionDate: "UGC recognition date",
    regulatorRecognitionDate: "Regulator recognition date",
    depositDate: "Council deposit date",
    intimationDate: "Intimation date",
    paymentDate: "Payment date",
  };
  const choices = {
    academicYear: ["2024-25", "2025-26", "2026-27"],
    programme: [
      "engineering",
      "planning",
      "applied_arts",
      "design",
      "hmct",
      "computer_applications",
      "management",
    ],
    level: ["diploma", "ug", "pg", "pg_certificate"],
    entity: [
      "technical",
      "private_university",
      "deemed_private",
      "government_university",
    ],
    ownership: ["private", "government", "government_aided"],
    application: [
      "new_institution",
      "new_programme",
      "new_level",
      "clause_1_3_3",
      "conversion",
      "release",
    ],
    property: ["owned", "private_lease", "government_lease"],
    concession: [
      "none",
      "north_east",
      "jammu_kashmir",
      "ladakh",
      "aspirational_district",
      "andaman_nicobar",
      "lakshadweep",
      "women_only",
      "pwd_only",
    ],
  };
  if (window.institutionRole(user)) {
    card.innerHTML +=
      '<form id="policy-context">' +
      Object.entries(choices)
        .map(
          ([k, values]) =>
            "<label>" +
            escape(labels[k] || k) +
            '<select name="' +
            k +
            '" required><option value="">Choose…</option>' +
            values
              .map(
                (v) =>
                  '<option value="' +
                  v +
                  '" ' +
                  (ctx?.payload.context[k] === v ? "selected" : "") +
                  ">" +
                  escape(v.replace(/_/g, " ")) +
                  "</option>",
              )
              .join("") +
            "</select></label>",
        )
        .join("") +
      [
        "applicationDate",
        "ugcRecognitionDate",
        "regulatorRecognitionDate",
        "depositDate",
        "intimationDate",
        "paymentDate",
      ]
        .map(
          (k) =>
            "<label>" +
            escape(labels[k] || k) +
            '<input name="' +
            k +
            '" type="date" value="' +
            escape(ctx?.payload.context[k] || "") +
            '" ' +
            (k === "applicationDate" ? "required" : "") +
            "></label>",
        )
        .join("") +
      "<button>Save applicability claims</button></form>";
  } else if (ctx) {
    card.innerHTML +=
      "<p>Academic year: " +
      escape(ctx.payload.context.academicYear) +
      '</p><form id="policy-proof"><label>Source document<select name="documentId" required>' +
      h
        .filter((e) => e.kind === "document")
        .map(
          (e, i) =>
            '<option value="' +
            e.id +
            '">Document version ' +
            (i + 1) +
            "</option>",
        )
        .join("") +
      '</select></label><label>Evidence type<select name="type">' +
      [
        "applicability",
        "government_status",
        "prior_regulator",
        "ugc_recognition",
        "prior_release_noc",
        "special_category",
        "payment_affidavit3",
      ]
        .map((v) => "<option>" + v + "</option>")
        .join("") +
      '</select></label><label>Decision<select name="decision"><option value="accepted">Accept supporting evidence</option><option value="rejected">Reject supporting evidence</option></select></label><label>Review reason<textarea name="reason" required maxlength="2000"></textarea></label><button>Record evidence review</button></form>';
  } else
    card.innerHTML +=
      '<p class="muted">The institution has not supplied applicability facts.</p>';
  host.append(card);
  const contextForm = document.querySelector("#policy-context");
  if (contextForm)
    contextForm.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const context = Object.fromEntries(
          [...new FormData(e.target)].filter(([, v]) => v),
        );
        await api("/cases/" + id + "/regulatory-context", "POST", {
          context,
          revision: c.revision,
        });
        await detail(id);
      });
    };
  const proofForm = document.querySelector("#policy-proof");
  if (proofForm)
    proofForm.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + id + "/proof-reviews", "POST", {
          ...Object.fromEntries(new FormData(e.target)),
          contextId: ctx.id,
        });
        await detail(id);
      });
    };
  if (report?.payload.regulatory) {
    const r = report.payload.regulatory,
      panel = document.createElement("div");
    panel.className = "card";
    panel.innerHTML =
      "<h2>Regulatory reference findings</h2><p>" +
      escape(r.version) +
      "</p><p>Reference requirement: " +
      (r.requiredAmountPaise === null
        ? "Unresolved"
        : "INR " +
          new Intl.NumberFormat("en-IN").format(r.requiredAmountPaise / 100)) +
      "</p>" +
      r.checks
        .map(
          (check) =>
            "<details><summary>" +
            escape(check.id) +
            " · " +
            escape(check.status) +
            "</summary><p>" +
            escape(check.explanation) +
            "</p>" +
            (check.source
              ? '<a href="' +
                escape(check.source.url) +
                '" target="_blank" rel="noopener noreferrer">Source · PDF page ' +
                check.source.pdfPage +
                "</a>"
              : "") +
            "</details>",
        )
        .join("");
    document.querySelector("#detail .columns > div:first-child").append(panel);
  }
  const sandbox = document.createElement("div");
  sandbox.className = "card";
  sandbox.innerHTML =
    '<h2>Setu AA sandbox</h2><p class="source">Requires a configured Setu product and customer consent. Sandbox data never independently confirms a bank deposit.</p>';
  const consent = last("sandbox_consent"),
    session = last("sandbox_session");
  if (window.institutionRole(user)) {
    sandbox.innerHTML +=
      '<form id="aa-consent"><label>Sandbox customer VUA<input name="vua" required placeholder="Mobile number or AA handle"></label><label>Data from<input name="from" type="date" required></label><label>Data to<input name="to" type="date" required></label><button>Create sandbox consent</button></form>' +
      (consent
        ? '<p><a href="' +
          escape(consent.payload.url) +
          '" target="_blank" rel="noopener noreferrer">Review consent with Setu</a></p><button id="aa-session">Request consented data session</button>'
        : "");
  } else if (session)
    sandbox.innerHTML +=
      '<form id="aa-fetch"><label>Linked account reference<input name="linkRefNumber" required maxlength="100"></label><button>Retrieve sandbox term deposit</button></form>';
  else
    sandbox.innerHTML +=
      "<p>Awaiting an institution-owned consent and session.</p>";
  host.append(sandbox);
  const consentForm = document.querySelector("#aa-consent");
  if (consentForm)
    consentForm.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const f = Object.fromEntries(new FormData(e.target));
        await api("/cases/" + id + "/sandbox-consent", "POST", {
          vua: f.vua,
          dataRange: { from: f.from + "T00:00:00Z", to: f.to + "T00:00:00Z" },
        });
        await detail(id);
      });
    };
  const sessionButton = document.querySelector("#aa-session");
  if (sessionButton)
    sessionButton.onclick = () =>
      run(async () => {
        await api("/cases/" + id + "/sandbox-session", "POST", {
          consentId: consent.payload.id,
          dataRange: consent.payload.dataRange,
        });
        await detail(id);
      });
  const fetchForm = document.querySelector("#aa-fetch");
  if (fetchForm)
    fetchForm.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + id + "/sandbox-evidence", "POST", {
          consentId: session.payload.consentId,
          sessionId: session.payload.id,
          linkRefNumber: e.target.linkRefNumber.value,
        });
        await detail(id);
      });
    };
};
