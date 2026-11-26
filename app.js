// app.js — MediRemind AI Pro Max Engine (Themes, Language, Voice Mic, Pharmacy Links & Cloud Sync)
import { auth, db, runGeminiAI } from "./firebase-config.js?v=12";
import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SLOTS = [
  { key: "Morning", icon: "🌅", defaultTime: "08:30" },
  { key: "Noon", icon: "☀️", defaultTime: "13:30" },
  { key: "Afternoon", icon: "🌤️", defaultTime: "17:30" },
  { key: "Night", icon: "🌙", defaultTime: "21:30" }
];

let currentUser = null;
let isSignUpMode = true;
let unsubMainDoc = null;
let triggeredToday = new Set();

// User Pro Preferences
let userPrefs = {
  theme: "emerald",
  language: "auto",
  alarmMode: "both",
  budgetLimit: 3000
};

try {
  const savedPrefs = JSON.parse(localStorage.getItem("mediremind_pro_prefs") || "null");
  if (savedPrefs) userPrefs = { ...userPrefs, ...savedPrefs };
} catch (e) {}

// Multi-Member & Medicine State
let appState = {
  members: ["Me"],
  activeMember: "Me",
  profiles: {
    Me: {
      alarms: { Morning: "08:30", Noon: "13:30", Afternoon: "17:30", Night: "21:30" },
      medicines: []
    }
  }
};

// Persistent AI Chat History State
let chatSessions = [];
let activeChatId = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ==================== THEME & PREFERENCES ENGINE ====================
function applyVisualTheme(themeName) {
  document.body.classList.remove("theme-ocean", "theme-violet", "theme-light");
  if (themeName === "ocean") document.body.classList.add("theme-ocean");
  else if (themeName === "violet") document.body.classList.add("theme-violet");
  else if (themeName === "light") document.body.classList.add("theme-light");

  document.querySelectorAll(".theme-opt").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === themeName);
  });
}

applyVisualTheme(userPrefs.theme);

// ==================== HELPERS ====================
function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.innerText = msg;
  t.style.background = isError ? "#fb7185" : "var(--primary)";
  t.style.display = "block";
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.style.display = "none";
  }, 2700);
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

function formatRichMessageHtml(rawText) {
  const linkPlaceholders = [];
  let textWithTokens = String(rawText || "").replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => {
      const idx = linkPlaceholders.length;
      linkPlaceholders.push(
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`
      );
      return `@@LINK_${idx}@@`;
    }
  );

  textWithTokens = textWithTokens.replace(
    /(^|[\s(>])(https?:\/\/[^\s<)]+)/g,
    (_, prefix, url) => {
      const idx = linkPlaceholders.length;
      linkPlaceholders.push(
        `<a href="${url}" target="_blank" rel="noopener noreferrer">Open Link ↗</a>`
      );
      return `${prefix}@@LINK_${idx}@@`;
    }
  );

  let safe = escapeHtml(textWithTokens);
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\n/g, "<br>");

  linkPlaceholders.forEach((anchorHtml, idx) => {
    safe = safe.replace(`@@LINK_${idx}@@`, anchorHtml);
  });

  return safe;
}

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getActiveProfile() {
  const m = appState.activeMember || appState.members[0] || "Me";
  if (!appState.profiles[m]) {
    appState.profiles[m] = {
      alarms: { Morning: "08:30", Noon: "13:30", Afternoon: "17:30", Night: "21:30" },
      medicines: []
    };
  }
  return appState.profiles[m];
}

function buildPharmacyLinksBlock(medNames) {
  return medNames
    .map((med) => {
      const q = encodeURIComponent(med);
      return (
        `💊 **${med}**\n` +
        `• [Apollo Pharmacy](https://www.apollopharmacy.in/search-medicines/${q})\n` +
        `• [Tata 1mg](https://www.1mg.com/search/all?name=${q})\n` +
        `• [Flipkart Health+](https://healthplus.flipkart.com/search?q=${q})\n` +
        `• [PharmEasy](https://pharmeasy.in/search/all?name=${q})\n` +
        `• [Netmeds](https://www.netmeds.com/catalogsearch/result?q=${q})`
      );
    })
    .join("\n\n");
}

function openInputPrompt({ title, desc, placeholder = "", defaultValue = "", confirmText = "Save" }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("promptModal");
    const titleEl = document.getElementById("promptModalTitle");
    const descEl = document.getElementById("promptModalDesc");
    const inpEl = document.getElementById("promptModalInput");
    const okBtn = document.getElementById("promptConfirmBtn");
    const cancelBtn = document.getElementById("promptCancelBtn");

    titleEl.innerText = title;
    descEl.innerText = desc;
    inpEl.placeholder = placeholder;
    inpEl.value = defaultValue;
    okBtn.innerText = confirmText;

    modal.classList.add("show");
    setTimeout(() => inpEl.focus(), 60);

    const cleanup = (val) => {
      modal.classList.remove("show");
      resolve(val);
    };

    cancelBtn.onclick = () => cleanup(null);
    okBtn.onclick = () => cleanup(inpEl.value.trim());
    inpEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(inpEl.value.trim());
      }
    };
  });
}

// ==================== 1. AUTHENTICATION & LOGOUT ====================
document.getElementById("toggleAuthModeBtn").onclick = () => {
  isSignUpMode = !isSignUpMode;
  document.getElementById("authNameInput").classList.toggle("hidden", !isSignUpMode);
  document.getElementById("authSubmitBtn").innerText = isSignUpMode ? "Create Account / Sign In →" : "Sign In →";
  document.getElementById("toggleAuthModeBtn").innerText = isSignUpMode
    ? "Already have an account? Switch to Sign In"
    : "New user? Switch to Create Account";
};

