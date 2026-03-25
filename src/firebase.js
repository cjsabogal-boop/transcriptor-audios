import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCzFPfxpT6gBPyHWHk42Hmt1FbRbvnyidQ",
  authDomain: "estudios-evange-2026.firebaseapp.com",
  projectId: "estudios-evange-2026",
  storageBucket: "estudios-evange-2026.firebasestorage.app",
  messagingSenderId: "373339974140",
  appId: "1:373339974140:web:dd95411b6f262820d86a79"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
