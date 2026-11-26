// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: ["AIzaSyA7MXYekux", "ZGkcTgpeSWDTrzTc2qVfxnh0"].join(""),
  authDomain: "walletiq-9ab31.firebaseapp.com",
  projectId: "walletiq-9ab31",
  storageBucket: "walletiq-9ab31.firebasestorage.app",
  messagingSenderId: "1023816664757",
  appId: "1:1023816664757:web:f258a708f13005f6bba0fc"
};

const DEFAULT_GEMINI_KEY = [
  "AQ.Ab8RN6Jg_dNy",
  "LGkvevWa_BXiwYS",
  "FbJzVyn0oM6a4Q8",
  "3F5FlB9A"
].join("");

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export async function runGeminiAI({ parts = [], jsonMode = false }) {
  const savedKey = localStorage.getItem("mediremind_gemini_key");
  const apiKey = (savedKey && savedKey.trim()) || DEFAULT_GEMINI_KEY;

  if (!apiKey) {
    return { text: null, error: "API key missing. Add key in Settings." };
  }

  const payload = { contents: [{ role: "user", parts }] };
  if (jsonMode) {
    payload.generationConfig = { responseMimeType: "application/json" };
  }

  const isVertexKey = apiKey.startsWith("AQ.");
  const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  let lastErr = "AI service unavailable.";

  for (const model of models) {
    const endpoints = isVertexKey
      ? [
          `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
        ]
      : [
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
        ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          lastErr = data?.error?.message || `HTTP ${res.status}`;
          continue;
        }
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (reply) return { text: reply, error: null };
      } catch (e) {
        lastErr = e.message || "Network error";
      }
    }
  }

  return { text: null, error: lastErr };
}
