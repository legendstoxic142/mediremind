// app.js — MediRemind AI Pro Max Engine
import { auth, db, runGeminiAI } from "./firebase-config.js?v=10";
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

// ==================== HELPERS ====================
function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.innerText = msg;
  t.style.background = isError ? "#fb7185" : "#10b981";
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
  let safe = escapeHtml(rawText);
  // Convert markdown links [Label](https://...) to clickable links
  safe = safe.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Convert standalone raw URLs to clickable links
  safe = safe.replace(
    /(^|[\s(>])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">Open Link ↗</a>'
  );
  // Bold text **...**
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return safe.replace(/\n/g, "<br>");
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

// Custom Reusable Prompt Modal (Add Member / Rename Chat)
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

// ==================== 1. AUTHENTICATION ====================
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

document.getElementById("logoutBtn").onclick = async () => {
  if (unsubMainDoc) unsubMainDoc();
  await signOut(auth);
  showToast("Logged out");
};

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

  // Load cached state instantly
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

// ==================== 2. FAMILY MEMBERS & LIGHT COST CALCULATION ====================
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
  // Calculate daily estimated cost (if price is strip/pack price, count daily share or direct price)
  const totalUnitPrice = meds.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  // Estimate daily consumption cost (~1/10th of strip MRP per dose, or full if marked daily)
  const estDaily = Math.round(totalUnitPrice / 10);
  const estMonthly = estDaily * 30;

  document.getElementById("dailyCostLabel").innerText = `${appState.activeMember}'s Est. Daily`;
  document.getElementById("dailyCostVal").innerText = `₹${estDaily}`;
  document.getElementById("monthlyCostVal").innerText = `₹${estMonthly}`;
}

// AI Web Price Updater
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

// ==================== 4. VOICE MIC, CAMERA SCAN, UPLOAD & MANUAL ADD ====================
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

// Elderly Voice Microphone Recognition (Bengali, Hindi & English)
let recognitionInstance = null;
let isListening = false;

document.getElementById("voiceMicBtn").onclick = () => {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    return showToast("Voice input not supported in this browser. Type in the box below.", true);
  }

  const micBtn = document.getElementById("voiceMicBtn");
  const micLbl = document.getElementById("voiceMicLabel");
  const statusEl = document.getElementById("aiScanStatus");

  if (isListening && recognitionInstance) {
    recognitionInstance.stop();
    return;
  }

  recognitionInstance = new SpeechRec();
  recognitionInstance.lang = "bn-IN";
  recognitionInstance.interimResults = false;
  recognitionInstance.maxAlternatives = 1;

  recognitionInstance.onstart = () => {
    isListening = true;
    micBtn.classList.add("mic-recording");
    micLbl.innerText = "Listening...";
    statusEl.innerText = "🎤 Speak medicine name & time (e.g. 'Morning and Night Paracetamol 500')...";
    statusEl.classList.remove("hidden");
  };

  recognitionInstance.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    if (transcript) {
      document.getElementById("aiTextEntryInput").value = transcript;
      statusEl.innerText = `🗣️ Heard: "${transcript}" — Scheduling now...`;
      document.getElementById("aiTextAddBtn").click();
    }
  };

  recognitionInstance.onerror = (event) => {
    statusEl.innerText = `⚠️ Voice error (${event.error}). Try speaking clearly or type below.`;
  };

  recognitionInstance.onend = () => {
    isListening = false;
    micBtn.classList.remove("mic-recording");
    micLbl.innerText = "Speak Medicine";
  };

  recognitionInstance.start();
};