document.getElementById("googleLoginBtn").onclick = async () => {
  const errEl = document.getElementById("authErrorMsg");
  errEl.classList.add("hidden");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    errEl.innerText = err.message || "Google sign-in failed.";
    errEl.classList.remove("hidden");
  }
};

document.getElementById("emailAuthForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = document.getElementById("authNameInput").value.trim();
  const email = document.getElementById("authEmailInput").value.trim();
  const pass = document.getElementById("authPassInput").value;
  const errEl = document.getElementById("authErrorMsg");
  errEl.classList.add("hidden");

  try {
    if (isSignUpMode) {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if (name) await updateProfile(cred.user, { displayName: name });
      showToast("Account created!");
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
      showToast("Signed in!");
    }
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      try {
        await signInWithEmailAndPassword(auth, email, pass);
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

async function handleSignOut() {
  if (unsubMainDoc) unsubMainDoc();
  document.getElementById("settingsModal").classList.remove("show");
  await signOut(auth);
  showToast("Logged out successfully");
}

const topLogoutBtn = document.getElementById("topLogoutBtn");
if (topLogoutBtn) topLogoutBtn.onclick = handleSignOut;

const modalLogoutBtn = document.getElementById("logoutBtn");
if (modalLogoutBtn) modalLogoutBtn.onclick = handleSignOut;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!user) {
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("dashboardContainer").classList.add("hidden");
    return;
  }

  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("dashboardContainer").classList.remove("hidden");

  const displayName = user.displayName || user.email.split("@")[0];
  document.getElementById("userSubtitle").dataset.userName = displayName;

  try {
    const cached = JSON.parse(localStorage.getItem(`mediremind_promax_${user.uid}`) || "null");
    if (cached && Array.isArray(cached.members) && cached.profiles) {
      appState = cached;
    }
  } catch (e) {}

  renderAllUI();
  updateNotifBtn();
  loadChatSessions();

  if (unsubMainDoc) unsubMainDoc();
  unsubMainDoc = onSnapshot(doc(db, "users", user.uid, "proMaxData", "state"), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      if (Array.isArray(d.members) && d.profiles) {
        appState = d;
        localStorage.setItem(`mediremind_promax_${user.uid}`, JSON.stringify(appState));
        renderAllUI();
      }
    } else {
      saveAppState();
    }
  });
});

async function saveAppState() {
  if (!currentUser) return;
  localStorage.setItem(`mediremind_promax_${currentUser.uid}`, JSON.stringify(appState));
  try {
    await setDoc(doc(db, "users", currentUser.uid, "proMaxData", "state"), appState, { merge: true });
  } catch (e) {}
}

// ==================== 2. FAMILY MEMBERS & LIGHT COST / BUDGET ====================
function renderMemberPills() {
  const wrap = document.getElementById("memberPillsWrap");
  wrap.innerHTML = "";

  appState.members.forEach((member) => {
    const isActive = member === appState.activeMember;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `m-pill ${isActive ? "active" : ""}`;
    pill.innerHTML = `
      <span>👤 ${escapeHtml(member)}</span>
      ${appState.members.length > 1 ? `<span class="del-m" title="Remove Member">✕</span>` : ""}
    `;

    pill.onclick = async (e) => {
      if (e.target.classList.contains("del-m")) {
        e.stopPropagation();
        appState.members = appState.members.filter((m) => m !== member);
        delete appState.profiles[member];
        if (appState.activeMember === member) {
          appState.activeMember = appState.members[0] || "Me";
        }
        renderAllUI();
        await saveAppState();
        showToast(`Removed ${member}`);
        return;
      }
      appState.activeMember = member;
      renderAllUI();
      await saveAppState();
    };

    wrap.appendChild(pill);
  });

  document.getElementById("activeMemberBadge").innerText = `For: ${appState.activeMember}`;
}

document.getElementById("addMemberBtn").onclick = async () => {
  const name = await openInputPrompt({
    title: "Add Family Member",
    desc: "Enter family member name (e.g. Baba, Dadu, Maa):",
    placeholder: "e.g. Baba",
    confirmText: "Add Member"
  });
  if (!name) return;
  if (appState.members.some((m) => m.toLowerCase() === name.toLowerCase())) {
    return showToast("Member already exists", true);
  }
  appState.members.push(name);
  appState.profiles[name] = {
    alarms: { Morning: "08:30", Noon: "13:30", Afternoon: "17:30", Night: "21:30" },
    medicines: []
  };
  appState.activeMember = name;
  renderAllUI();
  await saveAppState();
  showToast(`Added ${name}`);
};

function updateLightCostSummary() {
  const profile = getActiveProfile();
  const meds = profile.medicines || [];
  const totalUnitPrice = meds.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const estDaily = Math.round(totalUnitPrice / 10);
  const estMonthly = estDaily * 30;
  const limit = Number(userPrefs.budgetLimit) || 3000;

  document.getElementById("dailyCostLabel").innerText = `${appState.activeMember}'s Est. Daily`;
  document.getElementById("dailyCostVal").innerText = `₹${estDaily}`;
  document.getElementById("monthlyCostVal").innerText = `₹${estMonthly} / ₹${limit}`;

  const fillBar = document.getElementById("budgetFillBar");
  if (fillBar) {
    const pct = Math.min((estMonthly / limit) * 100, 100);
    fillBar.style.width = `${pct}%`;
    fillBar.style.background = pct > 90 ? "var(--rose)" : "linear-gradient(90deg, var(--cyan), var(--primary))";
  }
}

