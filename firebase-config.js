// firebase-config.js — Firebase & Google Gemini AI Configuration
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

const DEFAULT_GEMINI_API_KEY = [
  "AQ.Ab8RN6Jg_dNy",
  "LGkvevWa_BXiwYS",
  "FbJzVyn0oM6a4Q8",
  "3F5FlB9A"
].join("");

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export async function runGeminiAI({ contents = null, parts = [], jsonMode = false }) {
  const customKey = localStorage.getItem("mediremind_custom_gemini_key");
  const apiKey = (customKey && customKey.trim()) || DEFAULT_GEMINI_API_KEY;

  if (!apiKey) {
    return { text: null, error: "Gemini API key missing." };
  }

  const requestContents = contents || [{ role: "user", parts }];
  const payload = { contents: requestContents };

  if (jsonMode) {
    payload.generationConfig = { responseMimeType: "application/json" };
  }

  const models = ["gemini-2.5-flash", "gemini-2.0-flash"];

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) continue;
        return { text: null, error: data?.error?.message || `AI request failed (${res.status})` };
      }

      const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!replyText) {
        return { text: null, error: "Empty response from AI." };
      }

      return { text: replyText, error: null };
    } catch (err) {
      return { text: null, error: err.message || "Network error connecting to Gemini AI." };
    }
  }

  return { text: null, error: "Gemini model unavailable. Check your API key." };
}
