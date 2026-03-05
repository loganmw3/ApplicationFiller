// Main content script code wrapped in IIFE to prevent conflicts
(function() {
  "use strict";

  // Prevent running on internal browser/extension pages.
  if (
    window.location.protocol === "chrome:" ||
    window.location.protocol === "chrome-extension:" ||
    window.location.protocol === "moz-extension:"
  ) {
    return;
  }

  // Prevent duplicate listeners when script is manually injected multiple times.
  const root = document.documentElement;
  const guardAttr = "data-job-autofill-loaded";
  if (!root || root.hasAttribute(guardAttr)) {
    return;
  }
  root.setAttribute(guardAttr, "1");

function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getLabelText(el) {
  // 1) <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return normalize(label.textContent);
  }
  // 2) wrapping label <label> <input> ... </label>
  const parentLabel = el.closest("label");
  if (parentLabel) return normalize(parentLabel.textContent);

  // 3) aria-label / placeholder
  return normalize(
    el.getAttribute("aria-label") || el.getAttribute("placeholder") || "",
  );
}

function fieldScore(el, keys) {
  const attrs = [
    el.name,
    el.id,
    el.getAttribute("autocomplete"),
    el.getAttribute("aria-label"),
    el.getAttribute("placeholder"),
    getLabelText(el),
  ].map(normalize);

  let score = 0;
  for (const key of keys) {
    const k = normalize(key);
    for (const a of attrs) {
      if (!a) continue;
      if (a === k) score += 10;
      else if (a.includes(k)) score += 3;
    }
  }
  return score;
}

function isFillableInput(el) {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = (el.type || "text").toLowerCase();
  const allowedTypes = new Set([
    "text",
    "email",
    "tel",
    "url",
    "search",
    "number",
  ]);
  return allowedTypes.has(type);
}

function isEditableField(el) {
  const tag = el.tagName.toLowerCase();
  if (el.disabled || el.readOnly || el.type === "hidden" || el.offsetParent === null) {
    return false;
  }
  if (tag === "textarea" || tag === "select") return true;
  return isFillableInput(el);
}

function setNativeValue(el, value) {
  const tag = el.tagName.toLowerCase();
  const before = el.value;

  if (tag === "select") {
    const opts = [...el.options];
    const vNorm = normalize(value);

    const best =
      opts.find((o) => normalize(o.value) === vNorm) ||
      opts.find((o) => normalize(o.textContent) === vNorm) ||
      opts.find((o) => normalize(o.textContent).includes(vNorm));

    if (best) el.value = best.value;
  } else if (tag === "textarea" || tag === "input") {
    el.value = value;
  }

  if (el.value === before) return;

  // Trigger frameworks (React/Vue/etc.)
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function looksLikeResumeUpload(inputEl) {
  const t = normalize(
    getLabelText(inputEl) +
      " " +
      (inputEl.name || "") +
      " " +
      (inputEl.id || ""),
  );
  return [
    "resume",
    "cv",
    "curriculum vitae",
    "upload resume",
    "attach resume",
    "upload cv",
  ].some((k) => t.includes(k));
}

function dataUrlToFile(dataUrl, filename, mimeType) {
  const parts = dataUrl.split(",");
  if (parts.length < 2) return null;

  const base64 = parts[1];
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: mimeType || "application/octet-stream",
  });
  return new File([blob], filename || "resume", {
    type: mimeType || blob.type,
  });
}

