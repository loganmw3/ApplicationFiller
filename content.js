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
  if (!resume?.dataUrl || !resume?.meta?.name) return { skipped: "missing_resume_data" };

  try {
    const fileInputs = [
      ...document.querySelectorAll('input[type="file"]'),
    ].filter((el) => !el.disabled && el.offsetParent !== null);

    if (fileInputs.length === 0) return { skipped: "no_file_input" };

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
    if (!file) return { skipped: "bad_file_data" };

    // Some sites block programmatic assignment; this works on many standard forms.
    const dt = new DataTransfer();
    dt.items.add(file);
    best.files = dt.files;

    best.dispatchEvent(new Event("input", { bubbles: true }));
    best.dispatchEvent(new Event("change", { bubbles: true }));
    return { uploaded: true };
  } catch (error) {
    // Resume upload should never block field autofill.
    console.warn("Resume upload skipped:", error);
    return { skipped: "upload_blocked" };
  }
}

function textScore(haystack, needles) {
  let score = 0;
  const h = normalize(haystack);
  for (const n of needles) {
    const needle = normalize(n);
    if (!needle) continue;
    if (h === needle) score += 10;
    else if (h.includes(needle)) score += 4;
  }
  return score;
}

function getChoiceOptionText(el) {
  const label = getLabelText(el);
  const value = normalize(el.value || "");
  const aria = normalize(el.getAttribute("aria-label") || "");
  return normalize(`${label} ${value} ${aria}`);
}

function getChoiceQuestionText(el) {
  const bits = [
    el.name || "",
    el.id || "",
    el.getAttribute("aria-label") || "",
    el.getAttribute("data-qa") || "",
  ];

  const fieldset = el.closest("fieldset");
  if (fieldset) {
    bits.push(fieldset.getAttribute("aria-label") || "");
    const legend = fieldset.querySelector("legend");
    if (legend) bits.push(legend.textContent || "");
  }

  const group = el.closest('[role="group"],[role="radiogroup"]');
  if (group) bits.push(group.getAttribute("aria-label") || "");

  const container = el.closest("fieldset, section, form, div");
  if (container) {
    const heading = container.querySelector("h1,h2,h3,h4,h5,h6");
    if (heading) bits.push(heading.textContent || "");
  }

  return normalize(bits.join(" "));
}

function setChoiceChecked(el) {
  if (el.checked) return;
  el.click();
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function isChoiceInteractable(el) {
  if (el.disabled) return false;
  if (el.offsetParent !== null) return true;

  const wrappedLabel = el.closest("label");
  if (wrappedLabel && wrappedLabel.offsetParent !== null) return true;

  if (el.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (forLabel && forLabel.offsetParent !== null) return true;
  }
  return false;
}

function fillChoiceFields(profile) {
  const controls = [
    ...document.querySelectorAll('input[type="radio"], input[type="checkbox"]'),
  ].filter((el) => isChoiceInteractable(el));

  const choiceConfigs = [
    {
      key: "gender",
      questionKeys: ["gender", "sex", "gender identity"],
      options: {
        male: ["male"],
        female: ["female"],
        "non-binary": ["non-binary", "nonbinary", "non binary"],
        "prefer not to say": ["prefer not", "decline", "not to answer"],
      },
    },
    {
      key: "raceEthnicity",
      questionKeys: ["race", "ethnicity", "race/ethnicity", "self-identify"],
      options: {
        white: ["white"],
        "black or african american": ["black or african american", "african american", "black"],
        "hispanic or latino": ["hispanic or latino", "hispanic", "latino"],
        asian: ["asian"],
        "american indian or alaska native": ["american indian", "alaska native"],
        "native hawaiian or other pacific islander": ["native hawaiian", "pacific islander"],
        "two or more races": ["2 or more races", "two or more races", "multiracial"],
        "prefer not to say": ["prefer not", "decline", "decline to answer"],
      },
    },
    {
      key: "disabilityStatus",
      questionKeys: ["disability", "disabled", "have a disability"],
      options: {
        yes: ["yes"],
        no: ["no"],
        "prefer not to say": ["prefer not", "decline"],
      },
    },
    {
      key: "veteranStatus",
      questionKeys: ["veteran", "protected veteran", "military status"],
      options: {
        yes: ["yes"],
        no: ["no"],
        "prefer not to say": ["prefer not", "decline"],
      },
    },
    {
      key: "usCitizen",
      questionKeys: ["citizen", "citizenship", "u.s. citizen", "us citizen"],
      options: { yes: ["yes"], no: ["no"] },
    },
    {
      key: "workAuthorization",
      questionKeys: ["authorized to work", "work authorization", "eligible to work"],
      options: { yes: ["yes"], no: ["no"] },
    },
    {
      key: "requireSponsorship",
      questionKeys: ["sponsorship", "visa sponsorship", "require sponsorship"],
      options: { yes: ["yes"], no: ["no"] },
    },
    {
      key: "willingToRelocate",
      questionKeys: ["relocate", "relocation", "willing to relocate"],
      options: { yes: ["yes"], no: ["no"] },
    },
    {
      key: "willingToTravel",
      questionKeys: ["travel", "willing to travel", "travel requirement"],
      options: { yes: ["yes"], no: ["no"] },
    },
  ];

  for (const cfg of choiceConfigs) {
    const raw = profile?.[cfg.key];
    if (!raw) continue;
    const desired = normalize(raw);

    let desiredAliases = null;
    for (const [canonical, aliases] of Object.entries(cfg.options)) {
      const c = normalize(canonical);
      if (desired === c || aliases.some((a) => desired === normalize(a))) {
        desiredAliases = [canonical, ...aliases];
        break;
      }
    }
    if (!desiredAliases) desiredAliases = [raw];

    let best = null;
    let bestScore = 0;
    for (const el of controls) {
      const questionText = getChoiceQuestionText(el);
      const qScore = textScore(questionText, cfg.questionKeys);
      if (qScore <= 0) continue;

      const optionText = getChoiceOptionText(el);
      const oScore = textScore(optionText, desiredAliases);
      if (oScore <= 0) continue;

      const score = qScore * 100 + oScore;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best && bestScore >= 106) setChoiceChecked(best);
  }
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
      key: "currentCompany",
      keys: [
        "current company",
        "current employer",
        "employer",
        "company",
      ],
    },
    {
      key: "currentLocation",
      keys: [
        "current location",
        "where are you located",
        "location",
        "city, state",
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

  fillChoiceFields(profile);
}

function shouldThrottleAutofill() {
  const KEY = "jobAutofill:lastRunAt";
  const COOLDOWN_MS = 1200;
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

function handleAutofillMessage(msg) {
  try {
    if (shouldThrottleAutofill()) return { success: false, skipped: "throttled" };
    const options = msg?.options || {};
    const shouldFillProfile = options.fillProfile !== false;
    const shouldUploadResume = options.uploadResume !== false;

    if (shouldFillProfile) fillProfile(msg?.profile || {});
    let resumeResult = null;
    if (shouldUploadResume) {
      resumeResult = tryUploadResume(msg?.resume || null);
    }
    return { success: true, resume: resumeResult };
  } catch (error) {
    console.error("Autofill error:", error);
    return { success: false, error: error.message };
  }
}

globalThis.__jobAutofillHandle = handleAutofillMessage;

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg?.type === "AUTOFILL") {
        sendResponse(handleAutofillMessage(msg));
      }
    } catch (error) {
      console.error("Autofill message listener error:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep message channel open for async response
  });
} catch (error) {
  console.error("Failed to set up message listener:", error);
}

})(); // End IIFE
