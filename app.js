// app.js — MediRemind AI Engine (Smart Medicine Reminder, Alarm Sound + Voice + Browser Notification, Prescription Vision & Care Split)
import { auth, db, runGeminiAI } from "./firebase-config.js?v=1";
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==================== TEMPLATES & OPTIONS ====================
const DEFAULT_ALARM_TIMES = {
  Morning: "08:30",
  Noon: "13:30",
  Afternoon: "17:30",
  Night: "21:30"
};

const WORKSPACE_TEMPLATES = {
  daily: {
    slots: ["Morning", "Noon", "Afternoon", "Night"],
    alarms: { Morning: "08:30", Noon: "13:30", Afternoon: "17:30", Night: "21:30" },
    presets: [
      { slotIndex: 0, text: "20 (Pantoprazole 40mg)" },
      { slotIndex: 1, text: "30 (Paracetamol 500mg)" },
      { slotIndex: 2, text: "45 (Vitamin B-Complex)" },
      { slotIndex: 3, text: "60 (Cetirizine 10mg)" }
    ]
  },
  eldercare: {
    slots: ["Morning", "Noon", "Afternoon", "Night"],
    alarms: { Morning: "08:00", Noon: "13:00", Afternoon: "17:00", Night: "21:00" },
    presets: [
      { slotIndex: 0, text: "85 (Telmisartan BP)" },
      { slotIndex: 1, text: "110 (Metformin Sugar)" },
      { slotIndex: 2, text: "40 (Calcium + D3)" },
      { slotIndex: 3, text: "95 (Atorvastatin 10mg)" }
    ]
  },
  fever: {
    slots: ["Morning", "Noon", "Afternoon", "Night"],
    alarms: { Morning: "08:30", Noon: "14:00", Afternoon: "18:00", Night: "22:00" },
    presets: [
      { slotIndex: 0, text: "25 (Azithromycin 500)" },
      { slotIndex: 1, text: "30 (Dolo 650mg)" },
      { slotIndex: 2, text: "20 (ORS Electrolyte)" },
      { slotIndex: 3, text: "35 (Cough Syrup 10ml)" }
    ]
  },
  personal: {
    slots: ["Morning", "Noon", "Afternoon", "Night"],
    alarms: { Morning: "09:00", Noon: "13:30", Afternoon: "18:00", Night: "22:00" },
    presets: [
      { slotIndex: 0, text: "50 (Multivitamin)" },
      { slotIndex: 1, text: "40 (Omega-3)" },
      { slotIndex: 2, text: "30 (Eye Drops)" },
      { slotIndex: 3, text: "45 (Melatonin)" }
    ]
  }
};

const CURRENCY_OPTIONS = [
  { value: "₹", label: "INR (₹)" },
  { value: "$", label: "USD ($)" },
  { value: "€", label: "EUR (€)" },
  { value: "£", label: "GBP (£)" }
];

const TEMPLATE_OPTIONS = [
  { value: "daily", label: "Daily Medicine & Dose Schedule" },
  { value: "eldercare", label: "Parents / Senior Care (BP & Sugar)" },
  { value: "fever", label: "Fever / Recovery Course" },
  { value: "personal", label: "Personal Wellness & Vitamins" }
];

// ==================== CUSTOM DROPDOWN ENGINE ====================
const dropdownRegistry = {};

function renderCustomDropdown(containerId, options, selectedValue, onChange, extraBtnClass = "") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const currentOpt =
    options.find((o) => String(o.value) === String(selectedValue)) ||
    options[0] || { value: "", label: "Select" };

  dropdownRegistry[containerId] = { value: currentOpt.value, options, onChange, extraBtnClass };

  container.innerHTML = `
    <div class="c-dropdown" id="wrap-${containerId}">
      <button type="button" class="c-dropdown-btn ${extraBtnClass}">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(currentOpt.label)}</span>
        <span class="c-dropdown-arrow">▼</span>
      </button>
      <div class="c-dropdown-menu">
        ${options
          .map((opt) => {
            const isSel = String(opt.value) === String(currentOpt.value);
            return `<button type="button" class="c-dropdown-item ${isSel ? "selected" : ""}" data-val="${escapeHtml(String(opt.value))}">
              <span>${escapeHtml(opt.label)}</span>
              ${isSel ? `<span class="c-dropdown-check">✓</span>` : ""}
            </button>`;
          })
          .join("")}
      </div>
    </div>
  `;

  const wrap = container.querySelector(".c-dropdown");
  const triggerBtn = container.querySelector(".c-dropdown-btn");

  triggerBtn.onclick = (e) => {
    e.stopPropagation();
    const wasOpen = wrap.classList.contains("open");
    document.querySelectorAll(".c-dropdown.open").forEach((el) => el.classList.remove("open"));
    if (!wasOpen) wrap.classList.add("open");
  };

  container.querySelectorAll(".c-dropdown-item").forEach((itemBtn) => {
    itemBtn.onclick = (e) => {
      e.stopPropagation();
      const newVal = itemBtn.dataset.val;
      wrap.classList.remove("open");
      renderCustomDropdown(containerId, options, newVal, onChange, extraBtnClass);
      if (onChange) onChange(newVal);
    };
  });
}

function getDropdownValue(containerId) {
  return dropdownRegistry[containerId]?.value ?? "";
}

document.addEventListener("click", () => {
  document.querySelectorAll(".c-dropdown.open").forEach((el) => el.classList.remove("open"));
});

// ==================== CUSTOM DIALOG ====================
function openCustomDialog({ title, message, showInput = false, inputType = "text", defaultValue = "", okText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customDialogModal");
    const titleEl = document.getElementById("cDlgTitle");
    const msgEl = document.getElementById("cDlgMessage");
    const inputWrap = document.getElementById("cDlgInputWrap");
    const inputEl = document.getElementById("cDlgInput");
    const okBtn = document.getElementById("cDlgOkBtn");
    const cancelBtn = document.getElementById("cDlgCancelBtn");

    titleEl.innerText = title;
    titleEl.style.color = danger ? "var(--rose)" : "var(--primary)";
    msgEl.innerText = message;
    okBtn.innerText = okText;
    okBtn.style.background = danger ? "var(--rose)" : "linear-gradient(135deg, #10b981, #059669)";
    okBtn.style.color = "#ffffff";

    if (showInput) {
      inputWrap.classList.remove("hidden");
      inputEl.type = inputType;
      inputEl.value = defaultValue;
    } else {
      inputWrap.classList.add("hidden");
    }

    modal.classList.add("show");
    if (showInput) setTimeout(() => inputEl.focus(), 60);

    const cleanup = (result) => {
      modal.classList.remove("show");
      resolve(result);
    };

    cancelBtn.onclick = () => cleanup(null);
    okBtn.onclick = () => cleanup(showInput ? inputEl.value : true);
  });
}

// ==================== GLOBAL STATE ====================
let currentUser = null;
let userProfile = null;
let workspaces = [];
let activeWorkspaceId = null;
let rawData = [];
let currentActiveRows = [];
let activeEditDocId = null;
let weekOffset = 0;
let lastSyncedDateStr = "";
let unsubWorkspaces = null;
let unsubEntries = null;
let isCreatingDefaultWs = false;

let onboardAvatarDataUrl = "";
let profModalAvatarDataUrl = "";
let isEmailSignUp = true;
let isCreatingAccount = false;
let isCreatingWs = false;
let wipeCountdownTimer = null;
let dashboardBooted = false;
let initialSessionLockApplied = false;
let justCompletedSignup = false;
let alarmCheckInterval = null;
let firedAlarmsToday = new Set();

// Persistent AI Chat Sessions State
let aiChatSessions = [];
let activeChatId = null;

let catChartInstance = null;
let trendChartInstance = null;
const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ==================== TOAST & IMAGE COMPRESSOR ====================
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.style.background = type === "error" ? "#fb7185" : "#10b981";
  t.style.color = "#ffffff";
  t.style.display = "block";
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    t.style.display = "none";
  }, 2800);
}
window.showToast = showToast;

function compressImage(file, maxDim = 960, quality = 0.84) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mime: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== 0B. SMART MEDICINE REMINDER ALARM, SOUND, VOICE & BROWSER NOTIFICATION ====================
function playMedicalAlarmChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [587.33, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.22);
      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + idx * 0.22 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.22 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.22);
      osc.stop(ctx.currentTime + idx * 0.22 + 0.21);
    });
  } catch (e) {}
}

function speakMedicineReminder(slotName, medText) {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const cleanMeds = String(medText || "").replace(/\d+\s*\(([^)]+)\)/g, "$1").trim();
    const msg = new SpeechSynthesisUtterance(
      `Medicine reminder! Time for your ${slotName} dose: ${cleanMeds}`
    );
    msg.rate = 0.98;
    msg.pitch = 1.05;
    window.speechSynthesis.speak(msg);
  } catch (e) {}
}

function getTodayScheduledMedicinesForSlot(slotName) {
  const ws = getActiveWorkspace();
  if (!ws) return "";
  const todayFormatted = formatDateWithDay(getLocalTodayISO());
  const todayLogs = rawData.filter((r) => r.date === todayFormatted);
  const meds = [];
  todayLogs.forEach((r) => {
    const val = r.slotValues?.[slotName];
    if (val && val !== "-") meds.push(val);
  });
  if (meds.length > 0) return meds.join(", ");

  const slotIdx = (ws.slots || []).indexOf(slotName);
  const matchingPreset = (ws.presets || []).find((p) => p.slotIndex === slotIdx);
  return matchingPreset ? matchingPreset.text : "Scheduled Daily Dose";
}

function triggerMedicineAlert(slotName, medSummary) {
  playMedicalAlarmChime();
  speakMedicineReminder(slotName, medSummary);

  document.getElementById("alarmModalSlotText").innerText = `⏰ ${slotName.toUpperCase()} DOSE REMINDER`;
  document.getElementById("alarmModalMedText").innerText = medSummary;
  document.getElementById("inAppAlarmModal").classList.add("show");

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(`💊 MediRemind AI — ${slotName} Dose`, {
        body: `Time to take: ${medSummary}`,
        icon: "logo.png"
      });
    } catch (e) {}
  }
}

document.getElementById("dismissAlarmBtn").onclick = () => {
  document.getElementById("inAppAlarmModal").classList.remove("show");
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  showToast("Dose marked as acknowledged!");
};

document.getElementById("enableNotifBtn").onclick = async () => {
  if (!("Notification" in window)) {
    return showToast("Browser notifications not supported on this device", "error");
  }
  const perm = await Notification.requestPermission();
  updateNotificationPermBadge();
  if (perm === "granted") {
    showToast("Medicine Push Notifications Enabled!");
  } else {
    showToast("Notification permission blocked by browser", "error");
  }
};

document.getElementById("testAlarmBtn").onclick = async () => {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission().catch(() => {});
    updateNotificationPermBadge();
  }
  const ws = getActiveWorkspace();
  const slots = ws?.slots || ["Morning", "Noon", "Afternoon", "Night"];
  let chosenSlot = slots[0];
  let medList = "";
  for (const s of slots) {
    const todayVal = getTodayScheduledMedicinesForSlot(s);
    if (todayVal && todayVal !== "Scheduled Daily Dose") {
      chosenSlot = s;
      medList = todayVal;
      break;
    }
  }
  if (!medList) medList = "30 (Paracetamol 500mg), 20 (Vitamin C)";
  triggerMedicineAlert(chosenSlot, medList);
};

function updateNotificationPermBadge() {
  const statusEl = document.getElementById("notifPermStatus");
  const btnEl = document.getElementById("enableNotifBtn");
  if (!statusEl || !btnEl) return;

  if (!("Notification" in window)) {
    statusEl.innerText = "In-App Chime & Voice Alert Active";
    btnEl.classList.add("hidden");
    return;
  }

  if (Notification.permission === "granted") {
    statusEl.innerText = "✅ Push Notification + Chime + Voice Alert Ready";
    btnEl.innerText = "🔔 Alerts On";
  } else {
    statusEl.innerText = "Tap 'Allow Alerts' for lock-screen push notifications";
    btnEl.innerText = "🔔 Allow Alerts";
  }
}

