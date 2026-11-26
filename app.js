// app.js — Simple & Reliable Smart Medicine Reminder Engine
import { auth, db, runGeminiAI } from "./firebase-config.js?v=3";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SLOTS = [
  { key: "Morning", icon: "🌅", defaultTime: "08:30" },
  { key: "Noon", icon: "☀️", defaultTime: "13:30" },
  { key: "Afternoon", icon: "🌤️", defaultTime: "17:30" },
  { key: "Night", icon: "🌙", defaultTime: "21:30" }
];

let currentUser = null;
let scheduleData = {
  alarms: {
    Morning: "08:30",
    Noon: "13:30",
    Afternoon: "17:30",
    Night: "21:30"
  },
  medicines: []
};
let unsubDoc = null;
let alarmTimer = null;
let triggeredToday = new Set();

// ==================== REGISTER SERVICE WORKER FOR MOBILE NOTIFICATIONS ====================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ==================== HELPERS ====================
function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.innerText = msg;
  t.style.background = isError ? "#fb7185" : "#10b981";
  t.style.display = "block";
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => {
    t.style.display = "none";
  }, 2600);
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function compressImage(file, maxDim = 960, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = maxDim / Math.max(width, height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mime: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== AUTHENTICATION ====================
const googleProvider = new GoogleAuthProvider();

document.getElementById("googleLoginBtn").onclick = async () => {
  const errEl = document.getElementById("authErrText");
  errEl.classList.add("hidden");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    errEl.innerText = err.message || "Google sign-in failed.";
    errEl.classList.remove("hidden");
  }
};

document.getElementById("emailLoginForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  const errEl = document.getElementById("authErrText");
  errEl.classList.add("hidden");

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        await createUserWithEmailAndPassword(auth, email, pass);
        showToast("Account created!");
        return;
      } catch (e2) {
        errEl.innerText = e2.message;
      }
    } else {
      errEl.innerText = err.message;
    }
    errEl.classList.remove("hidden");
  }
};

document.getElementById("logoutBtn").onclick = async () => {
  if (unsubDoc) unsubDoc();
  await signOut(auth);
};

// Fail-safe so splash never hangs
setTimeout(() => {
  const splash = document.getElementById("bootSplash");
  if (splash && !splash.classList.contains("hidden")) {
    splash.classList.add("hidden");
    if (!currentUser) {
      document.getElementById("authScreen").classList.remove("hidden");
    }
  }
}, 3000);

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  document.getElementById("bootSplash").classList.add("hidden");

  if (!user) {
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("mainAppContainer").classList.add("hidden");
    return;
  }

  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("mainAppContainer").classList.remove("hidden");
  initUserSchedule(user.uid);
});

// ==================== FIRESTORE + LOCAL STORAGE SYNC ====================
function getLocalCacheKey(uid) {
  return `mediremind_simple_${uid}`;
}

async function saveSchedule() {
  if (!currentUser) return;
  localStorage.setItem(getLocalCacheKey(currentUser.uid), JSON.stringify(scheduleData));
  try {
    await setDoc(doc(db, "users", currentUser.uid, "medData", "main"), scheduleData, { merge: true });
  } catch (e) {}
}

function initUserSchedule(uid) {
  try {
    const cached = JSON.parse(localStorage.getItem(getLocalCacheKey(uid)) || "null");
    if (cached && cached.alarms) {
      scheduleData = {
        alarms: { ...scheduleData.alarms, ...cached.alarms },
        medicines: Array.isArray(cached.medicines) ? cached.medicines : []
      };
    }
  } catch (e) {}

  renderScheduleGrid();
  startAlarmClock();
  updateNotifButtonState();

  if (unsubDoc) unsubDoc();
  const docRef = doc(db, "users", uid, "medData", "main");
  unsubDoc = onSnapshot(docRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      scheduleData = {
        alarms: { ...scheduleData.alarms, ...(data.alarms || {}) },
        medicines: Array.isArray(data.medicines) ? data.medicines : []
      };
      localStorage.setItem(getLocalCacheKey(uid), JSON.stringify(scheduleData));
      renderScheduleGrid();
      updateNextAlarmBanner();
    } else {
      saveSchedule();
    }
  });
}

