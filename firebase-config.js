// firebase-config.js — WalletIQ Firebase & Gemini AI Engine
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7MXYekuxZGkcTgpeSWDTrzTc2qVfxnh0",
  authDomain: "walletiq-9ab31.firebaseapp.com",
  projectId: "walletiq-9ab31",
  storageBucket: "walletiq-9ab31.firebasestorage.app",
  messagingSenderId: "1023816664757",
  appId: "1:1023816664757:web:f258a708f13005f6bba0fc"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

// Gemini API Key split into 4 parts
const GEMINI_PART_1 = "AQ.Ab8RN6L8dUU";
const GEMINI_PART_2 = "ZhzK6_555b94P";
const GEMINI_PART_3 = "uasdUE2PIZLEj";
const GEMINI_PART_4 = "rR4CtKL1tEnpQ";

export function getActiveGeminiKey() {
  const customKey = localStorage.getItem("walletiq_custom_gemini_key");
  if (customKey && customKey.trim().length > 15) {
    return customKey.trim();
  }
  return (GEMINI_PART_1 + GEMINI_PART_2 + GEMINI_PART_3 + GEMINI_PART_4).trim();
}

// Universal Gemini AI Caller with Auto-Fallback & Timeout
export async function runGeminiAI({ contents, parts, jsonMode = false }) {
  const apiKey = getActiveGeminiKey();
  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-flash-lite-latest",
    "gemini-flash-latest"
  ];
  const payloadContents = contents || [{ role: "user", parts }];
  const bodyObj = { contents: payloadContents };

  if (jsonMode) {
    bodyObj.generationConfig = { responseMimeType: "application/json" };
  }

  let lastError = "";
  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": apiKey
          },
          body: JSON.stringify(bodyObj),
          signal: controller.signal
        }
      );
      clearTimeout(timer);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (res.ok && text) {
        return { text: text.trim(), error: null };
      }
      if (data.error?.message) lastError = data.error.message;
    } catch (err) {
      clearTimeout(timer);
      lastError = err.name === "AbortError" ? "Timeout, trying backup..." : err.message;
    }
  }
  return { text: null, error: lastError || "AI connection failed" };
}