function startMedicineReminderScheduler() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);

  const checkAlarms = () => {
    const ws = getActiveWorkspace();
    if (!ws) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const currentHM = `${hh}:${mm}`;
    const todayKey = getLocalTodayISO();

    const slots = ws.slots || [];
    const alarms = ws.alarms || DEFAULT_ALARM_TIMES;

    // Update next upcoming reminder label
    let nextLabel = "";
    for (const s of slots) {
      const t = alarms[s] || DEFAULT_ALARM_TIMES[s];
      if (t && t >= currentHM) {
        nextLabel = `Next Dose: ${s} at ${t}`;
        break;
      }
    }
    if (!nextLabel && slots.length > 0) {
      const firstSlot = slots[0];
      nextLabel = `Next Dose: Tomorrow ${firstSlot} at ${alarms[firstSlot] || "08:30"}`;
    }
    const lblEl = document.getElementById("nextDoseLabel");
    if (lblEl) lblEl.innerText = nextLabel;

    // Fire alarm if exact minute matches
    slots.forEach((s) => {
      const targetTime = alarms[s] || DEFAULT_ALARM_TIMES[s];
      const fireId = `${todayKey}_${ws.id}_${s}_${targetTime}`;
      if (targetTime === currentHM && !firedAlarmsToday.has(fireId)) {
        firedAlarmsToday.add(fireId);
        const meds = getTodayScheduledMedicinesForSlot(s);
        triggerMedicineAlert(s, meds);
      }
    });
  };

  checkAlarms();
  alarmCheckInterval = setInterval(checkAlarms, 15000);
}

// ==================== 1. SECRET CALCULATOR, 10x '=' PIN RESET & STEALTH BLUR ====================
let calcExpression = "";
let eqSecretTapCount = 0;
let eqTapResetTimer = null;

function getSecretPin() {
  return userProfile?.calcPin || localStorage.getItem("mediremind_pin") || "2007";
}

window.calcAppend = (val) => {
  eqSecretTapCount = 0;
  if (calcExpression === "Error") calcExpression = "";
  calcExpression += val;
  document.getElementById("calcScreen").innerText = calcExpression || "0";
};

window.calcClear = () => {
  calcExpression = "";
  document.getElementById("calcHistory").innerText = "";
  document.getElementById("calcScreen").innerText = "0";
};

window.calcBack = () => {
  eqSecretTapCount = 0;
  if (calcExpression === "Error") calcExpression = "";
  calcExpression = calcExpression.slice(0, -1);
  document.getElementById("calcScreen").innerText = calcExpression || "0";
};

window.calcEquals = () => {
  const pin = getSecretPin();
  if (calcExpression === pin) {
    eqSecretTapCount = 0;
    window.calcClear();
    document.getElementById("calcLockScreen").classList.add("unlocked");
    showToast("Medical Vault Unlocked");
    return;
  }

  eqSecretTapCount += 1;
  clearTimeout(eqTapResetTimer);
  eqTapResetTimer = setTimeout(() => {
    eqSecretTapCount = 0;
  }, 4000);

  if (eqSecretTapCount >= 10) {
    eqSecretTapCount = 0;
    clearTimeout(eqTapResetTimer);
    window.calcClear();
    openVerifiedPinResetModal();
    return;
  }

  try {
    if (!calcExpression) return;
    document.getElementById("calcHistory").innerText = calcExpression;
    const sanitized = calcExpression.replace(/[^0-9+\-*/.%]/g, "");
    const result = Function('"use strict";return (' + sanitized + ")")();
    calcExpression = String(Number.isFinite(result) ? Number(result.toFixed(6)) : "Error");
    document.getElementById("calcScreen").innerText = calcExpression;
  } catch (e) {
    calcExpression = "Error";
    document.getElementById("calcScreen").innerText = "Error";
  }
};

window.lockVault = () => {
  window.calcClear();
  eqSecretTapCount = 0;
  document.getElementById("calcLockScreen").classList.remove("unlocked");
};

window.toggleStealthBlur = () => {
  const isBlurred = document.body.classList.toggle("stealth-blur");
  const btn = document.getElementById("eyeToggleBtn");
  btn.classList.toggle("active-eye", isBlurred);
  btn.innerText = isBlurred ? "🙈" : "👁️";
};

// ==================== 2. AUTHENTICATION & EMAIL VERIFICATION ====================
const googleProvider = new GoogleAuthProvider();

document.getElementById("googleSignInBtn").onclick = async () => {
  const errBox = document.getElementById("authErrorBox");
  errBox.classList.add("hidden");
  try {
    justCompletedSignup = true;
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    justCompletedSignup = false;
    errBox.textContent = err.message || "Google Sign-In failed.";
    errBox.classList.remove("hidden");
  }
};

document.getElementById("toggleAuthModeBtn").onclick = () => {
  isEmailSignUp = !isEmailSignUp;
  document.getElementById("emailAuthSubmitBtn").textContent = isEmailSignUp ? "Create Care Account →" : "Sign In →";
  document.getElementById("toggleAuthModeBtn").textContent = isEmailSignUp
    ? "Already have an account? Sign In"
    : "New user? Create a new account";
};

document.getElementById("emailAuthForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const pass = document.getElementById("authPassword").value;
  const errBox = document.getElementById("authErrorBox");
  errBox.classList.add("hidden");

  try {
    justCompletedSignup = true;
    if (isEmailSignUp) {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await sendEmailVerification(cred.user);
      showToast("Verification link sent to your email!");
    } else {
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user).catch(() => {});
        showToast("Please verify your email link first", "error");
      }
    }
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user).catch(() => {});
        }
        return;
      } catch (e2) {
        justCompletedSignup = false;
        errBox.textContent = e2.message;
      }
    } else {
      justCompletedSignup = false;
      errBox.textContent = err.message;
    }
    errBox.classList.remove("hidden");
  }
};

document.getElementById("openForgotPwdBtn").onclick = () => {
  document.getElementById("forgotPwdEmailInput").value = document.getElementById("authEmail").value.trim();
  document.getElementById("forgotPwdModal").classList.add("show");
};

document.getElementById("sendForgotPwdBtn").onclick = async () => {
  const email = document.getElementById("forgotPwdEmailInput").value.trim();
  if (!email) return showToast("Enter your email address", "error");
  try {
    await sendPasswordResetEmail(auth, email);
    document.getElementById("forgotPwdModal").classList.remove("show");
    showToast("Password reset link sent to your email!");
  } catch (err) {
    showToast(err.message || "Failed to send reset link", "error");
  }
};

document.getElementById("checkVerifiedBtn").onclick = async () => {
  if (!currentUser) return;
  await currentUser.reload();
  if (currentUser.emailVerified) {
    showToast("Email Verified!");
    document.getElementById("verifyEmailScreen").classList.add("hidden");
    const profileSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (!profileSnap.exists() || !profileSnap.data().onboardingDone) {
      openOnboarding(currentUser);
    } else {
      userProfile = profileSnap.data();
      launchDashboard(false);
    }
  } else {
    showToast("Not verified yet. Click the link in your email inbox!", "error");
  }
};

document.getElementById("resendVerifyLinkBtn").onclick = async () => {
  if (!currentUser) return;
  try {
    await sendEmailVerification(currentUser);
    showToast("New verification link sent!");
  } catch (err) {
    showToast(err.message || "Wait a moment before resending", "error");
  }
};

document.getElementById("verifyLogoutBtn").onclick = async () => {
  document.getElementById("verifyEmailScreen").classList.add("hidden");
  await signOut(auth);
};

function hideSplashScreen() {
  const bootSplash = document.getElementById("bootSplash");
  if (bootSplash) bootSplash.classList.add("hidden");
}

function fetchDocWithTimeout(docRef, ms = 3500) {
  return Promise.race([
    getDoc(docRef),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    hideSplashScreen();
    initialSessionLockApplied = false;
    document.getElementById("calcLockScreen").classList.add("unlocked");
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("verifyEmailScreen").classList.add("hidden");
    document.getElementById("onboardingScreen").classList.add("hidden");
    document.getElementById("mainAppContainer").classList.add("hidden");
    document.getElementById("bottomNavBar").classList.add("hidden");
    return;
  }

  const usesPasswordProvider = user.providerData.some((p) => p.providerId === "password");
  if (usesPasswordProvider && !user.emailVerified) {
    hideSplashScreen();
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("verifyTargetEmail").innerText = user.email || "";
    document.getElementById("verifyEmailScreen").classList.remove("hidden");
    return;
  }

  let hasCachedProfile = false;
  try {
    const cached = JSON.parse(localStorage.getItem(`mediremind_prof_${user.uid}`) || "null");
    if (cached && cached.onboardingDone) {
      userProfile = cached;
      hasCachedProfile = true;
      hideSplashScreen();
      launchDashboard(!justCompletedSignup);
    }
  } catch (e) {}

  try {
    const profileSnap = await fetchDocWithTimeout(doc(db, "users", user.uid), 3500);
    hideSplashScreen();
    if (!profileSnap.exists() || !profileSnap.data().onboardingDone) {
      if (!hasCachedProfile) openOnboarding(user);
    } else {
      userProfile = profileSnap.data();
      localStorage.setItem(`mediremind_prof_${user.uid}`, JSON.stringify(userProfile));
      localStorage.setItem("mediremind_pin", userProfile.calcPin || "2007");
      launchDashboard(!justCompletedSignup);
    }
  } catch (err) {
    hideSplashScreen();
    if (!hasCachedProfile) openOnboarding(user);
  }
});

// ==================== 3. CARE PROFILE SETUP (ONBOARDING) ====================
function openOnboarding(user) {
  hideSplashScreen();
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("verifyEmailScreen").classList.add("hidden");
  document.getElementById("mainAppContainer").classList.add("hidden");
  document.getElementById("bottomNavBar").classList.add("hidden");
  document.getElementById("onboardingScreen").classList.remove("hidden");

  const defaultPic = user.photoURL || "logo.png";
  onboardAvatarDataUrl = defaultPic;
  document.getElementById("onboardAvatarImg").src = defaultPic;
  document.getElementById("onboardFullName").value = user.displayName || "";

  renderCustomDropdown("dd-onboardCurrency", CURRENCY_OPTIONS, "₹");
  renderCustomDropdown("dd-onboardTemplate", TEMPLATE_OPTIONS, "daily");
}

document.getElementById("onboardAvatarFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file, 250, 0.85);
  onboardAvatarDataUrl = compressed.dataUrl;
  document.getElementById("onboardAvatarImg").src = compressed.dataUrl;
};

document.getElementById("finishOnboardingBtn").onclick = async () => {
  if (isCreatingAccount) return;
  const fullName = document.getElementById("onboardFullName").value.trim();
  const calcPin = document.getElementById("onboardPin").value.trim();
  const currency = getDropdownValue("dd-onboardCurrency") || "₹";
  const wsName = document.getElementById("onboardWsName").value.trim();
  const templateKey = getDropdownValue("dd-onboardTemplate") || "daily";
  const upiId = document.getElementById("onboardUpi").value.trim();
  const budgetLimit = Number(document.getElementById("onboardBudget").value) || 5000;
  const membersRaw = document.getElementById("onboardMembers").value.trim();

  if (!fullName || !wsName) {
    showToast("Enter your Name and Patient Profile Name", "error");
    return;
  }
  if (!/^\d{3,8}$/.test(calcPin)) {
    showToast("Set a 3 to 8 digit Privacy Lock PIN", "error");
    return;
  }

  isCreatingAccount = true;
  const btn = document.getElementById("finishOnboardingBtn");
  btn.disabled = true;
  btn.innerText = "Creating care profile...";

  try {
    const extraMembers = membersRaw ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean) : [];
    const members = Array.from(new Set([fullName, ...extraMembers]));
    const tpl = WORKSPACE_TEMPLATES[templateKey] || WORKSPACE_TEMPLATES.daily;

    userProfile = {
      uid: currentUser.uid,
      email: currentUser.email,
      fullName,
      currency,
      upiId,
      photoUrl: onboardAvatarDataUrl,
      calcPin,
      onboardingDone: true,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });
    localStorage.setItem(`mediremind_prof_${currentUser.uid}`, JSON.stringify(userProfile));
    localStorage.setItem("mediremind_pin", calcPin);

    const wsRef = await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
      name: wsName,
      templateKey,
      slots: tpl.slots,
      alarms: tpl.alarms,
      presets: tpl.presets,
      members,
      upiId,
      budgetLimit,
      createdAt: serverTimestamp()
    });
    activeWorkspaceId = wsRef.id;

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    showToast("MediRemind AI Ready!");
    launchDashboard(false);
  } catch (err) {
    showToast("Setup failed: " + err.message, "error");
  } finally {
    isCreatingAccount = false;
    btn.disabled = false;
    btn.innerText = "Launch MediRemind AI →";
  }
};

function launchDashboard(lockCalculatorOnBoot = false) {
  hideSplashScreen();
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("verifyEmailScreen").classList.add("hidden");
  document.getElementById("onboardingScreen").classList.add("hidden");
  document.getElementById("mainAppContainer").classList.remove("hidden");
  document.getElementById("bottomNavBar").classList.remove("hidden");

  if (lockCalculatorOnBoot && !initialSessionLockApplied) {
    initialSessionLockApplied = true;
    window.lockVault();
  }

  updateProfileUI();
  updateNotificationPermBadge();
  if (!dashboardBooted) {
    dashboardBooted = true;
    syncDateIfNeeded(true);
    subscribeWorkspaces();
    loadAiChatHistoryStore();
    startMedicineReminderScheduler();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncDateIfNeeded(false);
        renderTable();
      }
    });
  }
}