// ==================== RENDER 4 DOSE CARDS ====================
function renderScheduleGrid() {
  const grid = document.getElementById("scheduleGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const todayStr = getTodayDateStr();

  SLOTS.forEach((slot) => {
    const alarmVal = scheduleData.alarms[slot.key] || slot.defaultTime;
    const slotMeds = scheduleData.medicines.filter((m) => m.slot === slot.key);

    const card = document.createElement("div");
    card.className = "slot-card";

    const medsHtml =
      slotMeds.length === 0
        ? `<p style="font-size:12px; color:var(--muted); padding:8px 2px;">No medicines added for ${slot.key}.</p>`
        : slotMeds
            .map((med) => {
              const isTakenToday = med.takenDate === todayStr;
              return `
                <div class="med-item ${isTakenToday ? "taken" : ""}">
                  <div style="min-width:0; flex:1;">
                    <div class="med-title">${escapeHtml(med.name)}</div>
                    <div class="med-sub">${isTakenToday ? "✅ Taken today" : `⏰ Alert at ${alarmVal}`}</div>
                  </div>
                  <div style="display:flex; gap:5px; flex-shrink:0;">
                    <button type="button" class="btn ${isTakenToday ? "btn-ghost" : "btn-primary"}" style="padding:6px 9px; font-size:11px;" onclick="toggleMedTaken('${med.id}')">
                      ${isTakenToday ? "Undo" : "✓ Taken"}
                    </button>
                    <button type="button" class="btn btn-danger" style="padding:6px 8px; font-size:11px;" onclick="deleteMed('${med.id}')">✕</button>
                  </div>
                </div>
              `;
            })
            .join("");

    card.innerHTML = `
      <div class="slot-top">
        <span class="slot-name">${slot.icon} ${slot.key}</span>
        <input type="time" class="time-box" value="${escapeHtml(alarmVal)}" onchange="updateSlotAlarm('${slot.key}', this.value)" />
      </div>
      <div>${medsHtml}</div>
    `;

    grid.appendChild(card);
  });

  updateNextAlarmBanner();
}

window.updateSlotAlarm = async (slotKey, newTime) => {
  if (!newTime) return;
  scheduleData.alarms[slotKey] = newTime;
  renderScheduleGrid();
  await saveSchedule();
  showToast(`${slotKey} alarm set to ${newTime}`);
};

window.toggleMedTaken = async (medId) => {
  const todayStr = getTodayDateStr();
  scheduleData.medicines = scheduleData.medicines.map((m) => {
    if (m.id === medId) {
      return { ...m, takenDate: m.takenDate === todayStr ? "" : todayStr };
    }
    return m;
  });
  renderScheduleGrid();
  await saveSchedule();
};

window.deleteMed = async (medId) => {
  scheduleData.medicines = scheduleData.medicines.filter((m) => m.id !== medId);
  renderScheduleGrid();
  await saveSchedule();
  showToast("Medicine removed");
};

// ==================== MANUAL ADD MEDICINE ====================
document.getElementById("quickAddBtn").onclick = async () => {
  const nameInp = document.getElementById("medNameInput");
  const slotSel = document.getElementById("medSlotSelect");
  const name = nameInp.value.trim();
  const slot = slotSel.value;

  if (!name) return showToast("Enter a medicine name", true);

  scheduleData.medicines.push({
    id: `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    slot,
    takenDate: ""
  });

  nameInp.value = "";
  renderScheduleGrid();
  await saveSchedule();
  showToast(`Added ${name} to ${slot}`);
};

// ==================== CAMERA SCAN & GALLERY UPLOAD (GEMINI VISION) ====================
document.getElementById("scanCameraBtn").onclick = () => {
  document.getElementById("cameraInput").click();
};

document.getElementById("uploadGalleryBtn").onclick = () => {
  document.getElementById("galleryInput").click();
};

async function processPrescriptionImage(file) {
  if (!file) return;
  const statusEl = document.getElementById("aiScanStatus");
  statusEl.innerText = "📷 Scanning prescription with MediRemind AI... Please wait.";
  statusEl.classList.remove("hidden");

  try {
    const compressed = await compressImage(file, 960, 0.84);
    const prompt = `Read this doctor prescription, medicine strip, or pharmacy bill.
Extract each medicine name (with dosage if visible, e.g. "Paracetamol 500mg") and assign it to the right time slot(s) from ["Morning", "Noon", "Afternoon", "Night"].
If frequency is 1-0-1, create two entries: one for "Morning" and one for "Night". If 1-1-1, create entries for "Morning", "Noon", and "Night". If unclear, default to "Morning".
Return ONLY valid JSON:
{"medicines": [{"name": "Medicine Name", "slot": "Morning"}]}`;

    const { text, error } = await runGeminiAI({
      parts: [
        { text: prompt },
        { inline_data: { mime_type: compressed.mime, data: compressed.base64 } }
      ],
      jsonMode: true
    });

    if (!text) {
      statusEl.innerText = `⚠️ ${error || "Could not read image. Check Gemini API Key in ⚙️ Settings."}`;
      return;
    }

    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    const list = Array.isArray(parsed?.medicines) ? parsed.medicines : [];

    if (list.length === 0) {
      statusEl.innerText = "⚠️ No medicines detected. Try a clearer photo of the prescription.";
      return;
    }

    let addedCount = 0;
    const addedNames = [];
    list.forEach((item) => {
      const mName = String(item.name || "").trim();
      const validSlot = SLOTS.some((s) => s.key === item.slot) ? item.slot : "Morning";
      if (mName) {
        const alreadyExists = scheduleData.medicines.some(
          (m) => m.name.toLowerCase() === mName.toLowerCase() && m.slot === validSlot
        );
        if (!alreadyExists) {
          scheduleData.medicines.push({
            id: `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: mName,
            slot: validSlot,
            takenDate: ""
          });
          addedNames.push(`${mName} (${validSlot})`);
          addedCount++;
        }
      }
    });

    renderScheduleGrid();
    await saveSchedule();

    statusEl.innerText =
      addedCount > 0
        ? `✅ Scheduled ${addedCount} dose(s): ${addedNames.join(", ")}`
        : "✅ Medicines from this prescription are already in your schedule.";
  } catch (err) {
    statusEl.innerText = `⚠️ Scan error: ${err.message}`;
  }
}

