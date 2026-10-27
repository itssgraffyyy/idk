window.openEvidenceViewer = async function ({
  c,
  api,
  run,
  versionId,
  extractionId = null,
  field,
  page = 1,
}) {
  const root = document.querySelector("#document-preview");
  page = Number.isInteger(page) && page >= 1 && page <= 5 ? page : 1;
  if (!root) return;
  let versions = await api("/cases/" + c.id + "/viewer/versions"),
    cursor = versions.nextCursor,
    selected = versionId || versions.items.at(-1)?.id,
    selectedExtraction = extractionId,
    metadata,
    viewport,
    selectedField = field || "",
    zoom = 100;
  root.innerHTML =
    '<div class="viewer-controls"><label>Document version<select id="viewer-version" aria-label="Document version"></select></label><button id="viewer-more">Load earlier document versions</button><label>PDF page<input id="pdf-page" type="number" min="1" max="5" value="' +
    page +
    '"></label><button id="pdf-show">Show page</button><label>Evidence comparison<select id="viewer-mode" aria-label="Evidence comparison"><option value="latest">Latest extracted or corrected fields</option><option value="original">Original extraction</option></select></label><label>Highlight extracted field<select id="viewer-field"></select></label><label>Evidence zoom (%)<input id="viewer-zoom" type="range" min="50" max="200" step="25" value="100"></label><a id="viewer-download">Download original version</a></div><p id="viewer-status" role="status"></p><div class="viewer-stage"><div class="viewer-canvas"><img id="pdf-image" alt="Protected source page"><svg id="viewer-overlay" aria-hidden="true"></svg></div></div><pre id="viewer-text" hidden></pre><dl id="viewer-facts"></dl>';
  const $ = (s) => root.querySelector(s),
    status = $("#viewer-status"),
    select = $("#viewer-version");
  const scanStatus = document.createElement("p");
  scanStatus.id = "viewer-scan-status";
  scanStatus.setAttribute("role", "note");
  root.insertBefore(scanStatus, root.querySelector(".viewer-stage"));
  const addVersions = (rows) => {
    for (const v of rows) {
      if ([...select.options].some((o) => o.value === v.id)) continue;
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = "Version " + v.version + " · " + v.created + " · " + v.id;
      select.append(o);
    }
  };
  addVersions(versions.items);
  $("#viewer-more").hidden = !cursor;
  const fields = () => metadata?.[$("#viewer-mode").value]?.fields || {};
  const highlight = () => {
    const svg = $("#viewer-overlay");
    svg.replaceChildren();
    const f = fields()[selectedField],
      rect = metadata?.[$("#viewer-mode").value]?.geometryUnavailable
        ? null
        : globalThis.projectEvidenceBox(f, viewport || {});
    if (rect) {
      const box = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      for (const [k, v] of Object.entries(rect)) box.setAttribute(k, String(v));
      box.setAttribute("class", "evidence-highlight");
      svg.append(box);
      status.textContent =
        "Highlighted " +
        selectedField +
        " on source page " +
        viewport.page +
        ". Extraction is not bank authentication.";
    } else
      status.textContent = f
        ? "Coordinates are unavailable for this source/page/orientation. Compare the original document manually."
        : "Choose an extracted field to inspect its source.";
    const facts = $("#viewer-facts");
    facts.replaceChildren();
    for (const [k, v] of Object.entries(fields())) {
      const dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent =
        String(v.value ?? "Withheld") +
        " · page " +
        v.page +
        " · " +
        v.method +
        " · " +
        (v.status || "uncalibrated extraction");
      facts.append(dt, dd);
      if (v.secondaryOCR) {
        const readings = document.createElement("details"),
          summary = document.createElement("summary"),
          primary = document.createElement("p"),
          secondary = document.createElement("p");
        summary.textContent = "Compare OCR readings before correction";
        primary.textContent = "Primary OCR: " + (v.rawValue || "not available");
        secondary.textContent =
          "Secondary OCR: " +
          String(
            v.secondaryOCR.rawText || v.secondaryOCR.value || "not available",
          ).trim() +
          (v.status === "HUMAN_CORRECTED"
            ? ". Historical OCR reading; explicit human correction is recorded."
            : ". Requires explicit human review.");
        readings.append(summary, primary, secondary);
        dd.append(readings);
      }
    }
  };
  const chooseFields = () => {
    const selector = $("#viewer-field");
    selector.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No highlight";
    selector.append(empty);
    for (const k of Object.keys(fields())) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k;
      selector.append(o);
    }
    selector.value = selectedField;
    highlight();
  };
  const show = async () => {
    select.disabled = true;
    try {
      status.textContent = "Loading protected source…";
      const n = Number($("#pdf-page").value);
      if (!Number.isInteger(n) || n < 1 || n > 5)
        throw Error("Choose a page from 1 to 5");
      metadata = await api(
        "/cases/" +
          c.id +
          "/viewer/" +
          selected +
          (selectedExtraction
            ? "?extractionId=" + encodeURIComponent(selectedExtraction)
            : ""),
      );
      const previousRecorded = $("#viewer-mode option[value='recorded']");
      scanStatus.textContent =
        "Upload malware scan: " +
        (metadata.malwareScan?.verdict || "NOT_RECORDED") +
        ". Provider: " +
        (metadata.malwareScan?.provider || "UNKNOWN") +
        ". This is not document authenticity or bank confirmation.";
      const previousMode = $("#viewer-mode").value;
      if (previousRecorded) previousRecorded.remove();
      if (metadata.recorded) {
        const option = document.createElement("option");
        option.value = "recorded";
        option.textContent = "Extraction recorded with selected evaluation";
        $("#viewer-mode").append(option);
        $("#viewer-mode").value = previousRecorded ? previousMode : "recorded";
      }
      if (![...select.options].some((o) => o.value === selected))
        addVersions([metadata.document]);
      select.value = selected;
      $("#viewer-download").href =
        "/api/cases/" + c.id + "/documents/" + selected;
      const isPDF = metadata.document.mime === "application/pdf";
      $("#pdf-page").disabled = !isPDF;
      $("#pdf-show").disabled = !isPDF;
      const response = await fetch(
        "/api/cases/" +
          c.id +
          "/documents/" +
          selected +
          "?preview=1" +
          (isPDF ? "&page=" + n : ""),
      );
      if (!response.ok) {
        let message = "Protected source unavailable";
        try {
          message = (await response.json()).error;
        } catch {}
        throw Error(message);
      }
      if (metadata.document.mime === "text/plain") {
        $(".viewer-stage").hidden = true;
        $("#viewer-text").hidden = false;
        $("#viewer-text").textContent = await response.text();
        viewport = null;
        chooseFields();
        return;
      }
      $(".viewer-stage").hidden = false;
      $("#viewer-text").hidden = true;
      if (window.activeEvidenceBlob)
        URL.revokeObjectURL(window.activeEvidenceBlob);
      window.activeEvidenceBlob = URL.createObjectURL(await response.blob());
      const img = $("#pdf-image");
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(Error("Source page could not be displayed"));
        img.src = window.activeEvidenceBlob;
      });
      viewport = isPDF
        ? {
            ...JSON.parse(response.headers.get("x-document-viewport")),
            page: n,
            rotation: 0,
          }
        : {
            width: img.naturalWidth,
            height: img.naturalHeight,
            page: 1,
            rotation: metadata.latest?.rotation || 0,
          };
      $("#pdf-page").max = response.headers.get("x-document-pages") || 1;
      const canvas = $(".viewer-canvas");
      canvas.style.width = (viewport.width * zoom) / 100 + "px";
      $("#viewer-overlay").setAttribute(
        "viewBox",
        "0 0 " + viewport.width + " " + viewport.height,
      );
      chooseFields();
    } finally {
      select.disabled = false;
    }
  };
  select.onchange = () =>
    run(async () => {
      selected = select.value;
      selectedExtraction = null;
      $("#viewer-mode").value = "latest";
      $("#pdf-page").value = 1;
      await show();
    });
  $("#pdf-show").onclick = () => run(show);
  $("#viewer-field").onchange = (e) => {
    selectedField = e.target.value;
    highlight();
  };
  $("#viewer-mode").onchange = chooseFields;
  $("#viewer-zoom").oninput = (e) => {
    zoom = Number(e.target.value);
    if (viewport)
      $(".viewer-canvas").style.width = (viewport.width * zoom) / 100 + "px";
  };
  $("#viewer-more").onclick = () =>
    run(async () => {
      const next = await api(
        "/cases/" +
          c.id +
          "/viewer/versions?cursor=" +
          encodeURIComponent(cursor),
      );
      addVersions(next.items);
      cursor = next.nextCursor;
      $("#viewer-more").hidden = !cursor;
    });
  try {
    await show();
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
};
window.mountFindingSourceLinks = function ({ c, api, run, escape }) {
  const report = (c.currentEvidence || c.history).find(
    (e) => e.kind === "evaluation",
  )?.payload;
  if (!report) return;
  [...document.querySelectorAll("#detail .finding")].forEach((panel, index) => {
    const finding = report.findings[index],
      source = finding?.sources.find(
        (s) => s.type === "document" && s.evidenceId,
      );
    if (!source) return;
    const button = document.createElement("button");
    button.textContent = "Inspect source for " + finding.code;
    button.onclick = () =>
      run(async () => {
        const data = await api(
          "/cases/" + c.id + "/viewer/" + source.evidenceId,
        );
        await window.openEvidenceViewer({
          c,
          api,
          run,
                  versionId: source.evidenceId,
          field: source.field,
          page: data.latest?.fields?.[source.field]?.page || 1,
        });
        document
          .querySelector("#document-preview")
          .scrollIntoView({ block: "nearest" });
      });
    panel.append(button);
  });
};