function updateProfileUI() {
  if (!userProfile) return;
  document.getElementById("topbarAvatarImg").src = userProfile.photoUrl || "logo.png";
}

function getCurrency() {
  return userProfile?.currency || "₹";
}

// ==================== 4. VERIFIED PRIVACY PIN RESET (SETTINGS + 10x '=' TAP) ====================
function openVerifiedPinResetModal() {
  if (!currentUser) return;
  const modal = document.getElementById("pinResetModal");
  const stepVerify = document.getElementById("pinResetStepVerify");
  const stepNew = document.getElementById("pinResetStepNew");
  const emailInp = document.getElementById("pinResetEmail");
  const pwdWrap = document.getElementById("pinResetPwdWrap");
  const pwdInp = document.getElementById("pinResetPassword");
  const sendBtn = document.getElementById("pinSendVerifyBtn");
  const confirmBox = document.getElementById("pinVerifyConfirmBox");
  const errEl = document.getElementById("pinResetErrMsg");

  stepVerify.classList.remove("hidden");
  stepNew.classList.add("hidden");
  confirmBox.classList.add("hidden");
  errEl.classList.add("hidden");
  pwdInp.value = "";
  document.getElementById("pinNewInput").value = "";
  document.getElementById("pinNewConfirmInput").value = "";

  emailInp.value = currentUser.email || "";
  const isPasswordUser = currentUser.providerData.some((p) => p.providerId === "password");
  if (isPasswordUser) {
    pwdWrap.classList.remove("hidden");
    sendBtn.disabled = false;
    sendBtn.innerText = "Verify Email & Password →";
  } else {
    pwdWrap.classList.add("hidden");
    sendBtn.disabled = false;
    sendBtn.innerText = "Verify via Google Account →";
  }

  modal.classList.add("show");
}

window.closePinResetModal = () => {
  document.getElementById("pinResetModal").classList.remove("show");
};

document.getElementById("settingsResetPinBtn").onclick = () => {
  window.closeProfileModal();
  openVerifiedPinResetModal();
};

document.getElementById("pinSendVerifyBtn").onclick = async () => {
  if (!currentUser) return;
  const errEl = document.getElementById("pinResetErrMsg");
  const sendBtn = document.getElementById("pinSendVerifyBtn");
  const confirmBox = document.getElementById("pinVerifyConfirmBox");
  errEl.classList.add("hidden");

  const isPasswordUser = currentUser.providerData.some((p) => p.providerId === "password");
  sendBtn.disabled = true;
  sendBtn.innerText = "Verifying...";

  try {
    if (isPasswordUser) {
      const pass = document.getElementById("pinResetPassword").value;
      if (!pass) throw new Error("Enter your account password.");
      const cred = EmailAuthProvider.credential(currentUser.email, pass);
      await reauthenticateWithCredential(currentUser, cred);
    } else {
      await reauthenticateWithPopup(currentUser, googleProvider);
    }

    confirmBox.classList.remove("hidden");
    sendBtn.innerText = "Verified ✓";
    showToast("Identity verified! Tap Confirmed to set new PIN.");
  } catch (err) {
    errEl.innerText = err.message || "Verification failed. Check your password.";
    errEl.classList.remove("hidden");
    sendBtn.disabled = false;
    sendBtn.innerText = isPasswordUser ? "Verify Email & Password →" : "Verify via Google Account →";
  }
};

document.getElementById("pinConfirmVerifiedBtn").onclick = () => {
  document.getElementById("pinResetStepVerify").classList.add("hidden");
  document.getElementById("pinResetStepNew").classList.remove("hidden");
  setTimeout(() => document.getElementById("pinNewInput").focus(), 60);
};

document.getElementById("saveNewCalcPinBtn").onclick = async () => {
  const p1 = document.getElementById("pinNewInput").value.trim();
  const p2 = document.getElementById("pinNewConfirmInput").value.trim();

  if (!/^\d{3,8}$/.test(p1)) return showToast("PIN must be 3 to 8 digits", "error");
  if (p1 !== p2) return showToast("PINs do not match", "error");

  userProfile = { ...userProfile, calcPin: p1 };
  await setDoc(doc(db, "users", currentUser.uid), { calcPin: p1 }, { merge: true });
  localStorage.setItem(`mediremind_prof_${currentUser.uid}`, JSON.stringify(userProfile));
  localStorage.setItem("mediremind_pin", p1);

  window.closePinResetModal();
  document.getElementById("calcLockScreen").classList.add("unlocked");
  showToast("New Privacy PIN Saved & Unlocked!");
};

// ==================== 5. PERSISTENT HEALTH AI CHAT HISTORY ====================
function getChatStorageKey() {
  return `mediremind_ai_chats_${currentUser?.uid || "guest"}`;
}

function saveAiChatSessionsToLocal() {
  try {
    localStorage.setItem(getChatStorageKey(), JSON.stringify(aiChatSessions));
  } catch (e) {}
}

async function syncChatSessionToCloud(sessionObj) {
  if (!currentUser || !sessionObj) return;
  try {
    await setDoc(
      doc(db, "users", currentUser.uid, "aiChats", sessionObj.id),
      {
        title: sessionObj.title,
        messages: sessionObj.messages,
        updatedAt: sessionObj.updatedAt
      },
      { merge: true }
    );
  } catch (e) {}
}

async function loadAiChatHistoryStore() {
  try {
    const cached = JSON.parse(localStorage.getItem(getChatStorageKey()) || "[]");
    if (Array.isArray(cached) && cached.length > 0) {
      aiChatSessions = cached;
      activeChatId = aiChatSessions[0].id;
      renderActiveChatMessages();
      renderChatHistoryList();
    }
  } catch (e) {}

  if (!currentUser) return;
  try {
    const snap = await getDocs(
      query(collection(db, "users", currentUser.uid, "aiChats"), orderBy("updatedAt", "desc"))
    );
    if (!snap.empty) {
      aiChatSessions = [];
      snap.forEach((d) => aiChatSessions.push({ id: d.id, ...d.data() }));
      saveAiChatSessionsToLocal();
      if (!activeChatId || !aiChatSessions.some((c) => c.id === activeChatId)) {
        activeChatId = aiChatSessions[0].id;
      }
      renderActiveChatMessages();
      renderChatHistoryList();
    } else if (aiChatSessions.length === 0) {
      createNewChatSession(false);
    }
  } catch (e) {
    if (aiChatSessions.length === 0) createNewChatSession(false);
  }
}

function getActiveChatSession() {
  let chat = aiChatSessions.find((c) => c.id === activeChatId);
  if (!chat) {
    chat = createNewChatSession(false);
  }
  return chat;
}

function createNewChatSession(closeHistPanel = true) {
  const newChat = {
    id: `chat_${Date.now()}`,
    title: "New Health AI Chat",
    messages: [
      {
        role: "ai",
        text: "💊 Hi! I'm MediRemind AI. Ask me about today's Morning/Noon/Night medicines, dosage reminders, or family medical expense splits in Bengali, Hindi, or English!"
      }
    ],
    updatedAt: Date.now()
  };
  aiChatSessions.unshift(newChat);
  activeChatId = newChat.id;
  saveAiChatSessionsToLocal();
  renderActiveChatMessages();
  renderChatHistoryList();
  if (closeHistPanel) {
    document.getElementById("aiChatHistoryPanel").classList.add("hidden");
  }
  return newChat;
}

function renderActiveChatMessages() {
  const chat = getActiveChatSession();
  document.getElementById("activeChatTitle").innerText = chat.title || "New Health AI Chat";
  const box = document.getElementById("aiChatMessages");
  box.innerHTML = "";
  (chat.messages || []).forEach((m) => {
    const div = document.createElement("div");
    div.className = `chat-bubble ${m.role}`;
    div.innerText = m.text;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function renderChatHistoryList() {
  const listWrap = document.getElementById("aiChatHistoryList");
  if (!listWrap) return;
  listWrap.innerHTML = "";

  aiChatSessions.forEach((chat) => {
    const item = document.createElement("div");
    item.className = `chat-hist-item ${chat.id === activeChatId ? "active" : ""}`;
    item.innerHTML = `
      <span class="chat-hist-title">💊 ${escapeHtml(chat.title || "Untitled Chat")}</span>
      <div class="chat-hist-actions">
        <button type="button" class="hist-ren-btn" title="Rename">✏️</button>
        <button type="button" class="hist-del-btn" title="Delete" style="color:var(--rose);">🗑️</button>
      </div>
    `;

    item.querySelector(".chat-hist-title").onclick = () => {
      activeChatId = chat.id;
      renderActiveChatMessages();
      renderChatHistoryList();
      document.getElementById("aiChatHistoryPanel").classList.add("hidden");
    };

    item.querySelector(".hist-ren-btn").onclick = (e) => {
      e.stopPropagation();
      renameChatSession(chat.id);
    };

    item.querySelector(".hist-del-btn").onclick = (e) => {
      e.stopPropagation();
      deleteChatSession(chat.id);
    };

    listWrap.appendChild(item);
  });
}

async function renameChatSession(chatId) {
  const chat = aiChatSessions.find((c) => c.id === chatId);
  if (!chat) return;
  const newName = await openCustomDialog({
    title: "Rename Conversation",
    message: "Enter a new title for this chat:",
    showInput: true,
    inputType: "text",
    defaultValue: chat.title,
    okText: "Save Name"
  });
  if (newName && newName.trim()) {
    chat.title = newName.trim();
    chat.updatedAt = Date.now();
    saveAiChatSessionsToLocal();
    syncChatSessionToCloud(chat);
    renderActiveChatMessages();
    renderChatHistoryList();
    showToast("Chat renamed!");
  }
}

async function deleteChatSession(chatId) {
  const ok = await openCustomDialog({
    title: "Delete Conversation",
    message: "Delete this chat history permanently?",
    okText: "Delete",
    danger: true
  });
  if (!ok) return;

  aiChatSessions = aiChatSessions.filter((c) => c.id !== chatId);
  saveAiChatSessionsToLocal();
  if (currentUser) {
    deleteDoc(doc(db, "users", currentUser.uid, "aiChats", chatId)).catch(() => {});
  }

  if (aiChatSessions.length === 0) {
    createNewChatSession(false);
  } else if (activeChatId === chatId) {
    activeChatId = aiChatSessions[0].id;
    renderActiveChatMessages();
  }
  renderChatHistoryList();
  showToast("Chat deleted");
}

function openAiSideDrawer() {
  document.getElementById("aiDrawerBackdrop").classList.add("show");
  document.getElementById("aiSideDrawer").classList.add("open");
  renderActiveChatMessages();
  renderChatHistoryList();
  setTimeout(() => document.getElementById("aiDrawerInput").focus(), 180);
}

function closeAiSideDrawer() {
  document.getElementById("aiDrawerBackdrop").classList.remove("show");
  document.getElementById("aiSideDrawer").classList.remove("open");
}

document.getElementById("openAiDrawerBtn").onclick = openAiSideDrawer;
document.getElementById("closeAiDrawerBtn").onclick = closeAiSideDrawer;
document.getElementById("aiDrawerBackdrop").onclick = closeAiSideDrawer;
document.getElementById("toggleChatHistoryBtn").onclick = () => {
  document.getElementById("aiChatHistoryPanel").classList.toggle("hidden");
  renderChatHistoryList();
};
document.getElementById("newAiChatBtn").onclick = () => {
  createNewChatSession(true);
  showToast("Started new Health AI chat");
};
document.getElementById("renameActiveChatBtn").onclick = () => renameChatSession(activeChatId);
document.getElementById("deleteActiveChatBtn").onclick = () => deleteChatSession(activeChatId);

function appendChatBubble(role, text) {
  const box = document.getElementById("aiChatMessages");
  const div = document.createElement("div");
  div.className = `chat-bubble ${role}`;
  div.innerText = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

// ==================== 6. LIVE CARE SNAPSHOT & HEALTH AI EVERYWHERE ====================
function computeMemberLedgerStats(ws, rows) {
  const members = ws.members || [];
  const paidByMember = {};
  const shareByMember = {};
  const netBalances = {};

  members.forEach((m) => {
    paidByMember[m] = 0;
    shareByMember[m] = 0;
    netBalances[m] = 0;
  });

  rows.forEach((r) => {
    const amt = Number(r.total) || 0;
    const payer = r.paidBy && Object.prototype.hasOwnProperty.call(paidByMember, r.paidBy) ? r.paidBy : members[0];
    if (payer) {
      paidByMember[payer] += amt;
      netBalances[payer] += amt;
    }

    const validSplitters = (r.splitBetween || members).filter((m) =>
      Object.prototype.hasOwnProperty.call(netBalances, m)
    );
    const activeSplitters = validSplitters.length > 0 ? validSplitters : members;
    if (activeSplitters.length > 0) {
      const share = amt / activeSplitters.length;
      activeSplitters.forEach((s) => {
        shareByMember[s] += share;
        netBalances[s] -= share;
      });
    }
  });

  const debtors = [];
  const creditors = [];
  Object.entries(netBalances).forEach(([person, amt]) => {
    if (amt < -0.5) debtors.push({ person, amt: Math.abs(amt) });
    else if (amt > 0.5) creditors.push({ person, amt });
  });

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const payAmt = Math.min(debtors[i].amt, creditors[j].amt);
    transfers.push({ from: debtors[i].person, to: creditors[j].person, amount: Math.round(payAmt) });
    debtors[i].amt -= payAmt;
    creditors[j].amt -= payAmt;
    if (debtors[i].amt < 0.5) i++;
    if (creditors[j].amt < 0.5) j++;
  }

  return { paidByMember, shareByMember, netBalances, transfers };
}

function buildLiveFinancialSnapshot() {
  const ws = getActiveWorkspace();
  if (!ws) return "No active care profile.";
  const cur = getCurrency();
  const stats = computeMemberLedgerStats(ws, currentActiveRows);
  const activeWeekTotal = currentActiveRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const allTimeTotal = rawData.reduce((s, r) => s + (Number(r.total) || 0), 0);

  return JSON.stringify({
    caregiver: userProfile?.fullName,
    currency: cur,
    allCareProfiles: workspaces.map((w) => w.name),
    activeCareProfile: ws.name,
    familyCaregivers: ws.members,
    doseSlots: ws.slots,
    alarmTimes: ws.alarms || DEFAULT_ALARM_TIMES,
    monthlyMedicineBudget: ws.budgetLimit || 5000,
    activeWeekMedSpend: activeWeekTotal,
    allTimeMedSpend: allTimeTotal,
    paidByCaregiverActiveWeek: stats.paidByMember,
    shareByCaregiverActiveWeek: stats.shareByMember,
    netBalancesActiveWeek: stats.netBalances,
    settlementTransfers: stats.transfers,
    recentMedicineLogs: rawData.slice(0, 40).map((r) => ({
      date: r.date,
      boughtBy: r.paidBy,
      splitBetween: r.splitBetween,
      doseSlots: r.slotValues,
      extraMeds: r.other,
      totalCost: r.total
    }))
  });
}

async function askSideAiAssistant(questionText) {
  const q = questionText.trim();
  if (!q) return;

  const chat = getActiveChatSession();
  if (chat.title === "New Health AI Chat") {
    chat.title = q.length > 30 ? q.slice(0, 30) + "..." : q;
    document.getElementById("activeChatTitle").innerText = chat.title;
  }

  chat.messages.push({ role: "user", text: q });
  chat.updatedAt = Date.now();
  saveAiChatSessionsToLocal();
  renderChatHistoryList();

  appendChatBubble("user", q);
  const thinkingBubble = appendChatBubble("ai", "MediRemind AI is checking schedules & logs...");

  const snapshot = buildLiveFinancialSnapshot();
  const systemPrompt = `You are MediRemind AI, a smart medicine reminder and healthcare expense assistant for ${userProfile?.fullName || "the user"}.
Live patient schedule & medicine database:
${snapshot}

Instructions:
1. Answer clearly using the live medicine schedules, alarm times, and cost split data above.
2. Reply in the exact language/script the user used (Bengali, Hindi, or English).
3. Keep formatting clean with bullet points and ${getCurrency()} amounts.`;

  const historyTurns = chat.messages.slice(-10).map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }]
  }));

  const { text: replyText, error } = await runGeminiAI({
    contents: [{ role: "user", parts: [{ text: systemPrompt }] }, ...historyTurns]
  });

  const finalReply = replyText || `⚠️ ${error || "Could not connect to MediRemind AI right now."}`;
  thinkingBubble.innerText = finalReply;

  chat.messages.push({ role: "ai", text: finalReply });
  chat.updatedAt = Date.now();
  saveAiChatSessionsToLocal();
  syncChatSessionToCloud(chat);
}