function tryUploadResume(resume) {
  if (!resume?.dataUrl || !resume?.meta?.name) return;

  const fileInputs = [
    ...document.querySelectorAll('input[type="file"]'),
  ].filter((el) => !el.disabled && el.offsetParent !== null);

  if (fileInputs.length === 0) return;

  // Prefer inputs that look like resume/cv uploads
  const ranked = fileInputs
    .map((el) => ({ el, score: looksLikeResumeUpload(el) ? 10 : 0 }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0].el;

  const file = dataUrlToFile(
    resume.dataUrl,
    resume.meta.name,
    resume.meta.type,
  );
  if (!file) return;

  // Some sites block programmatic assignment; this works on many standard forms.
  const dt = new DataTransfer();
  dt.items.add(file);
  best.files = dt.files;

  best.dispatchEvent(new Event("input", { bubbles: true }));
  best.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillProfile(profile) {
  const inputs = [
    ...document.querySelectorAll("input, textarea, select"),
  ].filter((el) => isEditableField(el));

  const map = [
    {
      key: "firstName",
      keys: [
        "first name",
        "given name",
        "fname",
        "first_name",
        "firstname",
        "given-name",
      ],
    },
    {
      key: "lastName",
      keys: [
        "last name",
        "family name",
        "lname",
        "last_name",
        "lastname",
        "family-name",
        "surname",
      ],
    },
    { key: "email", keys: ["email", "e-mail"] },
    { key: "phone", keys: ["phone", "mobile", "cell", "telephone", "tel"] },

    {
      key: "address",
      keys: ["address", "street", "street address", "address line"],
    },
    { key: "country", keys: ["country", "nation", "country/region"] },
    { key: "city", keys: ["city", "town"] },
    { key: "state", keys: ["state", "province", "region"] },
    { key: "zip", keys: ["zip", "zipcode", "postal", "postal code"] },
    {
      key: "currentTitle",
      keys: [
        "current title",
        "job title",
        "current position",
        "current role",
        "title",
      ],
    },
    {
      key: "usCitizen",
      keys: ["u.s. citizen", "us citizen", "citizenship", "citizen"],
    },
    {
      key: "workAuthorization",
      keys: [
        "authorized to work",
        "work authorization",
        "legally authorized",
        "eligible to work",
      ],
    },
    {
      key: "requireSponsorship",
      keys: [
        "sponsorship",
        "require sponsorship",
        "need sponsorship",
        "visa sponsorship",
      ],
    },
    {
      key: "startDateAvailability",
      keys: [
        "start date",
        "available to start",
        "availability",
        "available from",
        "when can you start",
      ],
    },
    {
      key: "willingToRelocate",
      keys: ["relocate", "willing to relocate", "relocation"],
    },
    {
      key: "willingToTravel",
      keys: ["travel", "willing to travel", "travel requirement"],
    },
    {
      key: "gender",
      keys: ["gender", "sex", "gender identity"],
    },
    {
      key: "raceEthnicity",
      keys: ["race", "ethnicity", "race/ethnicity", "racial"],
    },
    {
      key: "disabilityStatus",
      keys: ["disability", "disabled", "have a disability"],
    },
    {
      key: "veteranStatus",
      keys: ["veteran", "protected veteran", "military status"],
    },

    { key: "linkedin", keys: ["linkedin", "linked in"] },
    { key: "github", keys: ["github"] },
    {
      key: "portfolio",
      keys: ["portfolio", "website", "personal site", "site url", "url"],
    },
    { key: "school", keys: ["school", "university", "college", "institution"] },
    { key: "degree", keys: ["degree", "education level", "qualification"] },
    { key: "major", keys: ["major", "field of study", "specialization"] },
    { key: "gradMonth", keys: ["graduation month", "grad month"] },
    { key: "gradYear", keys: ["graduation year", "grad year", "year graduated"] },
    {
      key: "securityClearance",
      keys: ["security clearance", "clearance level", "clearance"],
    },

    { key: "gpa", keys: ["gpa", "grade point average", "grade-point average"] },

    // Keep summary short-ish fields
    { key: "summary", keys: ["summary", "about", "bio", "introduction"] },

    // Separate cover letter matching
    {
      key: "coverLetter",
      keys: [
        "cover letter",
        "coverletter",
        "message to hiring manager",
        "why do you want",
        "why this role",
      ],
    },
  ];

  for (const m of map) {
    const val = profile?.[m.key];
    if (!val) continue;

    let bestEl = null;
    let bestScore = 0;

    for (const el of inputs) {
      if (el.type === "password") continue;

      // Avoid stuffing cover letter into tiny inputs
      if (m.key === "coverLetter" && el.tagName.toLowerCase() === "input")
        continue;

      // Avoid stuffing GPA into big textareas
      if (m.key === "gpa" && el.tagName.toLowerCase() === "textarea") continue;

      const s = fieldScore(el, m.keys);
      if (s > bestScore) {
        bestScore = s;
        bestEl = el;
      }
    }

    // Threshold: reduce accidental fills
    if (bestEl && bestScore >= 6) {
      const current = (bestEl.value || "").trim();
      if (!current) setNativeValue(bestEl, val);
    }
  }
}

function shouldThrottleAutofill() {
  const KEY = "jobAutofill:lastRunAt";
  const COOLDOWN_MS = 4000;
  try {
    const now = Date.now();
    const prev = Number(sessionStorage.getItem(KEY) || 0);
    if (prev && now - prev < COOLDOWN_MS) return true;
    sessionStorage.setItem(KEY, String(now));
  } catch (error) {
    // If sessionStorage is blocked, continue without throttle.
  }
  return false;
}

      try {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          try {
            if (msg?.type === "AUTOFILL") {
              if (shouldThrottleAutofill()) {
                sendResponse({ success: false, skipped: "throttled" });
                return true;
              }
              fillProfile(msg.profile || {});
              tryUploadResume(msg.resume || null);
              sendResponse({ success: true });
            }
          } catch (error) {
            console.error("Autofill error:", error);
            sendResponse({ success: false, error: error.message });
          }
          return true; // Keep message channel open for async response
        });
      } catch (error) {
        console.error("Failed to set up message listener:", error);
      }

})(); // End IIFE
