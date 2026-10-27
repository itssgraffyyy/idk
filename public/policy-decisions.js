window.mountPolicyDecisions = function ({ c, api, run, escape }) {
  const panel = document.createElement("details");
  panel.className = "card";
  panel.setAttribute("aria-label", "Rule explanations and policy history");
  panel.innerHTML =
    '<summary>Rule explanations and policy history</summary><div class="policy-explanation-content" aria-live="polite"></div>';
  document.querySelector("#detail .columns > div:last-child").append(panel);
  let loaded = false;
  const node = (tag, text, parent) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    parent.append(n);
    return n;
  };
  const outcomes = {
    COMPLIANT: "Configured condition satisfied",
    NON_COMPLIANT: "Configured condition not satisfied",
    INSUFFICIENT_EVIDENCE: "More evidence needed",
    NEEDS_HUMAN_REVIEW: "Authorized interpretation needed",
    NOT_APPLICABLE: "Does not apply to recorded facts",
    UNVERIFIED_POLICY: "Policy source not confirmed",
  };
  panel.ontoggle = () => {
    if (!panel.open || loaded) return;
    run(async () => {
      const host = panel.querySelector(".policy-explanation-content"),
        root = "/cases/" + c.id + "/policy-decisions";
      const label = node("label", "Recorded evaluation", host),
        select = node("select", undefined, label);
      select.setAttribute("aria-label", "Recorded policy evaluation");
      const latest = node("option", "Latest current evaluation", select);
      latest.value = "";
      const more = node("button", "Load earlier policy evaluations", host);
      more.type = "button";
      let cursor = null;
      const add = async () => {
        const page = await api(
          root +
            "/history?limit=20" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        for (const e of page.items) {
          const option = node(
            "option",
            "Evaluation " +
              e.version +
              (e.kind === "evaluation_replay" ? " · policy replay" : "") +
              " · " +
              e.recordedAt,
            select,
          );
          option.value = e.id;
        }
        cursor = page.nextCursor;
        more.hidden = !cursor;
      };
      await add();
      more.onclick = () => run(add);
      const results = node("div", undefined, host);
      const show = async () => {
        const r = await api(
            root +
              (select.value
                ? "?evaluationId=" + encodeURIComponent(select.value)
                : ""),
          ),
          e = r.explanation;
        results.replaceChildren();
        const categories = {
          SYNTHETIC_TEST_POLICY:
            "Synthetic test policy — no real regulatory authority",
          VERIFIED_OFFICIAL_POLICY:
            "Verified official policy source; administrative approval remains separate",
          PROVISIONAL_INTERPRETATION:
            "Provisional interpretation — issuer confirmation required",
          UNSUPPORTED_OR_UNAVAILABLE_SOURCE:
            "Policy source unavailable or unsupported",
        };
        node(
          "h3",
          categories[e.authorityCategory] || "Policy source requires review",
          results,
        );
        node("p", e.reason, results);
        if (r.configuration.matchesCurrentConfiguration === false)
          node(
            "p",
            "This recorded evaluation uses an earlier policy configuration. Choose current-configuration reassessment to compare the same facts with the current trusted rules.",
            results,
          );
        node(
          "p",
          "Policy assessment date: " +
            e.asOf +
            ". Recorded financial assessment: " +
            r.financialAssessmentAsOf +
            ".",
          results,
        );
        node(
          "p",
          "Recorded evaluation " +
            r.evaluationVersion +
            " · " +
            r.recordedAt +
            ". Bank release: NOT CONFIRMED.",
          results,
        );
        node(
          "p",
          "Configuration basis: " +
            r.configuration.basis.replaceAll("_", " ").toLowerCase(),
          results,
        );
        for (const uncertainty of e.uncertainty)
          node("p", "Review needed: " + uncertainty, results);
        if (!e.checks.length)
          node(
            "p",
            "No verified operational rule was evaluated. Confirm the applicable policy and source edition with an authorized reviewer.",
            results,
          );
        for (const check of e.checks) {
          const article = node("section", undefined, results);
          article.setAttribute("aria-label", "Rule " + check.ruleId);
          node(
            "h4",
            check.ruleId +
              " · " +
              (outcomes[check.outcome] || "Source confirmation needed"),
            article,
          );
          node("p", check.explanation, article);
          if (check.effectivePeriod)
            node(
              "p",
              "Applicable period: " +
                check.effectivePeriod.from +
                " to " +
                check.effectivePeriod.to,
              article,
            );
          const conditions = node("ul", undefined, article);
          for (const condition of check.applicability)
            node(
              "li",
              condition.field +
                ": recorded " +
                (condition.actual ?? "missing") +
                "; required " +
                condition.expected +
                " · " +
                condition.outcome.replaceAll("_", " ").toLowerCase(),
              conditions,
            );
          if (check.expected !== null)
            node(
              "p",
              "Recorded amount in minor currency units: " +
                (check.actual ?? "missing") +
                "; configured threshold: " +
                check.expected +
                ".",
              article,
            );
          if (check.missingEvidence.length)
            node(
              "p",
              "Missing evidence: " + check.missingEvidence.join(", "),
              article,
            );
          node("p", check.nextAction, article);
          const technical = node("details", undefined, article);
          node(
            "summary",
            "Recorded rule, exception and evidence references",
            technical,
          );
          node(
            "pre",
            JSON.stringify(
              {
                policyVersion: check.policyVersion,
                source: check.source,
                sourceSHA256: check.sourceSHA256,
                sourceVerified: check.sourceVerified,
                exceptions: check.exceptions,
                factReferences: check.factReferences,
                proofEvidence: check.evidence,
              },
              null,
              2,
            ),
            technical,
          );
        }
        const references = node("details", undefined, results);
        node(
          "summary",
          "Recorded AICTE reference checks — issuer confirmation required",
          references,
        );
        for (const check of e.regulatoryReference.checks) {
          node(
            "p",
            check.id +
              " · " +
              check.status +
              ": " +
              (check.explanation ||
                check.message ||
                "Authorized interpretation required"),
            references,
          );
          const technical = node("details", undefined, references);
          node("summary", "Reference source and applicability", technical);
          node("pre", JSON.stringify(check, null, 2), technical);
        }
        for (const document of r.documents) {
          const open = node(
            "button",
            "Inspect recorded " +
              document.kind +
              " source version " +
              document.version,
            results,
          );
          open.type = "button";
          open.onclick = () =>
            run(() =>
              window.openEvidenceViewer({
                c,
                api,
                run,
                escape,
                versionId: document.id,
                extractionId:
                  r.extractionReference?.documentVersionId === document.id
                    ? r.extractionReference.id
                    : null,
              }),
            );
          const metadata = node("details", undefined, results);
          node(
            "summary",
            "Source version integrity and extracted field references",
            metadata,
          );
          node(
            "pre",
            JSON.stringify({ document, fields: r.fieldReferences }, null, 2),
            metadata,
          );
        }
      };
      select.onchange = () => run(show);
      await show();
      loaded = true;
    });
  };
};