document.getElementById("aiDrawerForm").onsubmit = async (e) => {
  e.preventDefault();
  const inp = document.getElementById("aiDrawerInput");
  const text = inp.value;
  inp.value = "";
  await askSideAiAssistant(text);
};

document.querySelectorAll(".ai-chip-ask").forEach((chip) => {
  chip.onclick = () => askSideAiAssistant(chip.dataset.q);
});

// Analytics Tab Forecast AI
document.getElementById("aiAnalyticsRunBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const out = document.getElementById("aiAnalyticsOutput");
  if (!ws || rawData.length === 0) {
    out.innerText = "Log some medicines first so MediRemind AI can analyze adherence & costs!";
    out.classList.remove("hidden");
    return;
  }
  out.innerText = "🩺 MediRemind AI is analyzing dose adherence & monthly medicine budget...";
  out.classList.remove("hidden");

  const { text, error } = await runGeminiAI({
    parts: [
      {
        text: `Analyze this medicine log & budget data for "${ws.name}": ${buildLiveFinancialSnapshot()}.
Today is day ${new Date().getDate()} of the month.
Provide:
1) Dose adherence consistency across Morning/Noon/Afternoon/Night slots.
2) Projected month-end medicine cost vs budget (${getCurrency()}${ws.budgetLimit || 5000}).
Keep it crisp (max 70 words) in simple English.`
      }
    ]
  });
  out.innerText = text ? `🩺 ${text}` : `⚠️ ${error}`;
};

// Split & Settlements Tab AI Breakdown
document.getElementById("aiSplitExplainBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const box = document.getElementById("aiSplitExplainBox");
  if (!ws || currentActiveRows.length === 0) {
    box.innerText = "No active week medicine records to explain yet.";
    box.classList.remove("hidden");
    return;
  }
  box.innerText = "✨ MediRemind AI is calculating family caregiver reimbursements...";
  box.classList.remove("hidden");

  const { text, error } = await runGeminiAI({
    parts: [
      {
        text: `Explain the family medicine cost split clearly for "${ws.name}" using this exact data: ${buildLiveFinancialSnapshot()}.
Show how much each family member paid, their share, and who needs to reimburse whom. Max 65 words.`
      }
    ]
  });
  box.innerText = text ? `⚖️ ${text}` : `⚠️ ${error}`;
};

// ==================== 7. PROFILE, SETTINGS & HIGH-FRICTION DATA WIPE ====================
window.openProfileSettings = () => {
  if (!userProfile) return;
  profModalAvatarDataUrl = userProfile.photoUrl || "logo.png";
  document.getElementById("profModalAvatarImg").src = profModalAvatarDataUrl;
  document.getElementById("profModalEmail").innerText = currentUser.email || "";
  document.getElementById("profModalName").value = userProfile.fullName || "";
  renderCustomDropdown("dd-profModalCurrency", CURRENCY_OPTIONS, userProfile.currency || "₹");
  document.getElementById("profModalUpi").value = userProfile.upiId || "";
  document.getElementById("profModalGeminiKey").value = localStorage.getItem("mediremind_custom_gemini_key") || "";
  document.getElementById("profileModal").classList.add("show");
};

document.getElementById("openProfileModalBtn").onclick = window.openProfileSettings;

window.closeProfileModal = () => {
  document.getElementById("profileModal").classList.remove("show");
};

document.getElementById("profModalAvatarFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file, 250, 0.85);
  profModalAvatarDataUrl = compressed.dataUrl;
  document.getElementById("profModalAvatarImg").src = compressed.dataUrl;
};

document.getElementById("saveProfileSettingsBtn").onclick = async () => {
  const fullName = document.getElementById("profModalName").value.trim() || userProfile.fullName;
  const currency = getDropdownValue("dd-profModalCurrency") || "₹";
  const upiId = document.getElementById("profModalUpi").value.trim();
  const customGemini = document.getElementById("profModalGeminiKey").value.trim();

  if (customGemini) localStorage.setItem("mediremind_custom_gemini_key", customGemini);
  else localStorage.removeItem("mediremind_custom_gemini_key");

  userProfile = {
    ...userProfile,
    fullName,
    currency,
    upiId,
    photoUrl: profModalAvatarDataUrl
  };

  await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });
  localStorage.setItem(`mediremind_prof_${currentUser.uid}`, JSON.stringify(userProfile));
  updateProfileUI();
  renderTable();
  window.closeProfileModal();
  showToast("Profile & Settings Saved!");
};

document.getElementById("signOutAccountBtn").onclick = async () => {
  window.closeProfileModal();
  dashboardBooted = false;
  initialSessionLockApplied = false;
  justCompletedSignup = false;
  await signOut(auth);
};

document.getElementById("openDeleteAllModalBtn").onclick = () => {
  window.closeProfileModal();
  const modal = document.getElementById("deleteAllDataModal");
  const pinInp = document.getElementById("wipePinInput");
  const phraseInp = document.getElementById("wipePhraseInput");
  const execBtn = document.getElementById("finalWipeExecuteBtn");

  pinInp.value = "";
  phraseInp.value = "";
  let secondsLeft = 5;
  execBtn.disabled = true;
  execBtn.style.opacity = "0.45";
  execBtn.style.cursor = "not-allowed";
  execBtn.innerText = `Wait ${secondsLeft}s...`;

  const validateWipeReady = () => {
    const pinOk = pinInp.value.trim() === getSecretPin();
    const phraseOk = phraseInp.value.trim() === "DELETE ALL DATA";
    const ready = secondsLeft <= 0 && pinOk && phraseOk;
    execBtn.disabled = !ready;
    execBtn.style.opacity = ready ? "1" : "0.45";
    execBtn.style.cursor = ready ? "pointer" : "not-allowed";
    execBtn.innerText = secondsLeft > 0 ? `Wait ${secondsLeft}s...` : "Erase Everything Now";
  };

  pinInp.oninput = validateWipeReady;
  phraseInp.oninput = validateWipeReady;

  clearInterval(wipeCountdownTimer);
  wipeCountdownTimer = setInterval(() => {
    secondsLeft--;
    validateWipeReady();
    if (secondsLeft <= 0) clearInterval(wipeCountdownTimer);
  }, 1000);

  modal.classList.add("show");
};

window.closeDeleteAllModal = () => {
  clearInterval(wipeCountdownTimer);
  document.getElementById("deleteAllDataModal").classList.remove("show");
};

document.getElementById("finalWipeExecuteBtn").onclick = async () => {
  const btn = document.getElementById("finalWipeExecuteBtn");
  btn.disabled = true;
  btn.innerText = "Wiping Cloud Data...";

  try {
    const wsSnap = await getDocs(collection(db, "users", currentUser.uid, "workspaces"));
    for (const wsDoc of wsSnap.docs) {
      const entriesSnap = await getDocs(collection(db, "users", currentUser.uid, "workspaces", wsDoc.id, "entries"));
      const batch = writeBatch(db);
      entriesSnap.forEach((eDoc) => batch.delete(eDoc.ref));
      batch.delete(wsDoc.ref);
      await batch.commit();
    }
    await deleteDoc(doc(db, "users", currentUser.uid));
    localStorage.removeItem(`mediremind_prof_${currentUser.uid}`);
    localStorage.removeItem(getChatStorageKey());
    localStorage.removeItem("mediremind_pin");

    window.closeDeleteAllModal();
    dashboardBooted = false;
    initialSessionLockApplied = false;
    showToast("All cloud data permanently erased.");
    await signOut(auth);
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
    btn.disabled = false;
  }
};

// ==================== 8. CARE PROFILES, ALARMS & CUSTOMIZATION ====================
function subscribeWorkspaces() {
  if (unsubWorkspaces) unsubWorkspaces();
  const q = query(collection(db, "users", currentUser.uid, "workspaces"), orderBy("createdAt", "asc"));
  unsubWorkspaces = onSnapshot(q, async (snap) => {
    workspaces = [];
    snap.forEach((d) => workspaces.push({ id: d.id, ...d.data() }));

    if (workspaces.length === 0) {
      if (!isCreatingDefaultWs) {
        isCreatingDefaultWs = true;
        try {
          const tpl = WORKSPACE_TEMPLATES.daily;
          await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
            name: "My Meds",
            templateKey: "daily",
            slots: tpl.slots,
            alarms: tpl.alarms,
            presets: tpl.presets,
            members: [userProfile?.fullName || "Me"],
            upiId: userProfile?.upiId || "",
            budgetLimit: 5000,
            createdAt: serverTimestamp()
          });
        } finally {
          isCreatingDefaultWs = false;
        }
      }
      return;
    }

    if (!activeWorkspaceId || !workspaces.some((w) => w.id === activeWorkspaceId)) {
      activeWorkspaceId = workspaces[0].id;
    }

    renderWorkspaceDropdown();
    loadActiveWorkspace();
  });
}