document.getElementById("cameraInput").onchange = (e) => {
  processPrescriptionImage(e.target.files[0]);
  e.target.value = "";
};

document.getElementById("galleryInput").onchange = (e) => {
  processPrescriptionImage(e.target.files[0]);
  e.target.value = "";
};

// ==================== REAL NOTIFICATIONS, ALARM CHIME & VOICE ALERT ====================
function updateNotifButtonState() {
  const btn = document.getElementById("enableNotifBtn");
  if (!btn) return;
  if (!("Notification" in window)) {
    btn.classList.add("hidden");
    return;
  }
  if (Notification.permission === "granted") {
    btn.innerText = "🔔 Alerts Active";
  } else {
    btn.innerText = "🔔 Enable Alert";
  }
}

document.getElementById("enableNotifBtn").onclick = async () => {
  if (!("Notification" in window)) {
    return showToast("Browser notifications unsupported", true);
  }
  const res = await Notification.requestPermission();
  updateNotifButtonState();
  if (res === "granted") {
    showToast("Mobile Notifications Enabled!");
    sendSystemNotification("MediRemind AI", "Medicine reminders & alarms are now active!");
  } else {
    showToast("Please allow notifications in browser settings", true);
  }
};

function sendSystemNotification(title, bodyText) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => {
        reg.showNotification(title, {
          body: bodyText,
          icon: "logo.png",
          vibrate: [300, 150, 300, 150, 400],
          tag: "mediremind-dose"
        });
      })
      .catch(() => {
        new Notification(title, { body: bodyText, icon: "logo.png" });
      });
  } else {
    new Notification(title, { body: bodyText, icon: "logo.png" });
  }
}

function playAlarmTone() {
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate([300, 150, 300, 150, 400]);
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [587.33, 783.99, 1046.5, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.22);
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.22 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.22);
      osc.stop(ctx.currentTime + i * 0.22 + 0.21);
    });
  } catch (e) {}
}

function speakAlert(slotKey, medNames) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(
      `Medicine reminder! Time for your ${slotKey} medicine: ${medNames}`
    );
    utter.rate = 0.96;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function fireDoseAlarm(slotKey, medNamesStr) {
  playAlarmTone();
  speakAlert(slotKey, medNamesStr);
  sendSystemNotification(`💊 ${slotKey} Medicine Reminder`, `Time to take: ${medNamesStr}`);

  document.getElementById("alarmModalSlot").innerText = `⏰ ${slotKey.toUpperCase()} DOSE REMINDER`;
  document.getElementById("alarmModalMeds").innerText = medNamesStr;
  document.getElementById("alarmModal").classList.add("show");
}

