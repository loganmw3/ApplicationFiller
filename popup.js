const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "linkedin",
  "github",
  "portfolio",
  "address",
  "country",
  "city",
  "state",
  "zip",
  "currentTitle",
  "currentCompany",
  "currentLocation",
  "usCitizen",
  "workAuthorization",
  "requireSponsorship",
  "startDateAvailability",
  "willingToRelocate",
  "willingToTravel",
  "gender",
  "raceEthnicity",
  "disabilityStatus",
  "veteranStatus",
  "school",
  "degree",
  "major",
  "gradMonth",
  "gradYear",
  "securityClearance",
  "gpa",
  "summary",
  "coverLetter",
];

const APPLICATION_FIELDS = [
  "company",
  "typeOfCompany",
  "applicationLocation",
  "jobTitle",
  "location",
  "salaryK",
  "url",
  "dateApplied",
];

const SHEET_CONFIG_FIELDS = ["sheetWebhookUrl", "sheetWebhookToken"];

function getFieldValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value || "";
}

function getCheckboxValue(id) {
  return !!document.getElementById(id)?.checked;
}

function setCheckboxValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!value;
}

function setActivePanel(panel) {
  const loggerTab = document.getElementById("tabLogger");
  const profileTab = document.getElementById("tabProfile");
  const loggerPanel = document.getElementById("panelLogger");
  const profilePanel = document.getElementById("panelProfile");

  const loggerActive = panel === "logger";
  loggerTab.classList.toggle("active", loggerActive);
  profileTab.classList.toggle("active", !loggerActive);
  loggerPanel.classList.toggle("active", loggerActive);
  profilePanel.classList.toggle("active", !loggerActive);
}

function setupTabs() {
  document.getElementById("tabLogger").addEventListener("click", () => {
    setActivePanel("logger");
  });
  document.getElementById("tabProfile").addEventListener("click", () => {
    setActivePanel("profile");
  });
}

function getAutofillOptionsFromPopup() {
  return {
    fillFieldsToggle: getCheckboxValue("fillFieldsToggle"),
    uploadResumeToggle: getCheckboxValue("uploadResumeToggle"),
  };
}

function setAutofillOptionsFromData(data = {}) {
  setCheckboxValue("fillFieldsToggle", data.fillFieldsToggle !== false);
  setCheckboxValue("uploadResumeToggle", data.uploadResumeToggle !== false);
}

function getProfileDataFromPopup() {
  const data = {};
  for (const k of PROFILE_FIELDS) data[k] = getFieldValue(k);
  return data;
}

function setPopupProfileFromData(data = {}) {
  for (const k of PROFILE_FIELDS) setFieldValue(k, data[k]);
}

function getApplicationDataFromPopup() {
  const data = {};
  for (const k of APPLICATION_FIELDS) data[k] = getFieldValue(k);
  return data;
}

function setPopupApplicationFromData(data = {}) {
  for (const k of APPLICATION_FIELDS) setFieldValue(k, data[k]);
}

async function saveApplicationDraftFromPopup() {
  const applicationDraft = getApplicationDataFromPopup();
  await chrome.storage.sync.set({ applicationDraft });
}

function getSheetConfigFromPopup() {
  const data = {};
  for (const k of SHEET_CONFIG_FIELDS) data[k] = getFieldValue(k);
  return data;
}

function setPopupSheetConfigFromData(data = {}) {
  for (const k of SHEET_CONFIG_FIELDS) setFieldValue(k, data[k]);
}