document.getElementById("updateWebPricesBtn").onclick = async () => {
  const profile = getActiveProfile();
  const meds = profile.medicines || [];
  if (meds.length === 0) {
    return showToast("Add some medicines first to fetch prices", true);
  }

  const btn = document.getElementById("updateWebPricesBtn");
  const statusEl = document.getElementById("aiScanStatus");
  btn.disabled = true;
  btn.innerText = "🌐 Fetching MRP...";
  statusEl.innerText = "🌐 Searching current Indian pharmacy MRP prices (Tata 1mg / Apollo)...";
  statusEl.classList.remove("hidden");

  const uniqueNames = Array.from(new Set(meds.map((m) => m.name)));
  const prompt = `Find the current approximate Indian pharmacy MRP price in INR (₹) for 1 strip/bottle of each of these medicines: ${JSON.stringify(uniqueNames)}.
Return ONLY valid JSON with medicine names as keys and numeric INR prices as values:
{"prices": {"Paracetamol 500mg": 30}}`;

  const { text, error } = await runGeminiAI({
    parts: [{ text: prompt }],
    jsonMode: true,
    useSearch: true
  });

  btn.disabled = false;
  btn.innerText = "🌐 Update Web Prices";

  if (!text) {
    statusEl.innerText = `⚠️ ${error || "Could not fetch web prices right now."}`;
    return;
  }

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    const priceMap = parsed?.prices || {};

    let updatedCount = 0;
    profile.medicines = meds.map((m) => {
      const foundKey = Object.keys(priceMap).find(
        (k) => k.toLowerCase().includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(k.toLowerCase())
      );
      if (foundKey && Number(priceMap[foundKey]) > 0) {
        updatedCount++;
        return { ...m, price: Number(priceMap[foundKey]) };
      }
      return m;
    });

    renderAllUI();
    await saveAppState();
    statusEl.innerText =
      updatedCount > 0
        ? `✅ Updated live market MRP (₹) for ${updatedCount} medicine(s)!`
        : "⚠️ Could not match exact prices. You can also enter price manually.";
  } catch (e) {
    statusEl.innerText = "⚠️ Failed to parse price response.";
  }
};

// ==================== 3. RENDER 4 DOSE CARDS ====================
function renderScheduleGrid() {
  const grid = document.getElementById("scheduleGrid");
  grid.innerHTML = "";
  const profile = getActiveProfile();
  const todayStr = getTodayDateStr();

  SLOTS.forEach((slot) => {
    const alarmVal = profile.alarms[slot.key] || slot.defaultTime;
    const slotMeds = (profile.medicines || []).filter((m) => m.slot === slot.key);

    const card = document.createElement("div");
    card.className = "slot-card";

    const medsHtml =
      slotMeds.length === 0
        ? `<p style="font-size:12px; color:var(--muted); padding:8px 2px;">No medicines scheduled.</p>`
        : slotMeds
            .map((med) => {
              const isTaken = med.takenDate === todayStr;
              const priceHtml = Number(med.price) > 0 ? `<span class="price-pill">₹${med.price}/pack</span>` : "";
              const buyUrl = `https://www.1mg.com/search/all?name=${encodeURIComponent(med.name)}`;
              return `
                <div class="med-item ${isTaken ? "taken" : ""}">
                  <div style="min-width:0; flex:1;">
                    <div class="med-title">${escapeHtml(med.name)}</div>
                    <div class="med-meta">
                      <span style="font-size:11px; color:var(--muted);">${isTaken ? "✅ Taken" : `⏰ ${alarmVal}`}</span>
                      ${priceHtml}
                      <a href="${buyUrl}" target="_blank" rel="noopener noreferrer" class="buy-mini-link">🛒 Buy</a>
                    </div>
                  </div>
                  <div style="display:flex; gap:5px; flex-shrink:0;">
                    <button type="button" class="btn ${isTaken ? "btn-ghost" : "btn-primary"}" style="padding:6px 9px; font-size:11px;" data-toggle-id="${med.id}">
                      ${isTaken ? "Undo" : "✓ Taken"}
                    </button>
                    <button type="button" class="btn btn-danger" style="padding:6px 8px; font-size:11px;" data-del-id="${med.id}">✕</button>
                  </div>
                </div>
              `;
            })
            .join("");

    card.innerHTML = `
      <div class="slot-top">
        <span class="slot-name">${slot.icon} ${slot.key}</span>
        <input type="time" class="time-box" data-slot-time="${slot.key}" value="${escapeHtml(alarmVal)}" />
      </div>
      <div>${medsHtml}</div>
    `;

    card.querySelector("[data-slot-time]").onchange = async (e) => {
      if (!e.target.value) return;
      profile.alarms[slot.key] = e.target.value;
      renderAllUI();
      await saveAppState();
      showToast(`${appState.activeMember}'s ${slot.key} alarm set to ${e.target.value}`);
    };

    card.querySelectorAll("[data-toggle-id]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.toggleId;
        profile.medicines = profile.medicines.map((m) =>
          m.id === id ? { ...m, takenDate: m.takenDate === todayStr ? "" : todayStr } : m
        );
        renderAllUI();
        await saveAppState();
      };
    });

    card.querySelectorAll("[data-del-id]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delId;
        profile.medicines = profile.medicines.filter((m) => m.id !== id);
        renderAllUI();
        await saveAppState();
        showToast("Medicine removed");
      };
    });

    grid.appendChild(card);
  });

  updateNextAlarmBanner();
}