document.getElementById("alarmDoneBtn").onclick = () => {
  document.getElementById("alarmModal").classList.remove("show");
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  showToast("Dose acknowledged!");
};

document.getElementById("testAlarmBtn").onclick = async () => {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission().catch(() => {});
    updateNotifButtonState();
  }
  const firstWithMeds = SLOTS.find((s) =>
    scheduleData.medicines.some((m) => m.slot === s.key)
  );
  const chosenSlot = firstWithMeds ? firstWithMeds.key : "Morning";
  const meds = scheduleData.medicines
    .filter((m) => m.slot === chosenSlot)
    .map((m) => m.name)
    .join(", ");

  fireDoseAlarm(chosenSlot, meds || "Paracetamol 500mg, Vitamin C");
};

function updateNextAlarmBanner() {
  const banner = document.getElementById("nextAlarmText");
  if (!banner) return;
  const now = new Date();
  const curHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const s of SLOTS) {
    const t = scheduleData.alarms[s.key] || s.defaultTime;
    if (t >= curHM) {
      banner.innerText = `Next Dose: ${s.key} at ${t}`;
      return;
    }
  }
  banner.innerText = `Next Dose: Tomorrow Morning at ${scheduleData.alarms.Morning || "08:30"}`;
}

function startAlarmClock() {
  if (alarmTimer) clearInterval(alarmTimer);
  updateNextAlarmBanner();

  alarmTimer = setInterval(() => {
    const now = new Date();
    const curHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const todayStr = getTodayDateStr();
    updateNextAlarmBanner();

    SLOTS.forEach((s) => {
      const targetTime = scheduleData.alarms[s.key] || s.defaultTime;
      const key = `${todayStr}_${s.key}_${targetTime}`;
      if (targetTime === curHM && !triggeredToday.has(key)) {
        triggeredToday.add(key);
        const pendingMeds = scheduleData.medicines
          .filter((m) => m.slot === s.key && m.takenDate !== todayStr)
          .map((m) => m.name)
          .join(", ");
        fireDoseAlarm(s.key, pendingMeds || `Scheduled ${s.key} Medicine`);
      }
    });
  }, 15000);
}

// ==================== SIMPLE AI MEDICINE ASSISTANT ====================
document.getElementById("aiAskBtn").onclick = async () => {
  const inp = document.getElementById("aiQuestionInput");
  const out = document.getElementById("aiAnswerBox");
  const q = inp.value.trim();
  if (!q) return;

  out.innerText = "✨ MediRemind AI is thinking...";
  out.classList.remove("hidden");

  const prompt = `You are MediRemind AI, a helpful medicine reminder assistant.
User's current medicine schedule: ${JSON.stringify(scheduleData)}
User question: "${q}"
Reply concisely in the same language (English, Bengali, or Hindi) in under 60 words.`;

  const { text, error } = await runGeminiAI({ parts: [{ text: prompt }] });
  if (text) {
    inp.value = "";
    out.innerText = `💊 ${text}`;
  } else {
    out.innerText = `⚠️ ${error || "Check your Gemini API Key in ⚙️ Settings."}`;
  }
};

// ==================== GEMINI API KEY MODAL ====================
document.getElementById("openKeyModalBtn").onclick = () => {
  document.getElementById("geminiKeyInput").value = localStorage.getItem("mediremind_custom_gemini_key") || "";
  document.getElementById("keyModal").classList.add("show");
};

document.getElementById("closeKeyModalBtn").onclick = () => {
  document.getElementById("keyModal").classList.remove("show");
};

document.getElementById("saveGeminiKeyBtn").onclick = () => {
  const val = document.getElementById("geminiKeyInput").value.trim();
  if (val) {
    localStorage.setItem("mediremind_custom_gemini_key", val);
    showToast("Gemini API Key Saved!");
  } else {
    localStorage.removeItem("mediremind_custom_gemini_key");
    showToast("Cleared custom key");
  }
  document.getElementById("keyModal").classList.remove("show");
};
