const FIELDS = [
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

function getFormDataFromPopup() {
  const data = {};
  for (const k of FIELDS)
    data[k] = document.getElementById(k).value?.trim() || "";
  return data;
}

function setPopupFromData(data = {}) {
  for (const k of FIELDS) document.getElementById(k).value = data[k] || "";
}

async function loadProfile() {
  const { profile } = await chrome.storage.sync.get({ profile: {} });
  setPopupFromData(profile);
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
  const profile = getFormDataFromPopup();
  await chrome.storage.sync.set({ profile });

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

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "AUTOFILL",
        profile,
        resume:
          resumeDataUrl && resumeMeta
            ? { dataUrl: resumeDataUrl, meta: resumeMeta }
            : null,
      });
    } catch (error) {
      // Content script might not be loaded yet, try injecting it
      if (error.message && error.message.includes("Could not establish connection")) {
        // Inject the script manually
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        // Wait a bit for script to load, then retry
        await new Promise(resolve => setTimeout(resolve, 100));
        await chrome.tabs.sendMessage(tab.id, {
          type: "AUTOFILL",
          profile,
          resume:
            resumeDataUrl && resumeMeta
              ? { dataUrl: resumeDataUrl, meta: resumeMeta }
              : null,
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error("Fill error:", error);
    throw error;
  }
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
    alert("Fill failed. Check console for details.");
  }
});

loadProfile();