function getActiveWorkspace() {
  return workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
}

function renderWorkspaceDropdown() {
  const opts = workspaces.map((ws) => ({
    value: ws.id,
    label: ws.name
  }));
  renderCustomDropdown(
    "dd-workspaceSelect",
    opts,
    activeWorkspaceId,
    (newWsId) => {
      activeWorkspaceId = newWsId;
      loadActiveWorkspace();
    },
    "topbar-ws-btn"
  );
}

function loadActiveWorkspace() {
  const ws = getActiveWorkspace();
  if (!ws) return;

  document.getElementById("topbarSubtitle").innerText = `${userProfile.fullName} • ${ws.members.length} Caregiver(s)`;
  document.getElementById("editWsNameInput").value = ws.name || "";
  document.getElementById("editWsUpiInput").value = ws.upiId || "";

  renderDynamicEntryForm(ws);
  renderCustomizationTab(ws);
  startMedicineReminderScheduler();

  if (unsubEntries) unsubEntries();
  const q = query(
    collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"),
    orderBy("createdAt", "desc")
  );
  unsubEntries = onSnapshot(q, (snap) => {
    rawData = [];
    snap.forEach((d) => rawData.push({ docId: d.id, ...d.data() }));
    loadEntryForSelectedDate();
    renderTable();
  });
}

document.getElementById("openNewWsModalBtn").onclick = () => {
  renderCustomDropdown("dd-newWsTemplateSelect", TEMPLATE_OPTIONS, "daily");
  document.getElementById("newWsModal").classList.add("show");
};
window.closeNewWsModal = () => {
  document.getElementById("newWsModal").classList.remove("show");
};
document.getElementById("createNewWsSubmitBtn").onclick = async () => {
  if (isCreatingWs) return;
  const name = document.getElementById("newWsNameInput").value.trim();
  const tplKey = getDropdownValue("dd-newWsTemplateSelect") || "daily";
  const membersRaw = document.getElementById("newWsMembersInput").value.trim();
  if (!name) return showToast("Enter a patient/profile name", "error");

  isCreatingWs = true;
  const btn = document.getElementById("createNewWsSubmitBtn");
  btn.disabled = true;
  btn.innerText = "Creating...";

  try {
    const extra = membersRaw ? membersRaw.split(",").map((m) => m.trim()).filter(Boolean) : [];
    const members = Array.from(new Set([userProfile.fullName, ...extra]));
    const tpl = WORKSPACE_TEMPLATES[tplKey] || WORKSPACE_TEMPLATES.daily;

    const ref = await addDoc(collection(db, "users", currentUser.uid, "workspaces"), {
      name,
      templateKey: tplKey,
      slots: tpl.slots,
      alarms: tpl.alarms,
      presets: tpl.presets,
      members,
      upiId: userProfile.upiId || "",
      budgetLimit: 5000,
      createdAt: serverTimestamp()
    });

    activeWorkspaceId = ref.id;
    document.getElementById("newWsNameInput").value = "";
    document.getElementById("newWsMembersInput").value = "";
    window.closeNewWsModal();
    showToast(`Created "${name}"`);
  } finally {
    isCreatingWs = false;
    btn.disabled = false;
    btn.innerText = "Create Care Profile";
  }
};

function renderDynamicEntryForm(ws) {
  const slots = ws.slots || ["Morning", "Noon", "Afternoon", "Night"];
  const alarms = ws.alarms || DEFAULT_ALARM_TIMES;
  const presets = ws.presets || [];
  const members = ws.members || [userProfile.fullName];

  const defaultPayer =
    members.find((m) => m.toLowerCase() === (userProfile?.fullName || "").toLowerCase()) || members[0];
  const memberOpts = members.map((m) => ({ value: m, label: m }));

  renderCustomDropdown("dd-entryPaidBy", memberOpts, defaultPayer, () => {
    window.loadEntryForSelectedDate();
  });

  const splitSec = document.getElementById("entrySplitSection");
  const splitPillsWrap = document.getElementById("entrySplitPills");
  if (members.length > 1) {
    splitSec.classList.remove("hidden");
    splitPillsWrap.innerHTML = members
      .map(
        (m) => `<button type="button" class="split-pill active" data-member="${escapeHtml(m)}">✓ ${escapeHtml(m)}</button>`
      )
      .join("");
    splitPillsWrap.querySelectorAll(".split-pill").forEach((pill) => {
      pill.onclick = () => {
        const activeCount = splitPillsWrap.querySelectorAll(".split-pill.active").length;
        if (pill.classList.contains("active") && activeCount <= 1) {
          return showToast("Select at least 1 member", "error");
        }
        pill.classList.toggle("active");
        const mName = pill.dataset.member;
        pill.innerText = pill.classList.contains("active") ? `✓ ${mName}` : mName;
      };
    });
  } else {
    splitSec.classList.add("hidden");
  }

  const presetsBar = document.getElementById("quickPresetsBar");
  presetsBar.innerHTML = "";
  presets.forEach((p) => {
    const slotName = slots[p.slotIndex] || slots[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-chip";
    btn.innerText = `+ ${getCurrency()}${p.text}`;
    btn.onclick = () => {
      const targetInput = document.getElementById(`slot_input_${p.slotIndex}`);
      if (targetInput) {
        const curVal = targetInput.value.trim();
        targetInput.value = curVal ? `${curVal}, ${p.text}` : p.text;
        calcPreview();
        showToast(`Added ${p.text} to ${slotName}`);
      }
    };
    presetsBar.appendChild(btn);
  });

  const grid = document.getElementById("dynamicSlotsGrid");
  grid.innerHTML = "";
  slots.forEach((slotLabel, idx) => {
    const alarmTime = alarms[slotLabel] || DEFAULT_ALARM_TIMES[slotLabel] || "09:00";
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>
        <span>${escapeHtml(slotLabel)}</span>
        <span class="slot-time-pill">⏰ ${escapeHtml(alarmTime)}</span>
      </label>
      <input type="text" class="smart-input slot-val-input blur-sensitive" id="slot_input_${idx}" data-slot="${escapeHtml(slotLabel)}" placeholder="e.g. 30 (Paracetamol 500)" />
    `;
    grid.appendChild(field);
    attachSmartListener(field.querySelector("input"));
  });

  resetOthersContainer("othersContainer", []);
}

function renderCustomizationTab(ws) {
  const slots = ws.slots || [];
  const alarms = ws.alarms || DEFAULT_ALARM_TIMES;
  const presets = ws.presets || [];
  const members = ws.members || [];

  // Render Alarm Time Pickers for each Dose Slot
  const alarmWrap = document.getElementById("slotAlarmList");
  if (alarmWrap) {
    alarmWrap.innerHTML = "";
    slots.forEach((slotName) => {
      const tVal = alarms[slotName] || DEFAULT_ALARM_TIMES[slotName] || "09:00";
      const div = document.createElement("div");
      div.className = "field";
      div.style.marginBottom = "4px";
      div.innerHTML = `
        <label><span>💊 ${escapeHtml(slotName)}</span></label>
        <input type="time" class="slot-alarm-time-inp" data-slot="${escapeHtml(slotName)}" value="${escapeHtml(tVal)}" />
      `;
      alarmWrap.appendChild(div);
    });
  }

  const slotsWrap = document.getElementById("customSlotsChips");
  slotsWrap.innerHTML = "";
  slots.forEach((s, idx) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(s)} <button type="button" title="Remove">✕</button>`;
    chip.querySelector("button").onclick = async () => {
      if (slots.length <= 1) return showToast("Keep at least 1 dose slot", "error");
      const updatedSlots = slots.filter((_, i) => i !== idx);
      const updatedPresets = presets
        .filter((p) => p.slotIndex !== idx)
        .map((p) => ({ ...p, slotIndex: p.slotIndex > idx ? p.slotIndex - 1 : p.slotIndex }));
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
        slots: updatedSlots,
        presets: updatedPresets
      });
    };
    slotsWrap.appendChild(chip);
  });

  const slotOpts = slots.map((s, idx) => ({ value: String(idx), label: s }));
  renderCustomDropdown("dd-presetTargetSlot", slotOpts, "0");

  const presetsWrap = document.getElementById("customPresetsChips");
  presetsWrap.innerHTML = "";
  presets.forEach((p, idx) => {
    const sName = slots[p.slotIndex] || slots[0];
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `<span style="color:var(--cyan);">${escapeHtml(sName)}:</span> ${escapeHtml(p.text)} <button type="button">✕</button>`;
    chip.querySelector("button").onclick = async () => {
      const updated = presets.filter((_, i) => i !== idx);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { presets: updated });
    };
    presetsWrap.appendChild(chip);
  });

  const memWrap = document.getElementById("customMembersChips");
  memWrap.innerHTML = "";
  members.forEach((m) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(m)} <button type="button">✕</button>`;
    chip.querySelector("button").onclick = async () => {
      if (members.length <= 1) return showToast("Keep at least 1 caregiver", "error");
      const updated = members.filter((item) => item !== m);
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { members: updated });
    };
    memWrap.appendChild(chip);
  });
}

document.getElementById("saveAlarmTimesBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const newAlarms = { ...(ws.alarms || DEFAULT_ALARM_TIMES) };
  document.querySelectorAll(".slot-alarm-time-inp").forEach((inp) => {
    if (inp.value) newAlarms[inp.dataset.slot] = inp.value;
  });
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { alarms: newAlarms });
  showToast("Medicine Alarm Times Saved!");
};

document.getElementById("addSlotBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const inp = document.getElementById("newSlotInput");
  const val = inp.value.trim();
  if (!ws || !val) return;
  if ((ws.slots || []).length >= 6) return showToast("Maximum 6 slots allowed", "error");
  if ((ws.slots || []).includes(val)) return showToast("Slot already exists", "error");
  inp.value = "";
  const updatedAlarms = { ...(ws.alarms || DEFAULT_ALARM_TIMES), [val]: "10:00" };
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    slots: [...(ws.slots || []), val],
    alarms: updatedAlarms
  });
  showToast(`Added "${val}" dose slot`);
};

document.getElementById("addPresetBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const slotIndex = Number(getDropdownValue("dd-presetTargetSlot")) || 0;
  const val = document.getElementById("newPresetValue").value.trim();
  if (!ws || !val) return;
  document.getElementById("newPresetValue").value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    presets: [...(ws.presets || []), { slotIndex, text: val }]
  });
  showToast("Medicine preset chip added");
};

document.getElementById("addMemberBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const inp = document.getElementById("newMemberInput");
  const val = inp.value.trim();
  if (!ws || !val || (ws.members || []).includes(val)) return;
  inp.value = "";
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    members: [...(ws.members || []), val]
  });
  showToast(`Added caregiver ${val}`);
};

document.getElementById("saveWsInfoBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const name = document.getElementById("editWsNameInput").value.trim() || ws.name;
  const upiId = document.getElementById("editWsUpiInput").value.trim();
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { name, upiId });
  showToast("Care profile updated!");
};

document.getElementById("resetCustomizationsBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const ok = await openCustomDialog({
    title: "Reset Customization?",
    message: "This will reset your Dose Slots, Alarm Times, and Medicine Chips back to default. Your saved logs will NOT be deleted.",
    okText: "Reset Now",
    danger: false
  });
  if (!ok) return;

  const tpl = WORKSPACE_TEMPLATES[ws.templateKey] || WORKSPACE_TEMPLATES.daily;
  await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), {
    slots: tpl.slots,
    alarms: tpl.alarms,
    presets: tpl.presets
  });
  showToast("Schedule & alarms reset to default!");
};

document.getElementById("deleteWsBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  if (!ws || workspaces.length <= 1) return showToast("Cannot delete your only care profile", "error");
  const ok = await openCustomDialog({
    title: "Delete Care Profile",
    message: `Delete "${ws.name}" and all its medicine records permanently?`,
    okText: "Delete",
    danger: true
  });
  if (!ok) return;
  const entriesSnap = await getDocs(collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"));
  const batch = writeBatch(db);
  entriesSnap.forEach((eDoc) => batch.delete(eDoc.ref));
  batch.delete(doc(db, "users", currentUser.uid, "workspaces", ws.id));
  await batch.commit();
  activeWorkspaceId = null;
  showToast("Care profile deleted");
};

// ==================== 9. SMART INPUT & PER-CAREGIVER SYNC ====================
window.switchTab = (tabName, el) => {
  document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
  document.getElementById(`tab-${tabName}`).classList.add("active");
  el.classList.add("active");
  if (tabName === "analytics") renderCharts();
};

function getLocalTodayISO() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function syncDateIfNeeded(force = false) {
  const currentLocalDate = getLocalTodayISO();
  const dateInput = document.getElementById("entryDate");
  const changed = force || !dateInput.value || dateInput.value === lastSyncedDateStr;
  if (changed && dateInput.value !== currentLocalDate) {
    dateInput.value = currentLocalDate;
    loadEntryForSelectedDate();
  } else if (!dateInput.value) {
    dateInput.value = currentLocalDate;
  }
  lastSyncedDateStr = currentLocalDate;
}

function cleanItemText(str) {
  return String(str || "").replace(/\s*\(\s*\)/g, "").trim();
}

// Extracts ONLY the leading cost number of each comma-separated item (ignores 500mg/650mg inside parentheses!)
function extractAmount(str) {
  if (!str || str === "-") return 0;
  const items = String(str).split(",");
  let sum = 0;
  items.forEach((part) => {
    const cleanPart = part.trim();
    const leadMatch = cleanPart.match(/^(\d+(?:\.\d+)?)/);
    if (leadMatch) {
      sum += parseFloat(leadMatch[1]);
    }
  });
  return sum;
}

function attachSmartListener(input) {
  input.addEventListener("input", function (e) {
    const val = this.value;
    const pos = this.selectionStart;
    if (e.inputType === "insertText" && e.data === " ") {
      const beforeCursor = val.slice(0, pos);
      if (/^\s*\d+(\.\d+)?\s$/.test(beforeCursor) && !val.includes("(")) {
        const numPart = beforeCursor.trim();
        const afterCursor = val.slice(pos);
        this.value = numPart + " ()" + afterCursor;
        const newPos = numPart.length + 2;
        this.setSelectionRange(newPos, newPos);
      }
    }
    calcPreview();
  });
}

function calcPreview() {
  let total = 0;
  document.querySelectorAll(".slot-val-input").forEach((inp) => {
    total += extractAmount(inp.value);
  });
  const otherData = getDynamicOthers("othersContainer");
  total += otherData.total;
  document.getElementById("liveTotal").innerText = `${getCurrency()}${total}`;
}
window.calcPreview = calcPreview;

window.addOtherInput = (containerId, val = "") => {
  const container = document.getElementById(containerId);
  const div = document.createElement("div");
  div.className = "other-row";
  div.innerHTML = `
    <input type="text" class="other-item smart-input blur-sensitive" value="${escapeHtml(val)}" placeholder="e.g. 50 (SOS Med / Bandage)">
    <button type="button" class="btn-del-item" onclick="this.parentElement.remove(); calcPreview();">✕</button>
  `;
  container.appendChild(div);
  attachSmartListener(div.querySelector("input"));
};

function resetOthersContainer(containerId, items = []) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (items.length === 0) {
    const div = document.createElement("div");
    div.className = "other-row";
    div.innerHTML = `<input type="text" class="other-item smart-input blur-sensitive" placeholder="e.g. 40 (Glucose / SOS Med)">`;
    container.appendChild(div);
    attachSmartListener(div.querySelector("input"));
  } else {
    items.forEach((val, idx) => {
      if (idx === 0) {
        const div = document.createElement("div");
        div.className = "other-row";
        div.innerHTML = `<input type="text" class="other-item smart-input blur-sensitive" value="${escapeHtml(val)}">`;
        container.appendChild(div);
        attachSmartListener(div.querySelector("input"));
      } else {
        window.addOtherInput(containerId, val);
      }
    });
  }
}

function getDynamicOthers(containerId) {
  const inputs = document.querySelectorAll(`#${containerId} .other-item`);
  const items = [];
  let total = 0;
  inputs.forEach((inp) => {
    const val = cleanItemText(inp.value);
    if (val) {
      items.push(val);
      total += extractAmount(val);
    }
  });
  return { text: items.join(", "), total };
}