function renderAllUI() {
  renderMemberPills();
  updateLightCostSummary();
  renderScheduleGrid();
}

// ==================== 4. DIRECT AUDIO MIC (GEMINI VOICE AI), CAMERA SCAN & ADD ====================
function addMedicinesToActiveProfile(list) {
  const profile = getActiveProfile();
  let added = 0;
  const labels = [];

  list.forEach((item) => {
    const mName = String(item.name || "").trim();
    const slot = SLOTS.some((s) => s.key === item.slot) ? item.slot : "Morning";
    const price = Number(item.price) || 0;

    if (
      mName &&
      !profile.medicines.some((m) => m.name.toLowerCase() === mName.toLowerCase() && m.slot === slot)
    ) {
      profile.medicines.push({
        id: `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: mName,
        slot,
        price,
        takenDate: ""
      });
      labels.push(`${mName} (${slot})`);
      added++;
    }
  });

  return { added, labels };
}

let mediaRecorder = null;
let audioChunks = [];
let isRecordingAudio = false;
let autoStopTimer = null;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result || "";
      resolve(String(dataUrl).split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

document.getElementById("voiceMicBtn").onclick = async () => {
  const micBtn = document.getElementById("voiceMicBtn");
  const micLbl = document.getElementById("voiceMicLabel");
  const statusEl = document.getElementById("aiScanStatus");

  if (isRecordingAudio && mediaRecorder && mediaRecorder.state === "recording") {
    clearTimeout(autoStopTimer);
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return showToast("Microphone access not available in this browser", true);
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";

    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      isRecordingAudio = false;
      micBtn.classList.remove("mic-recording");
      micLbl.innerText = "Speak Medicine";
      stream.getTracks().forEach((track) => track.stop());

      if (audioChunks.length === 0) return;

      statusEl.innerText = "✨ AI is listening to your voice & scheduling medicines...";
      statusEl.classList.remove("hidden");

      try {
        const finalMime = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunks, { type: finalMime });
        const base64Audio = await blobToBase64(audioBlob);

        const prompt = `Listen carefully to this voice recording (which may be in Bengali, Hindi, or English).
The user is speaking medicine name(s) and when to take them.
Extract the spoken transcript, the medicines, their dose slots from ["Morning", "Noon", "Afternoon", "Night"], and approximate Indian pharmacy strip MRP in INR ("price").
If a medicine is taken multiple times (e.g. morning and night, or sokal-rat), create separate items for each slot.
Return ONLY valid JSON:
{"transcript": "what the user said", "medicines": [{"name": "Medicine Name", "slot": "Morning", "price": 30}]}`;

        const { text: reply, error } = await runGeminiAI({
          parts: [
            { text: prompt },
            { inline_data: { mime_type: finalMime.split(";")[0], data: base64Audio } }
          ],
          jsonMode: true
        });

        if (!reply) {
          statusEl.innerText = `⚠️ ${error || "Could not process voice audio."}`;
          return;
        }

        const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)[0]);
        if (parsed.transcript) {
          document.getElementById("aiTextEntryInput").value = parsed.transcript;
        }

        const { added, labels } = addMedicinesToActiveProfile(parsed.medicines || []);
        renderAllUI();
        await saveAppState();

        statusEl.innerText =
          added > 0
            ? `✅ Heard "${parsed.transcript || "Voice"}" → Scheduled: ${labels.join(", ")}`
            : `🗣️ Heard "${parsed.transcript || "Voice"}" (Already scheduled or no medicine name detected)`;
      } catch (err) {
        statusEl.innerText = `⚠️ Voice processing failed: ${err.message}`;
      }
    };

    mediaRecorder.start();
    isRecordingAudio = true;
    micBtn.classList.add("mic-recording");
    micLbl.innerText = "Tap to Stop";
    statusEl.innerText = "🔴 Listening... Speak medicine name & time (e.g. 'Paracetamol morning and night'), then tap Stop.";
    statusEl.classList.remove("hidden");

    autoStopTimer = setTimeout(() => {
      if (isRecordingAudio && mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, 9000);
  } catch (err) {
    statusEl.innerText = "⚠️ Microphone permission denied. Please allow mic access in browser.";
    statusEl.classList.remove("hidden");
  }
};

document.getElementById("aiTextAddBtn").onclick = async () => {
  const inp = document.getElementById("aiTextEntryInput");
  const statusEl = document.getElementById("aiScanStatus");
  const text = inp.value.trim();
  if (!text) return;

  statusEl.innerText = "✨ AI is scheduling medicines & estimating prices...";
  statusEl.classList.remove("hidden");

  const prompt = `Extract medicines, dose slots, and approximate Indian pharmacy strip MRP (in INR) from this text (English, Bengali, or Hindi): "${text}".
Allowed slots: ["Morning", "Noon", "Afternoon", "Night"].
If a medicine is taken at multiple times (e.g. morning and night, or 1-0-1), create separate items for each slot.
Return ONLY valid JSON: {"medicines": [{"name": "Medicine Name", "slot": "Morning", "price": 30}]}`;

  const { text: reply, error } = await runGeminiAI({ parts: [{ text: prompt }], jsonMode: true });
  if (!reply) {
    statusEl.innerText = `⚠️ ${error}`;
    return;
  }

  try {
    const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)[0]);
    const { added, labels } = addMedicinesToActiveProfile(parsed.medicines || []);
    inp.value = "";
    renderAllUI();
    await saveAppState();
    statusEl.innerText =
      added > 0
        ? `✅ Scheduled for ${appState.activeMember}: ${labels.join(", ")}`
        : "✅ Already in schedule.";
  } catch (e) {
    statusEl.innerText = "⚠️ Could not understand medicine details. Try again.";
  }
};

document.getElementById("quickAddBtn").onclick = async () => {
  const nameInp = document.getElementById("medNameInput");
  const priceInp = document.getElementById("medPriceInput");
  const slotSel = document.getElementById("medSlotSelect");

  const name = nameInp.value.trim();
  const price = Number(priceInp.value) || 0;
  const slot = slotSel.value;

  if (!name) return showToast("Enter a medicine name", true);

  addMedicinesToActiveProfile([{ name, slot, price }]);
  nameInp.value = "";
  priceInp.value = "";
  renderAllUI();
  await saveAppState();
  showToast(`Added ${name} to ${appState.activeMember}'s ${slot}`);
};

document.getElementById("scanCameraBtn").onclick = () => document.getElementById("cameraInput").click();
document.getElementById("uploadGalleryBtn").onclick = () => document.getElementById("galleryInput").click();

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > 960 || height > 960) {
          const r = 960 / Math.max(width, height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        const url = c.toDataURL("image/jpeg", 0.84);
        resolve({ base64: url.split(",")[1], mime: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handlePrescriptionImage(file) {
  if (!file) return;
  const statusEl = document.getElementById("aiScanStatus");
  statusEl.innerText = "📷 Scanning prescription & estimating prices with MediRemind AI...";
  statusEl.classList.remove("hidden");

  try {
    const imgData = await compressImage(file);
    const prompt = `Read this doctor prescription, medicine strip, or pharmacy bill.
Extract each medicine name (with dosage if shown, e.g. "Paracetamol 500mg"), its approximate Indian pharmacy MRP in INR ("price"), and assign it to time slots from ["Morning", "Noon", "Afternoon", "Night"].
If frequency is 1-0-1, add one entry for "Morning" and one for "Night". If 1-1-1, add "Morning", "Noon", and "Night". Default to "Morning" if unspecified.
Return ONLY valid JSON: {"medicines": [{"name": "Medicine Name", "slot": "Morning", "price": 30}]}`;

    const { text: reply, error } = await runGeminiAI({
      parts: [
        { text: prompt },
        { inline_data: { mime_type: imgData.mime, data: imgData.base64 } }
      ],
      jsonMode: true
    });

    if (!reply) {
      statusEl.innerText = `⚠️ ${error}`;
      return;
    }

    const parsed = JSON.parse(reply.match(/\{[\s\S]*\}/)[0]);
    const list = Array.isArray(parsed?.medicines) ? parsed.medicines : [];
    if (list.length === 0) {
      statusEl.innerText = "⚠️ No medicines detected. Try a clearer photo.";
      return;
    }

    const { added, labels } = addMedicinesToActiveProfile(list);
    renderAllUI();
    await saveAppState();
    statusEl.innerText =
      added > 0
        ? `✅ Scheduled ${added} dose(s) for ${appState.activeMember}: ${labels.join(", ")}`
        : "✅ Medicines from this prescription are already scheduled.";
  } catch (err) {
    statusEl.innerText = `⚠️ Scan failed: ${err.message}`;
  }
}

document.getElementById("cameraInput").onchange = (e) => {
  handlePrescriptionImage(e.target.files[0]);
  e.target.value = "";
};
document.getElementById("galleryInput").onchange = (e) => {
  handlePrescriptionImage(e.target.files[0]);
  e.target.value = "";
};

// ==================== 5. PERSISTENT AI HEALTH CHAT ====================
function getChatStorageKey() {
  return `mediremind_promax_chats_${currentUser?.uid || "guest"}`;
}

function saveChatsLocal() {
  localStorage.setItem(getChatStorageKey(), JSON.stringify(chatSessions));
}

async function syncChatCloud(session) {
  if (!currentUser || !session) return;
  try {
    await setDoc(
      doc(db, "users", currentUser.uid, "proMaxChats", session.id),
      {
        title: session.title,
        messages: session.messages,
        updatedAt: session.updatedAt
      },
      { merge: true }
    );
  } catch (e) {}
}

async function loadChatSessions() {
  try {
    const cached = JSON.parse(localStorage.getItem(getChatStorageKey()) || "[]");
    if (Array.isArray(cached) && cached.length > 0) {
      chatSessions = cached;
      activeChatId = chatSessions[0].id;
      renderActiveChat();
      renderChatHistory();
    }
  } catch (e) {}

  if (!currentUser) return;
  try {
    const snap = await getDocs(
      query(collection(db, "users", currentUser.uid, "proMaxChats"), orderBy("updatedAt", "desc"))
    );
    if (!snap.empty) {
      chatSessions = [];
      snap.forEach((d) => chatSessions.push({ id: d.id, ...d.data() }));
      saveChatsLocal();
      if (!activeChatId || !chatSessions.some((c) => c.id === activeChatId)) {
        activeChatId = chatSessions[0].id;
      }
      renderActiveChat();
      renderChatHistory();
    } else if (chatSessions.length === 0) {
      createNewChat(false);
    }
  } catch (e) {
    if (chatSessions.length === 0) createNewChat(false);
  }
}

function getActiveChat() {
  let c = chatSessions.find((x) => x.id === activeChatId);
  if (!c) c = createNewChat(false);
  return c;
}

function createNewChat(hideHistory = true) {
  const newSession = {
    id: `chat_${Date.now()}`,
    title: "New Health Chat",
    messages: [
      {
        role: "ai",
        text: "💊 Hi! I'm **MediRemind AI**. Ask me for:\n• **Nearest Medical Stores** (Google Maps)\n• **Direct Online Medicine Links** (Apollo Pharmacy, Tata 1mg, Flipkart Health+, PharmEasy, Netmeds)\n• **Medicine Dosage & Prices** in English, Bengali, or Hindi!"
      }
    ],
    updatedAt: Date.now()
  };
  chatSessions.unshift(newSession);
  activeChatId = newSession.id;
  saveChatsLocal();
  renderActiveChat();
  renderChatHistory();
  if (hideHistory) document.getElementById("chatHistoryPanel").classList.add("hidden");
  return newSession;
}

function renderActiveChat() {
  const session = getActiveChat();
  document.getElementById("activeChatTitle").innerText = session.title || "New Health Chat";
  const box = document.getElementById("aiChatMessages");
  box.innerHTML = "";
  (session.messages || []).forEach((m) => {
    const div = document.createElement("div");
    div.className = `bubble ${m.role}`;
    if (m.role === "ai") {
      div.innerHTML = formatRichMessageHtml(m.text);
    } else {
      div.innerText = m.text;
    }
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function renderChatHistory() {
  const listEl = document.getElementById("chatHistoryList");
  listEl.innerHTML = "";
  chatSessions.forEach((c) => {
    const row = document.createElement("div");
    row.className = `hist-row ${c.id === activeChatId ? "active" : ""}`;
    row.innerHTML = `
      <span class="hist-title">💬 ${escapeHtml(c.title || "Untitled")}</span>
      <div class="hist-btns">
        <button type="button" class="r-btn" title="Rename">✏️</button>
        <button type="button" class="d-btn" title="Delete" style="color:var(--rose);">🗑️</button>
      </div>
    `;
    row.querySelector(".hist-title").onclick = () => {
      activeChatId = c.id;
      renderActiveChat();
      renderChatHistory();
      document.getElementById("chatHistoryPanel").classList.add("hidden");
    };
    row.querySelector(".r-btn").onclick = (e) => {
      e.stopPropagation();
      renameChatById(c.id);
    };
    row.querySelector(".d-btn").onclick = (e) => {
      e.stopPropagation();
      deleteChatById(c.id);
    };
    listEl.appendChild(row);
  });
}

async function renameChatById(chatId) {
  const session = chatSessions.find((c) => c.id === chatId);
  if (!session) return;
  const updatedTitle = await openInputPrompt({
    title: "Rename Chat",
    desc: "Enter a new name for this conversation:",
    defaultValue: session.title,
    confirmText: "Rename"
  });
  if (updatedTitle) {
    session.title = updatedTitle;
    session.updatedAt = Date.now();
    saveChatsLocal();
    syncChatCloud(session);
    renderActiveChat();
    renderChatHistory();
    showToast("Chat renamed!");
  }
}

async function deleteChatById(chatId) {
  chatSessions = chatSessions.filter((c) => c.id !== chatId);
  saveChatsLocal();
  if (currentUser) {
    deleteDoc(doc(db, "users", currentUser.uid, "proMaxChats", chatId)).catch(() => {});
  }
  if (chatSessions.length === 0) {
    createNewChat(false);
  } else if (activeChatId === chatId) {
    activeChatId = chatSessions[0].id;
    renderActiveChat();
  }
  renderChatHistory();
  showToast("Chat deleted");
}

const aiDrawer = document.getElementById("aiDrawer");
const aiBackdrop = document.getElementById("aiBackdrop");

document.getElementById("openAiChatBtn").onclick = () => {
  aiBackdrop.classList.add("show");
  aiDrawer.classList.add("open");
  renderActiveChat();
  setTimeout(() => document.getElementById("aiChatInput").focus(), 150);
};
const closeDrawer = () => {
  aiBackdrop.classList.remove("show");
  aiDrawer.classList.remove("open");
};
document.getElementById("closeAiChatBtn").onclick = closeDrawer;
aiBackdrop.onclick = closeDrawer;

document.getElementById("toggleChatHistBtn").onclick = () => {
  document.getElementById("chatHistoryPanel").classList.toggle("hidden");
  renderChatHistory();
};
document.getElementById("newChatBtn").onclick = () => {
  createNewChat(true);
  showToast("Started new chat");
};
document.getElementById("renameChatBtn").onclick = () => renameChatById(activeChatId);
document.getElementById("deleteChatBtn").onclick = () => deleteChatById(activeChatId);

document.getElementById("findStoreChip").onclick = () => {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        sendAiChatMessage(
          `Find the nearest open medical stores and pharmacies around (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) and include this link: [Open Nearest Medical Stores in Google Maps](https://www.google.com/maps/search/medical+store+pharmacy/@${latitude},${longitude},15z)`,
          true
        );
      },
      () => {
        sendAiChatMessage(
          "Find the nearest open medical stores and pharmacies near me and include this link: [Open Nearest Medical Stores in Google Maps](https://www.google.com/maps/search/medical+store+pharmacy+near+me)",
          true
        );
      },
      { timeout: 4000 }
    );
  } else {
    sendAiChatMessage(
      "Find the nearest open medical stores and pharmacies near me and include this link: [Open Nearest Medical Stores in Google Maps](https://www.google.com/maps/search/medical+store+pharmacy+near+me)",
      true
    );
  }
};

async function sendAiChatMessage(userText, forceSearch = false) {
  const q = userText.trim();
  if (!q) return;

  const session = getActiveChat();
  if (session.title === "New Health Chat") {
    session.title = q.length > 28 ? q.slice(0, 28) + "..." : q;
  }

  session.messages.push({ role: "user", text: q });
  session.updatedAt = Date.now();
  saveChatsLocal();
  renderActiveChat();
  renderChatHistory();

  const lowerQ = q.toLowerCase();
  const isBuyRequest =
    lowerQ.includes("buy") ||
    lowerQ.includes("online") ||
    lowerQ.includes("apollo") ||
    lowerQ.includes("1mg") ||
    lowerQ.includes("flipkart") ||
    lowerQ.includes("pharmeasy") ||
    lowerQ.includes("order") ||
    lowerQ.includes("link");

  if (isBuyRequest && !forceSearch) {
    const profile = getActiveProfile();
    const scheduledMeds = Array.from(new Set((profile.medicines || []).map((m) => m.name)));

    if (scheduledMeds.length > 0) {
      const linksReply =
        `🛒 **Direct Online Purchase Links for ${appState.activeMember}'s Medicines:**\n\n` +
        buildPharmacyLinksBlock(scheduledMeds);
      session.messages.push({ role: "ai", text: linksReply });
      session.updatedAt = Date.now();
      saveChatsLocal();
      syncChatCloud(session);
      renderActiveChat();
      return;
    } else {
      const { text: extracted } = await runGeminiAI({
        parts: [
          {
            text: `Extract any medicine names mentioned in: "${q}". Return ONLY a JSON array of strings, e.g. ["Paracetamol 500mg"] or [] if none.`
          }
        ],
        jsonMode: true
      });
      let askedMeds = [];
      try {
        const arr = JSON.parse((extracted || "[]").match(/\[[\s\S]*\]/)[0]);
        if (Array.isArray(arr)) askedMeds = arr.filter(Boolean);
      } catch (e) {}

      if (askedMeds.length > 0) {
        const linksReply = `🛒 **Direct Online Purchase Links:**\n\n` + buildPharmacyLinksBlock(askedMeds);
        session.messages.push({ role: "ai", text: linksReply });
        session.updatedAt = Date.now();
        saveChatsLocal();
        syncChatCloud(session);
        renderActiveChat();
        return;
      } else {
        const emptyReply =
          `You haven't added any medicines to **${appState.activeMember}**'s schedule yet! Add a medicine on the dashboard, or type any medicine name here (e.g. **"Buy Dolo 650 online"**).\n\n` +
          `Here are quick links for common medicines:\n\n` +
          buildPharmacyLinksBlock(["Paracetamol 500mg", "Pantoprazole 40mg"]);
        session.messages.push({ role: "ai", text: emptyReply });
        session.updatedAt = Date.now();
        saveChatsLocal();
        syncChatCloud(session);
        renderActiveChat();
        return;
      }
    }
  }

  const box = document.getElementById("aiChatMessages");
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "bubble ai";
  loadingDiv.innerText = "✨ Searching schedules & pharmacies...";
  box.appendChild(loadingDiv);
  box.scrollTop = box.scrollHeight;

  const langRule =
    userPrefs.language === "auto"
      ? "Reply in the exact language the user asked (English, Bengali, or Hindi)."
      : `Reply primarily in ${userPrefs.language}.`;

  const systemInstruction = `You are MediRemind AI Pro Max, a medical reminder and pharmacy assistant.
Family Profiles & Live Medicine Data: ${JSON.stringify(appState)}
Active Member: ${appState.activeMember}

RULES:
1. ${langRule}
2. If the user asks for nearest medical stores, include a clickable markdown link [Open Nearest Medical Stores in Google Maps](https://www.google.com/maps/search/medical+store+pharmacy+near+me).
3. Keep answers concise, accurate, and complete.`;

  const historyPayload = session.messages.slice(-8).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }]
  }));

  const { text, error } = await runGeminiAI({
    contents: [{ role: "user", parts: [{ text: systemInstruction }] }, ...historyPayload],
    useSearch: forceSearch
  });

  const finalReply = text || `⚠️ ${error || "Could not connect to AI."}`;
  session.messages.push({ role: "ai", text: finalReply });
  session.updatedAt = Date.now();
  saveChatsLocal();
  syncChatCloud(session);
  renderActiveChat();
}

document.getElementById("aiChatForm").onsubmit = async (e) => {
  e.preventDefault();
  const inp = document.getElementById("aiChatInput");
  const val = inp.value;
  inp.value = "";
  await sendAiChatMessage(val);
};

document.querySelectorAll(".chip-btn[data-q]").forEach((btn) => {
  btn.onclick = () => sendAiChatMessage(btn.dataset.q);
});

// ==================== 6. NOTIFICATIONS, CHIME & VOICE ALARM ====================
function updateNotifBtn() {
  const btn = document.getElementById("enableNotifBtn");
  if (!("Notification" in window)) {
    btn.classList.add("hidden");
    return;
  }
  btn.innerText = Notification.permission === "granted" ? "🔔 Alerts On" : "🔔 Enable Alert";
}

function sendSystemNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((reg) =>
        reg.showNotification(title, {
          body,
          icon: "logo.png",
          vibrate: [300, 150, 300],
          tag: "med-alert"
        })
      )
      .catch(() => new Notification(title, { body, icon: "logo.png" }));
  } else {
    new Notification(title, { body, icon: "logo.png" });
  }
}

document.getElementById("enableNotifBtn").onclick = async () => {
  if (!("Notification" in window)) return showToast("Notifications not supported", true);
  const res = await Notification.requestPermission();
  updateNotifBtn();
  if (res === "granted") {
    showToast("Notifications Enabled!");
    sendSystemNotification("MediRemind AI", "Medicine reminders & alarms are active!");
  } else {
    showToast("Allow notifications in browser settings", true);
  }
};

function playChime() {
  if (userPrefs.alarmMode === "vibrate") return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [587.33, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.22);
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

function speakDose(memberName, slotKey, meds) {
  if (userPrefs.alarmMode !== "both") return;
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
      `Medicine reminder for ${memberName}! Time for ${slotKey} dose: ${meds}`
    );
    u.rate = 0.96;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function triggerDoseAlarm(memberName, slotKey, medsText) {
  if ("vibrate" in navigator) navigator.vibrate([300, 150, 300, 150, 400]);
  playChime();
  speakDose(memberName, slotKey, medsText);
  sendSystemNotification(`💊 ${memberName} — ${slotKey} Dose`, `Time to take: ${medsText}`);
  document.getElementById("alarmModalSlot").innerText = `⏰ ${memberName.toUpperCase()} • ${slotKey.toUpperCase()} DOSE`;
  document.getElementById("alarmModalMeds").innerText = medsText;
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
    updateNotifBtn();
  }
  const profile = getActiveProfile();
  const firstSlot = SLOTS.find((s) => (profile.medicines || []).some((m) => m.slot === s.key));
  const chosen = firstSlot ? firstSlot.key : "Morning";
  const meds = (profile.medicines || [])
    .filter((m) => m.slot === chosen)
    .map((m) => m.name)
    .join(", ");
  triggerDoseAlarm(appState.activeMember, chosen, meds || "Paracetamol 500mg, Vitamin C");
};

function updateNextAlarmBanner() {
  const subEl = document.getElementById("userSubtitle");
  const uName = subEl.dataset.userName || "User";
  const profile = getActiveProfile();
  const now = new Date();
  const curHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const s of SLOTS) {
    const t = profile.alarms[s.key] || s.defaultTime;
    if (t >= curHM) {
      subEl.innerText = `${uName} • ${appState.activeMember}'s Next Dose: ${s.key} (${t})`;
      return;
    }
  }
  subEl.innerText = `${uName} • ${appState.activeMember}'s Next: Tomorrow ${profile.alarms.Morning || "08:30"}`;
}