// AI Natural Language Add (from Voice or Text)
document.getElementById("aiTextAddBtn").onclick = async () => {
  const inp = document.getElementById("aiTextEntryInput");
  const statusEl = document.getElementById("aiScanStatus");
  const text = inp.value.trim();
  if (!text) return;

  statusEl.innerText = "✨ AI is scheduling medicines & estimating prices...";
  statusEl.classList.remove("hidden");

  const prompt = `Extract medicines, dose slots, and approximate Indian pharmacy strip MRP (in INR) from this voice/text input (may be in English, Bengali, or Hindi): "${text}".
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

// Manual Quick Add
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

// Camera & Gallery Prescription Scan
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

// ==================== 5. PERSISTENT AI HEALTH CHAT (HISTORY, RENAME, DELETE, MAPS & BUY LINKS) ====================
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
        text: "💊 Hi! I'm **MediRemind AI**. Ask me for:\n• **Nearest Medical Stores** (Google Maps)\n• **Direct Online Medicine Links** (Apollo Pharmacy, Tata 1mg, Flipkart Health+, PharmEasy)\n• **Medicine Dosage & Prices** in English, Bengali, or Hindi!"
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

// Drawer Controls
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

// Nearest Medical Store Button (Uses GPS if allowed + Google Maps + Gemini Search)
document.getElementById("findStoreChip").onclick = () => {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        sendAiChatMessage(
          `Find the nearest open medical stores and pharmacies around coordinates (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) and give a direct Google Maps link: https://www.google.com/maps/search/medical+store+pharmacy/@${latitude},${longitude},15z`
        );
      },
      () => {
        sendAiChatMessage(
          "Find the nearest open medical stores and pharmacies near me and include a direct Google Maps link: https://www.google.com/maps/search/medical+store+pharmacy+near+me"
        );
      },
      { timeout: 4000 }
    );
  } else {
    sendAiChatMessage(
      "Find the nearest open medical stores and pharmacies near me with a Google Maps link: https://www.google.com/maps/search/medical+store+pharmacy+near+me"
    );
  }
};

async function sendAiChatMessage(userText) {
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

  const box = document.getElementById("aiChatMessages");
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "bubble ai";
  loadingDiv.innerText = "✨ Searching schedules, pharmacies & online medicine links...";
  box.appendChild(loadingDiv);
  box.scrollTop = box.scrollHeight;

  const systemInstruction = `You are MediRemind AI Pro Max, an advanced medical reminder, pharmacy locator, and online medicine link assistant.
Family Profiles & Live Medicine Data: ${JSON.stringify(appState)}
Active Member: ${appState.activeMember}

RULES:
1. Reply in the exact language the user asked (English, Bengali, or Hindi).
2. Whenever the user asks to buy a medicine or asks about online stores, ALWAYS provide direct clickable markdown links for Indian online pharmacies using these exact URL patterns (replace MEDICINE with URL-encoded medicine name):
   - [Buy on Apollo Pharmacy](https://www.apollopharmacy.in/search-medicines/MEDICINE)
   - [Buy on Tata 1mg](https://www.1mg.com/search/all?name=MEDICINE)
   - [Buy on Flipkart Health+](https://healthplus.flipkart.com/search?q=MEDICINE)
   - [Buy on PharmEasy](https://pharmeasy.in/search/all?name=MEDICINE)
   - [Buy on Netmeds](https://www.netmeds.com/catalogsearch/result?q=MEDICINE)
3. Whenever the user asks for the nearest medical store or pharmacy, provide real nearby pharmacy names if known and ALWAYS include a clickable Google Maps link like [Open Nearest Medical Stores in Google Maps](https://www.google.com/maps/search/medical+store+pharmacy+near+me).
4. Keep answers clear, well-structured with bullet points, and include estimated ₹ prices where helpful.`;

  const historyPayload = session.messages.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }]
  }));

  const { text, error } = await runGeminiAI({
    contents: [{ role: "user", parts: [{ text: systemInstruction }] }, ...historyPayload],
    useSearch: true
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
  try {
    if ("vibrate" in navigator) navigator.vibrate([300, 150, 300, 150, 400]);
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

// Background Alarm Checker across ALL Family Members
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

// API Key Modal
document.getElementById("openKeyModalBtn").onclick = () => {
  document.getElementById("geminiKeyInput").value = localStorage.getItem("mediremind_gemini_key") || "";
  document.getElementById("keyModal").classList.add("show");
};
document.getElementById("closeKeyModalBtn").onclick = () => document.getElementById("keyModal").classList.remove("show");

document.getElementById("saveGeminiKeyBtn").onclick = () => {
  const val = document.getElementById("geminiKeyInput").value.trim();
  if (val) {
    localStorage.setItem("mediremind_gemini_key", val);
    showToast("Custom Gemini API Key Saved!");
  } else {
    localStorage.removeItem("mediremind_gemini_key");
    showToast("Using built-in Gemini API Key");
  }
  document.getElementById("keyModal").classList.remove("show");
};