function formatToday() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function titleCase(input) {
  return String(input || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function detectApplicationLocation(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return "";
  if (u.includes("greenhouse.io")) return "Greenhouse";
  if (u.includes("jobs.lever.co") || u.includes("lever.co")) return "Lever";
  if (u.includes("myworkdayjobs.com") || u.includes("workday")) return "Workday";
  if (u.includes("jobs.ashbyhq.com")) return "Ashby";
  if (u.includes("linkedin.com")) return "LinkedIn";
  if (u.includes("indeed.com")) return "Indeed";
  return "Company site";
}

function guessCompanyFromTab(tab) {
  try {
    const tabUrl = new URL(tab.url || "");
    const host = tabUrl.hostname.replace(/^www\./, "");
    if (host.includes("greenhouse.io")) {
      const parts = tabUrl.pathname.split("/").filter(Boolean);
      if (parts[0]) return titleCase(parts[0].replace(/[-_]+/g, " "));
    }
    if (host.includes("lever.co")) {
      const parts = tabUrl.pathname.split("/").filter(Boolean);
      if (parts[0]) return titleCase(parts[0].replace(/[-_]+/g, " "));
    }
    if (tab.title) {
      const atMatch = tab.title.match(/\bat\s+([^|\-]+)/i);
      if (atMatch?.[1]) return atMatch[1].trim();
      const byDash = tab.title.split(" - ").map((s) => s.trim()).filter(Boolean);
      if (byDash.length >= 2) return byDash[1];
    }
    const hostCore = host.split(".")[0] || "";
    return titleCase(hostCore.replace(/[-_]+/g, " "));
  } catch (error) {
    return "";
  }
}

function guessJobTitleFromTab(tab) {
  const title = String(tab?.title || "").trim();
  if (!title) return "";
  const parts = title.split(" - ").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 0) return parts[0];
  return title;
}

async function extractJobMetadataFromPage(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        function text(v) {
          return String(v || "").replace(/\s+/g, " ").trim();
        }

        function parseJsonLd() {
          const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
          const entries = [];
          for (const s of scripts) {
            try {
              const parsed = JSON.parse(s.textContent || "");
              if (Array.isArray(parsed)) entries.push(...parsed);
              else entries.push(parsed);
            } catch (error) {
              // Ignore malformed JSON-LD blocks.
            }
          }
          return entries;
        }

        function findJobPosting(entries) {
          const queue = [...entries];
          while (queue.length) {
            const node = queue.shift();
            if (!node || typeof node !== "object") continue;
            const type = node["@type"];
            const types = Array.isArray(type) ? type : [type];
            if (types.some((t) => String(t || "").toLowerCase() === "jobposting")) {
              return node;
            }
            for (const v of Object.values(node)) {
              if (v && typeof v === "object") queue.push(v);
            }
          }
          return null;
        }

        function salaryToK(baseSalary) {
          if (!baseSalary) return "";
          const value = baseSalary.value || baseSalary;
          const min = Number(value.minValue || value.value || "");
          const max = Number(value.maxValue || "");
          const unit = String(value.unitText || baseSalary.unitText || "").toUpperCase();
          const yearly = !unit || unit.includes("YEAR") || unit.includes("ANNUAL");
          if (!yearly || !Number.isFinite(min)) return "";
          const minK = Math.round(min / 1000);
          if (Number.isFinite(max) && max > min) {
            const maxK = Math.round(max / 1000);
            return `${minK}-${maxK}`;
          }
          return `${minK}`;
        }

        function firstTextSelector(selectors) {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            const val = text(el?.textContent);
            if (val) return val;
          }
          return "";
        }

        function cleanLocation(v) {
          return text(v)
            .replace(/^location[:\s-]*/i, "")
            .replace(/\s+\|\s+.*$/, "");
        }

        function findSalaryInText() {
          const body = text(document.body?.innerText || "");
          if (!body) return "";

          const rangeK = body.match(/\$\s?(\d{2,3})\s*[kK]\s*[-–]\s*\$?\s?(\d{2,3})\s*[kK]/);
          if (rangeK) return `${rangeK[1]}-${rangeK[2]}`;

          const rangeFull = body.match(/\$?\s?(\d{2,3}),?000\s*[-–]\s*\$?\s?(\d{2,3}),?000/);
          if (rangeFull) return `${rangeFull[1]}-${rangeFull[2]}`;

          const singleK = body.match(/\$\s?(\d{2,3})\s*[kK]/);
          if (singleK) return singleK[1];

          return "";
        }

        const entries = parseJsonLd();
        const job = findJobPosting(entries);

        const companyJson = text(
          job?.hiringOrganization?.name ||
            (Array.isArray(job?.hiringOrganization) ? job.hiringOrganization[0]?.name : ""),
        );
        const locationJson = (() => {
          const jl = job?.jobLocation;
          const first = Array.isArray(jl) ? jl[0] : jl;
          const addr = first?.address || first;
          const parts = [
            addr?.addressLocality,
            addr?.addressRegion,
            addr?.addressCountry,
          ]
            .map(text)
            .filter(Boolean);
          return parts.join(", ");
        })();

        const out = {
          jobTitle: text(job?.title || document.querySelector("h1")?.textContent),
          company: companyJson,
          location: cleanLocation(
            locationJson ||
              firstTextSelector([
                '[data-qa*="location"]',
                '[class*="location"]',
                '[id*="location"]',
                '[data-testid*="location"]',
              ]),
          ),
          salaryK: salaryToK(job?.baseSalary) || findSalaryInText(),
        };

        return out;
      },
    });
    return result?.result || {};
  } catch (error) {
    return {};
  }
}