setInterval(() => {
  const now = new Date();
  const curHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const todayStr = getTodayDateStr();
  updateNextAlarmBanner();

  (appState.members || []).forEach((member) => {
    const profile = appState.profiles[member];
    if (!profile) return;
    SLOTS.forEach((s) => {
      const target = profile.alarms?.[s.key] || s.defaultTime;
      const key = `${todayStr}_${member}_${s.key}_${target}`;
      if (target === curHM && !triggeredToday.has(key)) {
        triggeredToday.add(key);
        const pending = (profile.medicines || [])
          .filter((m) => m.slot === s.key && m.takenDate !== todayStr)
          .map((m) => m.name)
          .join(", ");
        triggerDoseAlarm(member, s.key, pending || `Scheduled ${s.key} Medicine`);
      }
    });
  });
}, 10000);

// ==================== 7. PRO SETTINGS MODAL CONTROLS ====================
document.getElementById("openSettingsModalBtn").onclick = () => {
  applyVisualTheme(userPrefs.theme);
  document.getElementById("settingLangSelect").value = userPrefs.language || "auto";
  document.getElementById("settingAlarmModeSelect").value = userPrefs.alarmMode || "both";
  document.getElementById("settingBudgetInput").value = userPrefs.budgetLimit || 3000;
  document.getElementById("settingsModal").classList.add("show");
};

