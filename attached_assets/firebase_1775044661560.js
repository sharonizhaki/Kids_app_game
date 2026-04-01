import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDC0GADxe3qv6uv6s6fGR3O7_lL9iHl4ag",
  authDomain: "kidssapp-izhaki.firebaseapp.com",
  databaseURL: "https://kidssapp-izhaki-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kidssapp-izhaki",
  storageBucket: "kidssapp-izhaki.firebasestorage.app",
  messagingSenderId: "663906163746",
  appId: "1:663906163746:web:a4f66772a2ae0dedc47e7b"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