async function getActiveHttpTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    return null;
  }
  return tab;
}

async function hydrateApplicationFieldsFromActiveTab({ overwrite = false } = {}) {
  const tab = await getActiveHttpTab();
  if (!tab) return;
  const extracted = tab.id ? await extractJobMetadataFromPage(tab.id) : {};

  const updates = {
    url: tab.url || "",
    jobTitle: extracted.jobTitle || guessJobTitleFromTab(tab),
    company: extracted.company || guessCompanyFromTab(tab),
    location: extracted.location || "",
    salaryK: extracted.salaryK || "",
    applicationLocation: detectApplicationLocation(tab.url || ""),
    dateApplied: formatToday(),
  };

  for (const [key, value] of Object.entries(updates)) {
    const current = getFieldValue(key);
    if (overwrite || !current) setFieldValue(key, value);
  }
}

async function loadPopup() {
  const { profile, applicationDraft } = await chrome.storage.sync.get({
    profile: {},
    applicationDraft: {},
  });
  const { sheetConfig, autofillOptions } = await chrome.storage.local.get({
    sheetConfig: {},
    autofillOptions: {
      fillFieldsToggle: true,
      uploadResumeToggle: true,
    },
  });

  setPopupProfileFromData(profile);
  setPopupApplicationFromData(applicationDraft);
  setPopupSheetConfigFromData(sheetConfig);
  setAutofillOptionsFromData(autofillOptions);
  await hydrateApplicationFieldsFromActiveTab({ overwrite: false });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function guessMime(filename) {
  const f = (filename || "").toLowerCase();
  if (f.endsWith(".pdf")) return "application/pdf";
  if (f.endsWith(".doc")) return "application/msword";
  if (f.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

async function saveProfile() {
  const profile = getProfileDataFromPopup();
  const applicationDraft = getApplicationDataFromPopup();
  const sheetConfig = getSheetConfigFromPopup();
  const autofillOptions = getAutofillOptionsFromPopup();

  await chrome.storage.sync.set({ profile, applicationDraft });
  await chrome.storage.local.set({ sheetConfig, autofillOptions });

  const fileInput = document.getElementById("resumeFile");
  const file = fileInput.files && fileInput.files[0];

  // Only update resume if the user chose a file this time
  if (file) {
    const dataUrl = await readFileAsDataURL(file);
    await chrome.storage.local.set({
      resumeDataUrl: dataUrl,
      resumeMeta: { name: file.name, type: file.type || guessMime(file.name) },
    });
  }
}

async function fillCurrentTab() {
  try {
    const { profile } = await chrome.storage.sync.get({ profile: {} });
    const { resumeDataUrl, resumeMeta } = await chrome.storage.local.get({
      resumeDataUrl: null,
      resumeMeta: null,
    });
    const latestToggles = getAutofillOptionsFromPopup();
    const options = {
      fillProfile: latestToggles.fillFieldsToggle,
      uploadResume: latestToggles.uploadResumeToggle,
    };
    await chrome.storage.local.set({ autofillOptions: latestToggles });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      alert("No active tab found.");
      return;
    }

    // Check if tab URL is supported
    if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
      alert("This extension only works on http:// and https:// pages.");
      return;
    }

    const payload = {
      type: "AUTOFILL",
      profile,
      options,
      resume:
        resumeDataUrl && resumeMeta
          ? { dataUrl: resumeDataUrl, meta: resumeMeta }
          : null,
    };

    async function injectContentScript(tabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ["content.js"],
        });
      } catch (error) {
        // Some pages have restricted subframes; inject into top frame at minimum.
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
      }
    }

    async function runFallbackAutofill(tabId, msg) {
      try {
        return await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: (data) => {
            const fn = globalThis.__jobAutofillHandle;
            if (typeof fn === "function") return fn(data);
            return { success: false, skipped: "handler_missing" };
          },
          args: [msg],
        });
      } catch (error) {
        return await chrome.scripting.executeScript({
          target: { tabId },
          func: (data) => {
            const fn = globalThis.__jobAutofillHandle;
            if (typeof fn === "function") return fn(data);
            return { success: false, skipped: "handler_missing" };
          },
          args: [msg],
        });
      }
    }

    // Inject and run directly in-page to avoid runtime messaging race/issues.
    let results = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await injectContentScript(tab.id);
      results = await runFallbackAutofill(tab.id, payload);
      const anySuccess = (results || []).some(
        (r) => r?.result && r.result.success === true,
      );
      if (anySuccess) return;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }

    const firstFailure = (results || []).find((r) => r?.result?.error || r?.result?.skipped);
    const reason = firstFailure?.result?.error || firstFailure?.result?.skipped || "no_target_fields";
    throw new Error(`Autofill failed: ${reason}`);
  } catch (error) {
    console.error("Fill error:", error);
    throw error;
  }
}

