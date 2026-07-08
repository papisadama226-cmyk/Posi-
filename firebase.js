/**
 * firebase.js
 * Initialisation Firebase pour Posi 🔥🍀
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

// Initialisation Firebase
firebase.initializeApp(firebaseConfig);

// Services Firebase
const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebase.database();
const storage = firebase.storage();

// Persistance de connexion
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
  console.warn(err);
});

// Firebase Messaging (optionnel)
let messaging = null;

try {
  if (
    firebase.messaging &&
    firebase.messaging.isSupported &&
    firebase.messaging.isSupported()
  ) {
    messaging = firebase.messaging();
  }
} catch (e) {
  console.warn("Firebase Messaging indisponible.", e);
}
