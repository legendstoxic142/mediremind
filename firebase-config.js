// firebase-config.js — MediRemind AI Pro Max Engine
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: ["AIzaSyA7MXYekux", "ZGkcTgpeSWDTrzTc2qVfxnh0"].join(""),
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

// Built-in Gemini API Key split into 4 parts
const GEMINI_PART_1 = "AQ.Ab8RN6L8dUU";
const GEMINI_PART_2 = "ZhzK6_555b94P";
const GEMINI_PART_3 = "uasdUE2PIZLEj";
const GEMINI_PART_4 = "rR4CtKL1tEnpQ";

function getBuiltInGeminiKey() {
  return (GEMINI_PART_1 + GEMINI_PART_2 + GEMINI_PART_3 + GEMINI_PART_4).trim();
}

// Universal Gemini AI Caller with Web Search Grounding & Auto-Fallback
export async function runGeminiAI({ contents, parts, jsonMode = false, useSearch = false }) {
  const apiKey = getBuiltInGeminiKey();
  const models = [
    "gemini-2.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest"
  ];
  const payloadContents = contents || [{ role: "user", parts }];

  const attemptModes = useSearch ? [true, false] : [false];
  let lastError = "";

  for (const searchFlag of attemptModes) {
    for (const model of models) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      const bodyObj = { contents: payloadContents };
      if (searchFlag) {
        bodyObj.tools = [{ google_search: {} }];
      }
      if (jsonMode && !searchFlag) {
        bodyObj.generationConfig = { responseMimeType: "application/json" };
      }

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
        lastError = err.name === "AbortError" ? "Timeout, retrying..." : err.message;
      }
    }
  }

  return { text: null, error: lastError || "AI connection failed" };
}