async function logApplicationToSheet() {
  const sheetConfig = getSheetConfigFromPopup();
  const payload = getApplicationDataFromPopup();

  if (!sheetConfig.sheetWebhookUrl) {
    alert("Missing Webhook URL.");
    return;
  }
  if (!sheetConfig.sheetWebhookToken) {
    alert("Missing Webhook Token.");
    return;
  }
  if (!payload.company || !payload.jobTitle || !payload.url) {
    alert("Please fill Company, Job Title, and URL.");
    return;
  }

  await chrome.storage.sync.set({ applicationDraft: payload });
  await chrome.storage.local.set({ sheetConfig });

  let response;
  try {
    response = await fetch(sheetConfig.sheetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: sheetConfig.sheetWebhookToken,
        ...payload,
      }),
    });
  } catch (error) {
    console.error("Sheet log network error:", error);
    alert("Failed to reach webhook URL.");
    return;
  }

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    parsed = null;
  }

  if (!response.ok || (parsed && parsed.ok === false)) {
    const reason =
      parsed?.error || `HTTP ${response.status}${raw ? `: ${raw}` : ""}`;
    alert(`Log failed: ${reason}`);
    return;
  }

  if (parsed?.skipped === "duplicate_url") {
    alert("Skipped: URL already exists in your sheet.");
    return;
  }

  alert("Application logged to Google Sheet.");
}

document.getElementById("save").addEventListener("click", async () => {
  try {
    await saveProfile();
  } catch (e) {
    console.error(e);
    alert("Save failed. Check console for details.");
  }
});

document.getElementById("fill").addEventListener("click", async () => {
  try {
    await fillCurrentTab();
  } catch (e) {
    console.error(e);
    alert(`Fill failed: ${e?.message || String(e)}`);
  }
});

document.getElementById("fillFromLogger").addEventListener("click", async () => {
  try {
    await fillCurrentTab();
  } catch (e) {
    console.error(e);
    alert(`Fill failed: ${e?.message || String(e)}`);
  }
});

document.getElementById("autofillLogFromTab").addEventListener("click", async () => {
  try {
    await hydrateApplicationFieldsFromActiveTab({ overwrite: true });
    await saveApplicationDraftFromPopup();
  } catch (e) {
    console.error(e);
    alert("Could not read current tab details.");
  }
});

document.getElementById("logApplication").addEventListener("click", async () => {
  try {
    await logApplicationToSheet();
  } catch (e) {
    console.error(e);
    alert("Log failed. Check console for details.");
  }
});

for (const fieldId of APPLICATION_FIELDS) {
  const el = document.getElementById(fieldId);
  if (!el) continue;
  const onChange = async () => {
    try {
      await saveApplicationDraftFromPopup();
    } catch (error) {
      console.error("Failed to autosave application draft:", error);
    }
  };
  el.addEventListener("input", onChange);
  el.addEventListener("change", onChange);
}

setupTabs();
loadPopup();