function formatDateWithDay(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return `${parts[2]}/${parts[1]}/${parts[0]} (${daysOfWeek[d.getDay()]})`;
}

function parseEntryDate(dateStr) {
  const datePart = String(dateStr || "").split(" ")[0];
  const parts = datePart.split("/");
  if (parts.length !== 3) return new Date(0);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

window.loadEntryForSelectedDate = () => {
  const ws = getActiveWorkspace();
  const isoDate = document.getElementById("entryDate").value;
  const banner = document.getElementById("existingSyncBanner");
  const saveBtn = document.getElementById("saveBtn");

  if (!ws || !isoDate) return;
  const dateFormatted = formatDateWithDay(isoDate);
  const members = ws.members || [userProfile.fullName];
  const selectedPayer = getDropdownValue("dd-entryPaidBy") || members[0];

  const existing = rawData.find(
    (r) => r.date === dateFormatted && (r.paidBy || members[0]) === selectedPayer
  );

  const slots = ws.slots || [];

  if (existing) {
    activeEditDocId = existing.docId;

    const activeSplitSet = new Set(existing.splitBetween || members);
    document.querySelectorAll("#entrySplitPills .split-pill").forEach((pill) => {
      const m = pill.dataset.member;
      const isOn = activeSplitSet.has(m);
      pill.classList.toggle("active", isOn);
      pill.innerText = isOn ? `✓ ${m}` : m;
    });

    slots.forEach((slotName, idx) => {
      const inp = document.getElementById(`slot_input_${idx}`);
      if (inp) {
        const val = existing.slotValues?.[slotName] || "";
        inp.value = val === "-" ? "" : val;
      }
    });

    if (existing.other && existing.other !== "-") {
      const parts = existing.other.split(",").map((p) => p.trim()).filter(Boolean);
      resetOthersContainer("othersContainer", parts);
    } else {
      resetOthersContainer("othersContainer", []);
    }

    document.getElementById("syncBannerText").innerText = `✏️ ${selectedPayer}'s schedule (${dateFormatted.split(" ")[0]}) loaded`;
    banner.classList.add("show");
    saveBtn.innerText = "Update Schedule →";
    saveBtn.classList.add("update-mode");
  } else {
    activeEditDocId = null;
    document.querySelectorAll("#entrySplitPills .split-pill").forEach((pill) => {
      pill.classList.add("active");
      pill.innerText = `✓ ${pill.dataset.member}`;
    });

    slots.forEach((_, idx) => {
      const inp = document.getElementById(`slot_input_${idx}`);
      if (inp) inp.value = "";
    });
    resetOthersContainer("othersContainer", []);

    banner.classList.remove("show");
    saveBtn.innerText = "Save Schedule →";
    saveBtn.classList.remove("update-mode");
  }
  calcPreview();
};

window.submitExpense = async () => {
  const ws = getActiveWorkspace();
  const btn = document.getElementById("saveBtn");
  const isoDate = document.getElementById("entryDate").value;
  if (!ws || !isoDate) return showToast("Select a valid date", "error");

  const dateFormatted = formatDateWithDay(isoDate);
  const paidBy = getDropdownValue("dd-entryPaidBy") || ws.members[0];
  const selectedSplitters = Array.from(document.querySelectorAll("#entrySplitPills .split-pill.active")).map(
    (p) => p.dataset.member
  );
  const splitBetween = selectedSplitters.length > 0 ? selectedSplitters : ws.members;

  const slotValues = {};
  let slotSum = 0;

  (ws.slots || []).forEach((slotName, idx) => {
    const inp = document.getElementById(`slot_input_${idx}`);
    const cleaned = cleanItemText(inp ? inp.value : "");
    slotValues[slotName] = cleaned;
    slotSum += extractAmount(cleaned);
  });

  const otherData = getDynamicOthers("othersContainer");
  const total = slotSum + otherData.total;

  if (total === 0 && Object.values(slotValues).every((v) => !v) && !otherData.text) {
    return showToast("Enter at least one medicine", "error");
  }

  const existingRecord = rawData.find(
    (r) => r.date === dateFormatted && (r.paidBy || ws.members[0]) === paidBy
  );
  const targetDocId = activeEditDocId || (existingRecord ? existingRecord.docId : null);

  btn.innerText = targetDocId ? "Updating..." : "Saving...";
  btn.disabled = true;

  const entryPayload = {
    date: dateFormatted,
    paidBy,
    splitBetween,
    slotValues,
    other: otherData.text,
    total,
    updatedAt: serverTimestamp()
  };

  try {
    if (targetDocId) {
      await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", targetDocId), entryPayload);
      showToast(`${paidBy}'s medicine schedule updated!`);
    } else {
      entryPayload.createdAt = serverTimestamp();
      await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"), entryPayload);
      showToast(`Saved ${paidBy}'s medicine schedule!`);
    }
  } catch (err) {
    showToast("Save failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    window.loadEntryForSelectedDate();
  }
};

// ==================== 10. GEMINI AI PRESCRIPTION & MEDICINE SCANNER ====================
function extractJsonObject(rawText) {
  if (!rawText) return null;
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

async function applyMultiItemAiExpense(parsed, { allowDateOverride = false } = {}) {
  const ws = getActiveWorkspace();
  if (!ws || !parsed || !Array.isArray(parsed.items)) return null;

  // Allow amount >= 0 so doctor prescriptions (without prices) AND pharmacy bills (with prices) both log cleanly!
  const validItems = parsed.items.filter((it) => String(it.name || "").trim().length > 0 && Number(it.amount ?? 0) >= 0);
  if (validItems.length === 0) return null;

  let isoDate = document.getElementById("entryDate").value || getLocalTodayISO();
  if (allowDateOverride && parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    isoDate = parsed.date;
    document.getElementById("entryDate").value = isoDate;
  }

  const dateFormatted = formatDateWithDay(isoDate);
  const slots = ws.slots || [];
  const members = ws.members || [userProfile.fullName];
  const currentDropdownPayer = getDropdownValue("dd-entryPaidBy") || members[0];

  const paidBy =
    members.find((m) => m.toLowerCase() === String(parsed.paidBy || "").toLowerCase()) ||
    currentDropdownPayer;

  let splitBetween = members;
  if (Array.isArray(parsed.splitBetween) && parsed.splitBetween.length > 0) {
    const matched = members.filter((m) =>
      parsed.splitBetween.some((p) => m.toLowerCase().includes(String(p).toLowerCase()))
    );
    if (matched.length > 0) splitBetween = matched;
  }

  const existing = rawData.find(
    (r) => r.date === dateFormatted && (r.paidBy || members[0]) === paidBy
  );

  const slotValues = existing ? { ...(existing.slotValues || {}) } : {};
  const extraItems = existing?.other ? existing.other.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const summaryParts = [];
  let addedNewCount = 0;

  validItems.forEach((it) => {
    const cleanName = String(it.name || "Medicine").replace(/[()]/g, "").trim();
    const amt = Number(it.amount) || 0;
    const formattedEntry = `${amt} (${cleanName})`;

    const matchedSlot = slots.find((s) => s.toLowerCase() === String(it.slot || "").toLowerCase());
    if (matchedSlot) {
      const existingList = slotValues[matchedSlot]
        ? slotValues[matchedSlot].split(",").map((x) => x.trim()).filter(Boolean)
        : [];
      if (!existingList.some((x) => x.toLowerCase() === formattedEntry.toLowerCase())) {
        existingList.push(formattedEntry);
        slotValues[matchedSlot] = existingList.join(", ");
        summaryParts.push(`${cleanName} (${getCurrency()}${amt}) → ${matchedSlot}`);
        addedNewCount++;
      }
    } else {
      if (!extraItems.some((x) => x.toLowerCase() === formattedEntry.toLowerCase())) {
        extraItems.push(formattedEntry);
        summaryParts.push(`${cleanName} (${getCurrency()}${amt}) → SOS/Other`);
        addedNewCount++;
      }
    }
  });

  if (addedNewCount === 0) {
    return `${paidBy} (${dateFormatted.split(" ")[0]}): Already scheduled (skipped duplicate)`;
  }

  let slotSum = 0;
  slots.forEach((s) => (slotSum += extractAmount(slotValues[s])));
  const otherText = extraItems.join(", ");
  const total = slotSum + extractAmount(otherText);

  const payload = {
    date: dateFormatted,
    paidBy,
    splitBetween: existing?.splitBetween || splitBetween,
    slotValues,
    other: otherText,
    total,
    updatedAt: serverTimestamp()
  };

  if (existing) {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", existing.docId), payload);
  } else {
    payload.createdAt = serverTimestamp();
    await addDoc(collection(db, "users", currentUser.uid, "workspaces", ws.id, "entries"), payload);
  }

  return `${paidBy} [${dateFormatted.split(" ")[0]}]: ${summaryParts.join(" | ")}`;
}

document.getElementById("aiSmartAddBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const input = document.getElementById("aiSmartText");
  const banner = document.getElementById("aiStatusBanner");
  const text = input.value.trim();
  if (!ws || !text) return;

  banner.innerText = "✨ MediRemind AI is scheduling medicines & slots...";
  banner.classList.remove("hidden");

  const selectedIso = document.getElementById("entryDate").value || getLocalTodayISO();
  const defaultPayer = getDropdownValue("dd-entryPaidBy") || ws.members[0];
  const prompt = `Extract medicine schedule & costs from this text (English, Bengali, or Hindi): "${text}".
Current selected date is ${selectedIso}. Only return a different "date" (YYYY-MM-DD) if explicitly stated in text; otherwise null.
Available dose slots: ${JSON.stringify(ws.slots)}.
Available family members: ${JSON.stringify(ws.members)}.
Default buyer if none specified: "${defaultPayer}".
If no price is mentioned, set "amount": 0. Map each medicine to its exact dose slot from ${JSON.stringify(ws.slots)} (or "Other").
Return ONLY valid JSON: {"date": null, "paidBy": string, "splitBetween": [string], "items": [{"name": string, "amount": number, "slot": string}]}.`;

  const { text: aiReply, error } = await runGeminiAI({
    parts: [{ text: prompt }],
    jsonMode: true
  });
  const parsed = extractJsonObject(aiReply);

  const summary = await applyMultiItemAiExpense(parsed, { allowDateOverride: true });
  if (summary) {
    input.value = "";
    banner.innerText = `✅ Scheduled (${summary})`;
    setTimeout(() => banner.classList.add("hidden"), 4500);
  } else {
    banner.innerText = error ? `⚠️ ${error}` : 'Try: "30 Paracetamol Morning & 50 Vitamin Night"';
  }
};

document.getElementById("aiReceiptFile").onchange = async (e) => {
  const file = e.target.files[0];
  const ws = getActiveWorkspace();
  if (!file || !ws) return;

  const banner = document.getElementById("aiStatusBanner");
  banner.innerText = "📷 Scanning prescription / medicine bill into selected date...";
  banner.classList.remove("hidden");

  try {
    const compressed = await compressImage(file, 960, 0.84);
    const defaultPayer = getDropdownValue("dd-entryPaidBy") || ws.members[0];
    const prompt = `Analyze this doctor prescription, medicine strip, or pharmacy bill carefully.
RULES:
1. Extract ONLY actual medicine/item names and their price ("amount": 0 if it's a prescription without prices). NEVER include "Total", "GST", "Tax", or "Cash".
2. Map each medicine to its recommended dose time slot from ${JSON.stringify(ws.slots)} (e.g., 1-0-1 means Morning and Night; if single meal/bill, group into the best matching slot). Use "Other" for bandages/tests.
3. Always set "date": null so the user's selected date is preserved.
Return ONLY valid JSON:
{"date": null, "paidBy": "${defaultPayer}", "splitBetween": ${JSON.stringify(ws.members)}, "items": [{"name": string, "amount": number, "slot": string}]}`;

    const { text: aiReply, error } = await runGeminiAI({
      parts: [
        { text: prompt },
        { inline_data: { mime_type: compressed.mime, data: compressed.base64 } }
      ],
      jsonMode: true
    });

    const parsed = extractJsonObject(aiReply);
    const summary = await applyMultiItemAiExpense(parsed, { allowDateOverride: false });
    if (summary) {
      banner.innerText = `✅ Medicines Scheduled (${summary})`;
      setTimeout(() => banner.classList.add("hidden"), 5000);
    } else {
      banner.innerText = error ? `⚠️ ${error}` : "Could not read medicines clearly. Try a sharper photo.";
    }
  } catch (err) {
    banner.innerText = "⚠️ Image processing failed.";
  }
  e.target.value = "";
};

document.getElementById("aiAuditTriggerBtn").onclick = async () => {
  const ws = getActiveWorkspace();
  const banner = document.getElementById("aiStatusBanner");
  if (!ws || currentActiveRows.length === 0) {
    banner.innerText = "Log some medicines in the active week first to run Dose Audit.";
    banner.classList.remove("hidden");
    return;
  }

  banner.innerText = "🩺 MediRemind AI is auditing dose schedule & caregiver split...";
  banner.classList.remove("hidden");

  const { text: advice, error } = await runGeminiAI({
    parts: [
      {
        text: `Audit this medicine schedule & cost log for "${ws.name}": ${buildLiveFinancialSnapshot()}. Give 2 short insights on dose timing coverage and medical cost split in simple English (max 50 words).`
      }
    ]
  });

  banner.innerText = advice ? `🩺 ${advice}` : `⚠️ ${error}`;
};

// ==================== 11. LOGBOOK TABLE, EDIT MODAL, CARE SPLIT & CHARTS ====================
window.openEdit = (docId) => {
  const ws = getActiveWorkspace();
  const item = rawData.find((r) => r.docId === docId);
  if (!ws || !item) return;

  document.getElementById("editDocId").value = item.docId;
  document.getElementById("editDate").value = item.date;

  const members = ws.members || [];
  const memberOpts = members.map((m) => ({ value: m, label: m }));
  renderCustomDropdown("dd-editPaidBy", memberOpts, item.paidBy || members[0]);

  const editSplitSec = document.getElementById("editSplitSection");
  const editSplitWrap = document.getElementById("editSplitPills");
  if (members.length > 1) {
    editSplitSec.classList.remove("hidden");
    const activeSet = new Set(item.splitBetween || members);
    editSplitWrap.innerHTML = members
      .map((m) => {
        const isOn = activeSet.has(m);
        return `<button type="button" class="split-pill ${isOn ? "active" : ""}" data-member="${escapeHtml(m)}">${isOn ? `✓ ${escapeHtml(m)}` : escapeHtml(m)}</button>`;
      })
      .join("");
    editSplitWrap.querySelectorAll(".split-pill").forEach((pill) => {
      pill.onclick = () => {
        const activeCount = editSplitWrap.querySelectorAll(".split-pill.active").length;
        if (pill.classList.contains("active") && activeCount <= 1) return;
        pill.classList.toggle("active");
        const mName = pill.dataset.member;
        pill.innerText = pill.classList.contains("active") ? `✓ ${mName}` : mName;
      };
    });
  } else {
    editSplitSec.classList.add("hidden");
  }

  const grid = document.getElementById("editDynamicSlotsGrid");
  grid.innerHTML = "";
  (ws.slots || []).forEach((slotName) => {
    const val = item.slotValues?.[slotName] || "";
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>${escapeHtml(slotName)}</label>
      <input type="text" class="smart-input edit-slot-inp" data-slot="${escapeHtml(slotName)}" value="${escapeHtml(val === "-" ? "" : val)}" />
    `;
    grid.appendChild(field);
    attachSmartListener(field.querySelector("input"));
  });

  const editCont = document.getElementById("editOthersContainer");
  editCont.innerHTML = "";
  if (item.other && item.other !== "-") {
    item.other.split(",").forEach((p) => window.addOtherInput("editOthersContainer", p.trim()));
  } else {
    window.addOtherInput("editOthersContainer");
  }

  document.getElementById("editModal").classList.add("show");
};

window.closeModal = () => {
  document.getElementById("editModal").classList.remove("show");
};

window.saveEdit = async () => {
  const ws = getActiveWorkspace();
  const btn = document.getElementById("updateModalBtn");
  const docId = document.getElementById("editDocId").value;
  if (!ws || !docId) return;

  btn.innerText = "Updating...";
  btn.disabled = true;

  const paidBy = getDropdownValue("dd-editPaidBy") || ws.members[0];
  const selectedSplitters = Array.from(document.querySelectorAll("#editSplitPills .split-pill.active")).map(
    (p) => p.dataset.member
  );
  const splitBetween = selectedSplitters.length > 0 ? selectedSplitters : ws.members;

  const slotValues = {};
  let slotSum = 0;

  document.querySelectorAll(".edit-slot-inp").forEach((inp) => {
    const sName = inp.dataset.slot;
    const cleaned = cleanItemText(inp.value);
    slotValues[sName] = cleaned;
    slotSum += extractAmount(cleaned);
  });

  const otherData = getDynamicOthers("editOthersContainer");
  const total = slotSum + otherData.total;

  try {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", docId), {
      paidBy,
      splitBetween,
      slotValues,
      other: otherData.text,
      total,
      updatedAt: serverTimestamp()
    });
    window.closeModal();
    showToast("Medicine schedule updated!");
  } catch (err) {
    showToast("Update failed: " + err.message, "error");
  } finally {
    btn.innerText = "Update";
    btn.disabled = false;
  }
};

window.deleteSingleRow = async (docId) => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const ok = await openCustomDialog({
    title: "Delete Record",
    message: "Delete this medicine schedule record permanently?",
    okText: "Delete",
    danger: true
  });
  if (!ok) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", docId));
  showToast("Record deleted");
};

window.deleteCurrentWeek = async (docIds) => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const ok = await openCustomDialog({
    title: "Delete Active Week",
    message: `Delete all ${docIds.length} medicine records in this active week?`,
    okText: "Delete Week",
    danger: true
  });
  if (!ok) return;
  const batch = writeBatch(db);
  docIds.forEach((id) => batch.delete(doc(db, "users", currentUser.uid, "workspaces", ws.id, "entries", id)));
  await batch.commit();
  showToast("Week records deleted");
};

window.clearFilters = () => {
  document.getElementById("searchDate").value = "";
  document.getElementById("searchText").value = "";
  renderTable();
};

function getCalendarWeekRange(offset) {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1) + offset * 7;
  const start = new Date(now.getFullYear(), now.getMonth(), diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatDateShort(d) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

window.prevWeek = () => { weekOffset--; renderTable(); };
window.nextWeek = () => { weekOffset++; renderTable(); };
window.resetToCurrentWeek = () => { weekOffset = 0; window.clearFilters(); };

function renderTable() {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const cur = getCurrency();
  const slots = ws.slots || [];

  const thead = document.getElementById("ledgerTableHead");
  thead.innerHTML = `<tr>
    <th>Date & Day</th>
    <th>Bought By</th>
    ${slots.map((s) => `<th>${escapeHtml(s)}</th>`).join("")}
    <th>SOS / Extra</th>
    <th>Cost</th>
    <th>Actions</th>
  </tr>`;

  const tbody = document.getElementById("tableBody");
  const centerBtn = document.getElementById("centerWeekBtn");
  const weekDelCont = document.getElementById("weekDeleteContainer");
  const sDate = document.getElementById("searchDate").value;
  const sText = document.getElementById("searchText").value.toLowerCase().trim();

  tbody.innerHTML = "";
  const isSearchActive = sDate || sText;
  let displayRows = [];

  if (isSearchActive) {
    let filtered = [...rawData];
    if (sDate) {
      const parts = sDate.split("-");
      const targetDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      filtered = filtered.filter((r) => r.date.startsWith(targetDate));
    }
    if (sText) {
      filtered = filtered.filter((r) => {
        const slotBlob = Object.values(r.slotValues || {}).join(" ").toLowerCase();
        return (
          r.date.toLowerCase().includes(sText) ||
          (r.paidBy || "").toLowerCase().includes(sText) ||
          slotBlob.includes(sText) ||
          (r.other || "").toLowerCase().includes(sText)
        );
      });
    }
    centerBtn.innerHTML = `<span style="font-size:12px; color:var(--primary); font-weight:700;">Results (${filtered.length})</span>`;
    displayRows = filtered;
  } else {
    const range = getCalendarWeekRange(weekOffset);
    const rangeText = `${formatDateShort(range.start)} - ${formatDateShort(range.end)}`;
    if (weekOffset === 0) {
      centerBtn.innerHTML = `<strong style="font-size:12px; color:var(--primary);">Current Week</strong><br><small style="color:var(--muted); font-size:10px;">${rangeText}</small>`;
    } else {
      centerBtn.innerHTML = `<button class="back-pill" onclick="resetToCurrentWeek()">Current Week (${rangeText})</button>`;
    }

    displayRows = rawData.filter((r) => {
      const d = parseEntryDate(r.date);
      return d >= range.start && d <= range.end;
    });
  }

  displayRows.sort((a, b) => parseEntryDate(a.date) - parseEntryDate(b.date));
  currentActiveRows = displayRows;

  const now = new Date();
  const monthTotal = rawData.reduce((acc, r) => {
    const d = parseEntryDate(r.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() ? acc + (Number(r.total) || 0) : acc;
  }, 0);
  document.getElementById("statMonth").innerText = `${cur}${monthTotal}`;
  updateBudgetUI(monthTotal, ws);

  const colSpan = slots.length + 5;
  if (displayRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding:18px; color:var(--muted);">No medicine logs found for this period.</td></tr>`;
    updateStats(0, [], ws);
    renderSmartSplit(ws, []);
    weekDelCont.innerHTML = "";
    return;
  }

  let viewTotal = 0;
  const currentDocIds = [];
  const uniqueDates = new Set();

  displayRows.forEach((r) => {
    currentDocIds.push(r.docId);
    viewTotal += Number(r.total) || 0;
    uniqueDates.add(r.date.split(" ")[0]);

    const slotCells = slots
      .map((s) => `<td>${escapeHtml(r.slotValues?.[s] || "-")}</td>`)
      .join("");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="date-tag">${escapeHtml(r.date)}</span></td>
      <td style="color:var(--cyan); font-weight:600;">${escapeHtml(r.paidBy || ws.members[0])}</td>
      ${slotCells}
      <td>${escapeHtml(r.other || "-")}</td>
      <td><span class="amt-tag">${cur}${r.total}</span></td>
      <td>
        <button class="act-btn" style="background:rgba(34,211,238,0.18); color:#22d3ee;" onclick="openEdit('${r.docId}')">✏️</button>
        <button class="act-btn" style="background:rgba(251,113,133,0.16); color:var(--rose);" onclick="deleteSingleRow('${r.docId}')">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (displayRows.length > 0 && !isSearchActive) {
    weekDelCont.innerHTML = `<button class="btn-del-wk" onclick='deleteCurrentWeek(${JSON.stringify(currentDocIds)})'>🗑️ Delete Week</button>`;
  } else {
    weekDelCont.innerHTML = "";
  }

  updateStats(viewTotal, displayRows, ws, uniqueDates.size);
  renderSmartSplit(ws, displayRows);
  if (document.getElementById("tab-analytics").classList.contains("active")) renderCharts();
}
window.renderTable = renderTable;

function updateStats(total, rows, ws, loggedDayCount = 0) {
  const cur = getCurrency();
  const members = ws.members || [];
  document.getElementById("statTotal").innerText = `${cur}${total}`;
  document.getElementById("statAvg").innerText = loggedDayCount > 0 ? `${cur}${Math.round(total / loggedDayCount)}` : `${cur}0`;
  document.getElementById("statEntries").innerText = `${loggedDayCount} Days`;

  const shareLbl = document.getElementById("statShareLabel");
  const perMemEl = document.getElementById("statPerMember");

  if (members.length <= 1) {
    if (shareLbl) shareLbl.innerText = "My Med Share";
    perMemEl.innerText = `${cur}${Math.round(total)}`;
  } else {
    const stats = computeMemberLedgerStats(ws, rows);
    const myName =
      members.find((m) => m.toLowerCase() === (userProfile?.fullName || "").toLowerCase()) || members[0];
    if (shareLbl) shareLbl.innerText = `${myName}'s Share`;
    perMemEl.innerText = `${cur}${Math.round(stats.shareByMember[myName] || 0)}`;
  }
}

function renderSmartSplit(ws, rows) {
  const cur = getCurrency();
  const members = ws.members || [];
  const balWrap = document.getElementById("memberBalancesWrap");
  const transWrap = document.getElementById("settlementTransfersWrap");

  const { paidByMember, shareByMember, netBalances, transfers } = computeMemberLedgerStats(ws, rows);

  balWrap.innerHTML = "";
  members.forEach((m) => {
    const net = netBalances[m];
    let badgeText = `Settled ${cur}0`;
    let badgeColor = "var(--cyan)";
    if (net > 0.5) {
      badgeText = `Gets ${cur}${Math.round(net)}`;
      badgeColor = "var(--primary)";
    } else if (net < -0.5) {
      badgeText = `Owes ${cur}${Math.round(Math.abs(net))}`;
      badgeColor = "var(--rose)";
    }

    const row = document.createElement("div");
    row.className = "split-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(m)}</strong>
        <span style="display:block; font-size:10px; color:var(--muted);">
          Paid ${cur}${Math.round(paidByMember[m])} • Share ${cur}${Math.round(shareByMember[m])}
        </span>
      </div>
      <span style="font-weight:800; color:${badgeColor};">${badgeText}</span>
    `;
    balWrap.appendChild(row);
  });

  transWrap.innerHTML = "";
  if (transfers.length === 0) {
    transWrap.innerHTML = `<p style="font-size:12px; color:var(--muted);">All settled up! No pending caregiver reimbursements.</p>`;
  } else {
    const upiId = ws.upiId || userProfile.upiId || "";
    transfers.forEach((tr) => {
      const upiUrl = upiId
        ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(tr.to)}&am=${tr.amount}&cu=INR`
        : "";

      const row = document.createElement("div");
      row.className = "split-row";
      row.innerHTML = `
        <div>
          <strong style="color:var(--rose);">${escapeHtml(tr.from)}</strong> →
          <strong style="color:var(--primary);">${escapeHtml(tr.to)}</strong>
          <span style="margin-left:6px; font-weight:800;">${cur}${tr.amount}</span>
        </div>
        ${
          upiUrl
            ? `<div style="display:flex; gap:6px;">
                 <a href="${upiUrl}" class="btn-primary" style="padding:6px 10px; font-size:11px; text-decoration:none;">Pay UPI</a>
                 <button type="button" class="btn-ghost qr-open-btn" style="padding:6px 9px; font-size:11px;">QR</button>
               </div>`
            : `<span style="font-size:10px; color:var(--muted);">Add UPI ID below</span>`
        }
      `;
      const qrBtn = row.querySelector(".qr-open-btn");
      if (qrBtn) {
        qrBtn.onclick = () => {
          document.getElementById("qrModalTitle").innerText = `${tr.from} → ${tr.to} (${cur}${tr.amount})`;
          document.getElementById("qrModalUpiLabel").innerText = `UPI: ${upiId}`;
          document.getElementById("qrModalImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUrl)}`;
          document.getElementById("qrModal").classList.add("show");
        };
      }
      transWrap.appendChild(row);
    });
  }
}

window.setMonthlyBudget = async () => {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const val = await openCustomDialog({
    title: "Monthly Medicine Budget",
    message: `Set your target monthly medicine spending limit (${getCurrency()}):`,
    showInput: true,
    inputType: "number",
    defaultValue: String(ws.budgetLimit || 5000),
    okText: "Save Limit"
  });
  if (val && !isNaN(val) && Number(val) > 0) {
    await updateDoc(doc(db, "users", currentUser.uid, "workspaces", ws.id), { budgetLimit: Number(val) });
    showToast(`Monthly med budget set to ${getCurrency()}${val}`);
  }
};

function updateBudgetUI(monthSpent, ws) {
  const cur = getCurrency();
  const limit = Number(ws.budgetLimit) || 5000;
  const pct = Math.min((monthSpent / limit) * 100, 100);
  const rem = Math.max(limit - monthSpent, 0);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(daysInMonth - now.getDate() + 1, 1);
  const safeDaily = Math.round(rem / daysLeft);

  const bar = document.getElementById("budgetBarFill");
  bar.style.width = `${pct}%`;
  bar.style.background = pct > 90 ? "var(--rose)" : "linear-gradient(90deg, #22d3ee, #10b981)";

  document.getElementById("budgetSpentLbl").innerText = `Spent: ${cur}${monthSpent}`;
  document.getElementById("budgetLimitLbl").innerText = `Limit: ${cur}${limit}`;
  document.getElementById("budgetRemLbl").innerText = `Remaining: ${cur}${rem}`;
  document.getElementById("safeDailyLbl").innerText = `Safe Daily: ${cur}${safeDaily}/day`;
}

function renderCharts() {
  const ws = getActiveWorkspace();
  if (!ws) return;
  const slots = ws.slots || [];
  const slotTotals = slots.map(() => 0);
  let otherSum = 0;

  const labels = [];
  const totals = [];

  currentActiveRows.forEach((r) => {
    slots.forEach((s, idx) => {
      slotTotals[idx] += extractAmount(r.slotValues?.[s]);
    });
    otherSum += extractAmount(r.other);
    labels.push(r.date.split(" ")[0].slice(0, 5));
    totals.push(Number(r.total) || 0);
  });

  if (catChartInstance) catChartInstance.destroy();
  catChartInstance = new Chart(document.getElementById("catChart"), {
    type: "doughnut",
    data: {
      labels: [...slots, "SOS/Other"],
      datasets: [
        {
          data: [...slotTotals, otherSum],
          backgroundColor: ["#10b981", "#22d3ee", "#34d399", "#fbbf24", "#818cf8", "#ec4899", "#fb7185"],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right", labels: { color: "#f8fafc", font: { size: 11 } } } }
    }
  });

  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(document.getElementById("trendChart"), {
    type: "bar",
    data: {
      labels: labels.length ? labels : ["No Data"],
      datasets: [
        {
          label: `Med Spend (${getCurrency()})`,
          data: totals.length ? totals : [0],
          backgroundColor: "#10b981",
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// ==================== 12. EXCEL/CSV, WHATSAPP SHARE & DOCTOR PDF REPORT ====================
window.exportCSV = async () => {
  const ws = getActiveWorkspace();
  if (!ws || rawData.length === 0) return showToast("No records available to export", "error");

  const slots = ws.slots || [];
  const headers = ["Date", "Bought By", ...slots, "SOS/Other", "Total Cost"];
  const escapeCsv = (val) => `"${String(val || "-").replace(/"/g, '""')}"`;

  const lines = [headers.map(escapeCsv).join(",")];
  let grandTotal = 0;

  rawData.forEach((r) => {
    grandTotal += Number(r.total) || 0;
    const row = [
      r.date,
      r.paidBy || ws.members[0],
      ...slots.map((s) => r.slotValues?.[s] || "-"),
      r.other || "-",
      r.total
    ];
    lines.push(row.map(escapeCsv).join(","));
  });

  const footer = new Array(slots.length + 2).fill("");
  footer.push("TOTAL", grandTotal);
  lines.push(footer.map(escapeCsv).join(","));

  const fileName = `${ws.name.replace(/\s+/g, "_")}_MediRemind_${getLocalTodayISO()}.csv`;
  const csvBlob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const csvFile = new File([csvBlob], fileName, { type: "text/csv" });

  if (navigator.canShare && navigator.canShare({ files: [csvFile] })) {
    try {
      await navigator.share({ files: [csvFile], title: `${ws.name} Medicine Log` });
      return;
    } catch (e) {}
  }

  const a = document.createElement("a");
  a.href = URL.createObjectURL(csvBlob);
  a.download = fileName;
  a.click();
  showToast("Medicine Log CSV downloaded!");
};

window.shareWeeklyReport = () => {
  const ws = getActiveWorkspace();
  if (!ws || currentActiveRows.length === 0) return showToast("No records in active week to share", "error");
  const cur = getCurrency();
  let total = 0;
  const lines = [`*💊 MediRemind AI — ${ws.name}*`, ""];
  currentActiveRows.forEach((r) => {
    total += Number(r.total) || 0;
    lines.push(`• ${r.date} (${r.paidBy || ws.members[0]}): *${cur}${r.total}*`);
  });
  lines.push("", `*Total Med Spend: ${cur}${total}*`);
  const text = lines.join("\n");

  if (navigator.clipboard) navigator.clipboard.writeText(text);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  showToast("Summary copied & opening WhatsApp...");
};

window.exportPDF = async () => {
  const ws = getActiveWorkspace();
  if (!ws || currentActiveRows.length === 0) return showToast("No records available to export", "error");

  showToast("Generating Doctor / Care PDF report...");
  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF();
  const slots = ws.slots || [];

  docPdf.setFontSize(16);
  docPdf.setTextColor(16, 185, 129);
  docPdf.text(`MEDIREMIND AI — ${ws.name.toUpperCase()}`, 14, 18);

  docPdf.setFontSize(10);
  docPdf.setTextColor(100);
  docPdf.text(`Caregiver: ${userProfile.fullName} | Generated: ${new Date().toLocaleDateString("en-IN")}`, 14, 25);

  let grandTotal = 0;
  const tableRows = currentActiveRows.map((r) => {
    grandTotal += Number(r.total) || 0;
    return [
      r.date,
      r.paidBy || ws.members[0],
      ...slots.map((s) => r.slotValues?.[s] || "-"),
      r.other || "-",
      `${r.total}`
    ];
  });

  const footerRow = new Array(slots.length + 2).fill("");
  footerRow.push("TOTAL MED COST", `${grandTotal}`);
  tableRows.push(footerRow);

  docPdf.autoTable({
    startY: 32,
    head: [["Date & Day", "Bought By", ...slots, "SOS/Extra", "Cost"]],
    body: tableRows,
    theme: "grid",
    headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 3 }
  });

  const fileName = `${ws.name.replace(/\s+/g, "_")}_MediRemind_${getLocalTodayISO()}.pdf`;
  const pdfBlob = docPdf.output("blob");
  const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });

  if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
    try {
      await navigator.share({ files: [pdfFile], title: `${ws.name} Medicine Schedule Report` });
      return;
    } catch (e) {}
  }

  docPdf.save(fileName);
};

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}