document.getElementById("closeSettingsBtn").onclick = () => {
  document.getElementById("settingsModal").classList.remove("show");
};

document.querySelectorAll(".theme-opt").forEach((btn) => {
  btn.onclick = () => {
    const selectedTheme = btn.dataset.theme;
    userPrefs.theme = selectedTheme;
    applyVisualTheme(selectedTheme);
  };
});

document.getElementById("saveProSettingsBtn").onclick = () => {
  userPrefs.language = document.getElementById("settingLangSelect").value;
  userPrefs.alarmMode = document.getElementById("settingAlarmModeSelect").value;
  userPrefs.budgetLimit = Number(document.getElementById("settingBudgetInput").value) || 3000;

  localStorage.setItem("mediremind_pro_prefs", JSON.stringify(userPrefs));
  updateLightCostSummary();
  document.getElementById("settingsModal").classList.remove("show");
  showToast("Pro Preferences Saved!");
};

document.getElementById("copyDoctorReportBtn").onclick = async () => {
  const profile = getActiveProfile();
  const meds = profile.medicines || [];
  if (meds.length === 0) return showToast("No medicines to copy", true);

  const lines = [`💊 MediRemind AI — ${appState.activeMember}'s Medicine Schedule`, ""];
  SLOTS.forEach((s) => {
    const list = meds.filter((m) => m.slot === s.key).map((m) => m.name);
    if (list.length > 0) {
      lines.push(`${s.key} (${profile.alarms[s.key] || s.defaultTime}): ${list.join(", ")}`);
    }
  });

  const reportText = lines.join("\n");
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(reportText);
    showToast("Medicine schedule copied to clipboard!");
  }
};

document.getElementById("resetTodayDosesBtn").onclick = async () => {
  const profile = getActiveProfile();
  profile.medicines = (profile.medicines || []).map((m) => ({ ...m, takenDate: "" }));
  renderAllUI();
  await saveAppState();
  document.getElementById("settingsModal").classList.remove("show");
  showToast("All doses reset for today!");
};
