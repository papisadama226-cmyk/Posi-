/**
 * firebase.js
 * ---------------------------------------------------------
 * Initialisation Firebase pour Posi 🔥🍀.
 *
 * ⚠️ IMPORTANT : remplace les valeurs ci-dessous par celles de
 * TON projet Firebase (Console Firebase → Paramètres du projet
 * → Vos applications → Config SDK).
 *
 * Ces clés "apiKey" côté client ne sont PAS secrètes : la vraie
 * sécurité vient des règles Firestore / Realtime Database et de
 * Firebase Authentication (voir README.md).
 * ---------------------------------------------------------
 */

const firebaseConfig = {
  apiKey: "AIzaSyCx6jNHs-NHDuux4V_QDY1wOASMGx3s9Sc",
  authDomain: "posi-1b3cd.firebaseapp.com",
  databaseURL: "https://posi-1b3cd-default-rtdb.firebaseio.com",
  projectId: "posi-1b3cd",
  storageBucket: "posi-1b3cd.firebasestorage.app",
  messagingSenderId: "9535930573",
  appId: "1:9535930573:web:d952f2ae17dc13297f6984",
  measurementId: "G-PWQKWCXCGT"
};

// Initialisation de l'app Firebase (SDK "compat" pour rester en JS vanilla)
firebase.initializeApp(firebaseConfig);

// Références globales réutilisées dans app.js
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();

// Persistance de session locale (reste connecté après fermeture du navigateur)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
  console.warn("Impossible de définir la persistance Auth :", err);
});
