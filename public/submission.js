window.mountSubmissionNavigation = function ({
  user,
  api,
  run,
  views,
  detail,
  escape,
}) {
  if (!window.institutionRole(user)) return;
  let nav = document.querySelector("#submission-nav");
  if (!nav) {
    nav = document.createElement("button");
    nav.id = "submission-nav";
    nav.className = "nav";
    document.querySelector("aside").append(nav);
  }
  nav.textContent = "Guided submission";
  nav.onclick = () =>
    run(async () => {
      views("management");
      const host = document.querySelector("#management"),
        drafts = await api("/drafts");
      host.innerHTML =
        '<h1>Guided submission</h1><button id="draft-new">Start a saved draft</button><div id="draft-list"></div>';
      const open = async (id) => {
        const draft = await api("/drafts/" + id);
        if (draft.case_id) return detail(draft.case_id);
        let payload = draft.payload,
          revision = draft.revision,
          step = Number(payload.step || 1),
          chain = Promise.resolve(),
          timer,
          confirmationDocumentId;
        const keys = [
            "reference",
            "amountPaise",
            "bank",
            "ifsc",
            "issued",
            "matures",
            "institutionName",
            "depositor",
            "branch",
            "currency",
            "type",
          ],
          obligations = await api("/obligations");
        const collect = () => {
          const f = host.querySelector("#draft-form");
          if (f) {
            if (step === 1) {
              payload.name = f.elements.name.value;
              payload.obligationId = f.elements.obligationId.value || undefined;
              payload.obligation = {
                amountPaise: Number(f.elements.amountPaise.value),
              };
            }
            if (step === 3) {
              payload.confirmedDocumentId = confirmationDocumentId;
              payload.instrument = Object.fromEntries(
                keys
                  .map((k) => [k, f.elements[k].value])
                  .filter(([, v]) => v !== ""),
              );
              if (payload.instrument.amountPaise !== undefined)
                payload.instrument.amountPaise = Number(
                  payload.instrument.amountPaise,
                );
              payload.confirmedFields = [
                ...f.querySelectorAll("[data-confirm]:checked"),
              ].map((e) => e.dataset.confirm);
            }
          }
          payload.step = step;
          return JSON.parse(JSON.stringify(payload));
        };
        const save = () => {
          const data = collect();
          chain = chain
            .catch(() => {})
            .then(async () => {
              const r = await api("/drafts/" + id, "POST", {
                payload: data,
                revision,
              });
              revision = r.revision;
              const s = host.querySelector("#draft-save-status");
              if (s) s.textContent = "Saved privately";
            });
          return chain;
        };
        const draw = async () => {
          const ready = await api("/drafts/" + id + "/readiness"),
            extraction = ready.extraction;
          if (step === 3) {
            confirmationDocumentId = ready.document?.id;
            if (payload.confirmedDocumentId !== confirmationDocumentId)
              payload.confirmedFields = [];
          }
          host.innerHTML =
            "<h1>Guided submission</h1><p>Step " +
            step +
            " of 5: " +
            [
              "",
              "Institution and obligation",
              "Upload and extract",
              "Confirm fields",
              "Readiness checks",
              "Final review",
            ][step] +
            '</p><p id="draft-save-status" role="status">Saved privately</p><div id="draft-step"></div><button id="draft-back">Previous step</button><button id="draft-save">Save progress</button><button id="draft-next">Save and continue</button>';
          const panel = host.querySelector("#draft-step");
          if (step === 1) {
            panel.innerHTML =
              '<form id="draft-form"><label>Submission institution name<input name="name" value="' +
              escape(payload.name || "") +
              '"></label><label>Saved obligation<select name="obligationId"><option value="">Register a new obligation</option>' +
              obligations
                .map(
                  (o) =>
                    '<option value="' +
                    escape(o.id) +
                    '" ' +
                    (payload.obligationId === o.id ? "selected" : "") +
                    ">" +
                    escape(
                      (o.programme || o.id) + " · " + o.amount_paise + " paise",
                    ) +
                    "</option>",
                )
                .join("") +
              '</select></label><label>Submission obligation amount (paise)<input type="number" name="amountPaise" min="1" step="1" value="' +
              escape(payload.obligation?.amountPaise || "") +
              '"></label></form><p>Institution and obligation values come from saved records where available. Unknown facts stay blank.</p>';
            panel.querySelector("select").onchange = (e) => {
              const o = obligations.find((o) => o.id === e.target.value);
              if (o)
                panel.querySelector("[name=amountPaise]").value =
                  o.amount_paise;
            };
          }
          if (step === 2) {
            panel.innerHTML =
              '<label>Draft source document<input id="draft-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt"></label><button id="draft-upload">Save private source</button><button id="draft-process">Extract draft fields</button><p>' +
              escape(
                ready.document
                  ? "Saved source " +
                      ready.document.id +
                      " · " +
                      ready.document.status
                  : "Upload a source document",
              ) +
              "</p><p>If extraction fails, your draft remains available. Enter and confirm fields against the original source.</p>" +
              (ready.document
                ? '<a href="/api/drafts/' +
                  id +
                  "/documents/" +
                  ready.document.id +
                  '">Download original draft source</a>'
                : "");
            panel.querySelector("#draft-upload").onclick = () =>
              run(async () => {
                const file = panel.querySelector("input").files[0];
                if (!file) throw Error("Choose a file");
                await save();
                const bytes = new Uint8Array(await file.arrayBuffer());
                if (bytes.length > 4194304) throw Error("File exceeds 4 MiB");
                let text = "";
                for (const b of bytes) text += String.fromCharCode(b);
                const r = await api("/drafts/" + id + "/documents", "POST", {
                  revision,
                  mime:
                    file.type ||
                    (file.name.endsWith(".txt") ? "text/plain" : undefined),
                  base64: btoa(text),
                });
                revision = r.revision;
                await draw();
              });
            panel.querySelector("#draft-process").onclick = () =>
              run(async () => {
                await save();
                await api("/drafts/" + id + "/process", "POST", { revision });
                await draw();
              });
          }
          if (step === 3) {
            panel.innerHTML =
              '<p>Extracted proposals never overwrite confirmed facts. Review original evidence before confirming. Amounts use integer paise.</p><form id="draft-form">' +
              keys
                .map((k) => {
                  const f = extraction?.fields?.[k];
                  return (
                    "<fieldset><legend>" +
                    escape(k) +
                    "</legend><label>" +
                    escape("Submission " + k) +
                    '<input name="' +
                    k +
                    '" value="' +
                    escape(payload.instrument?.[k] ?? "") +
                    '" ' +
                    (k === "amountPaise"
                      ? 'type="number" step="1" min="1"'
                      : k === "issued" || k === "matures"
                        ? 'type="date"'
                        : "") +
                    "></label>" +
                    (f
                      ? "<p>Document proposal: " +
                        escape(f.value ?? "Withheld; inspect source") +
                        " · page " +
                        escape(f.page) +
                        " · " +
                        escape(f.method) +
                        " · " +
                        escape(f.status || "Uncalibrated extraction") +
                        "</p>" +
                        (f.value !== undefined
                          ? '<button type="button" data-use="' +
                            k +
                            '">Use ' +
                            k +
                            " proposal</button>"
                          : "")
                      : "<p>No extracted value. Use only supported source information.</p>") +
                    '<label><input type="checkbox" data-confirm="' +
                    k +
                    '" ' +
                    (payload.confirmedFields?.includes(k) ? "checked" : "") +
                    "> " +
                    escape("I confirmed " + k + " against its source") +
                    "</label></fieldset>"
                  );
                })
                .join("") +
              "</form>";
            for (const b of panel.querySelectorAll("[data-use]"))
              b.onclick = () => {
                const k = b.dataset.use;
                if (panel.querySelector('[data-confirm="' + k + '"]').checked) {
                  host.querySelector("#draft-save-status").textContent =
                    "Uncheck confirmation before changing this value";
                  return;
                }
                panel.querySelector('[name="' + k + '"]').value =
                  extraction.fields[k].value;
                save().catch(
                  (e) =>
                    (host.querySelector("#draft-save-status").textContent =
                      e.message),
                );
              };
            for (const input of panel.querySelectorAll("input[name]"))
              input.addEventListener(
                "input",
                () =>
                  (panel.querySelector(
                    '[data-confirm="' + input.name + '"]',
                  ).checked = false),
              );
          }
          if (step === 4)
            panel.innerHTML =
              "<h2>" +
              escape(ready.outcome.replaceAll("_", " ")) +
              "</h2><ul>" +
              [...ready.blockers, ...ready.warnings]
                .map((f) => "<li>" + escape(f.message) + "</li>")
                .join("") +
              "</ul><p>Unverified policy interpretations are review warnings, not authoritative restrictions.</p>";
          if (step === 5) {
            panel.innerHTML =
              "<h2>Final submission review</h2><p>" +
              escape(payload.name) +
              "</p><dl>" +
              Object.entries(payload.instrument || {})
                .map(
                  ([k, v]) =>
                    "<dt>" + escape(k) + "</dt><dd>" + escape(v) + "</dd>",
                )
                .join("") +
              "</dl><p>" +
              escape(ready.outcome.replaceAll("_", " ")) +
              '</p><button id="draft-submit" ' +
              (ready.blockers.length ? "disabled" : "") +
              ">Submit confirmed draft</button>";
            panel.querySelector("#draft-submit").onclick = () =>
              run(async () => {
                clearTimeout(timer);
                await save();
                const r = await api("/drafts/" + id + "/submit", "POST", {
                  revision,
                });
                await detail(r.id);
                document.querySelector("#notice").textContent =
                  "Submission acknowledged: " + r.id;
              });
          }
          host.querySelector("#draft-save").onclick = () => run(save);
          host.querySelector("#draft-back").disabled = step === 1;
          host.querySelector("#draft-next").hidden = step === 5;
          for (const [button, delta] of [
            ["#draft-back", -1],
            ["#draft-next", 1],
          ])
            host.querySelector(button).onclick = () =>
              run(async () => {
                clearTimeout(timer);
                await save();
                step += delta;
                await save();
                await draw();
              });
          for (const input of host.querySelectorAll(
            "input[name],select[name],[data-confirm]",
          ))
            input.addEventListener("input", () => {
              host.querySelector("#draft-save-status").textContent =
                "Saving changes…";
              clearTimeout(timer);
              timer = setTimeout(
                () =>
                  save().catch((e) => {
                    const s = host.querySelector("#draft-save-status");
                    if (s)
                      s.textContent =
                        e.message + "; entered fields are retained here";
                  }),
                500,
              );
            });
        };
        await draw();
      };
      for (const d of drafts.items) {
        const b = document.createElement("button");
        b.textContent =
          (d.case_id ? "Open submitted case" : "Continue saved draft") +
          " · " +
          (d.payload.name || d.id);
        b.onclick = () => run(() => open(d.id));
        host.querySelector("#draft-list").append(b);
      }
      host.querySelector("#draft-new").onclick = () =>
        run(async () => {
          const profile = await api("/institution"),
            d = await api("/drafts", "POST", {
              payload: {
                name: profile.name || "",
                instrument: profile.name
                  ? { institutionName: profile.name }
                  : {},
                confirmedFields: [],
                step: 1,
              },
            });
          await open(d.id);
        });
    });
};
