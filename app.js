/**
 * app.js — Logique principale de Posi 🔥🍀
 * ---------------------------------------------------------
 * Modules :
 *  - Auth (pseudo/prénom+nom via Firebase Anonymous Auth)
 *  - Profils membres (Firestore: /users/{uid})
 *  - Géolocalisation en direct (Realtime DB: /positions/{uid})
 *  - Carte Leaflet + marqueurs animés
 *  - Chat (Firestore: /messages)
 *  - Dashboard (stats + liste des membres)
 *  - Notifications "nouveau membre" + message de bienvenue
 * ---------------------------------------------------------
 */

(() => {
  "use strict";

  /* ============== ÉTAT GLOBAL ============== */
  const state = {
    user: null,          // objet Firebase Auth
    profile: null,       // doc Firestore /users/{uid}
    map: null,
    markers: {},         // uid -> L.marker
    lastPos: {},         // uid -> {lat,lng,ts} pour calcul vitesse/direction
    watchId: null,
    updateTimer: null,
    membersCache: {},    // uid -> profil
    positionsCache: {},  // uid -> position
    currentView: "map",
  };

  /* ============== UTILITAIRES DOM ============== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showToast(text, ms = 4000) {
    const container = $("#toast-container");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function escapeHtml(str = "") {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function timeAgo(ts) {
    if (!ts) return "jamais";
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.floor(h / 24)} j`;
  }

  // Distance haversine en km entre deux points GPS
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  /* ============== BOOT ============== */
  window.addEventListener("DOMContentLoaded", init);

  function init() {
    setupPseudoForm();
    setupTopbarNav();
    setupLogout();
    setupGeoModal();
    setupWelcomeModal();
    setupChat();
    setupMapControls();
    setupMemberSearch();

    auth.onAuthStateChanged(onAuthStateChanged);

    // Sécurité : si Firebase met trop de temps à répondre (connexion
    // lente/instable), on ne reste jamais bloqué indéfiniment sur le logo.
    setTimeout(() => {
      if (!$("#loader").classList.contains("hidden")) {
        $("#loader").classList.add("hidden");
        $("#auth-screen").classList.remove("hidden");
        $("#pseudo-error").textContent =
          "La connexion prend du temps. Vérifie ta connexion internet puis réessaie.";
      }
    }, 8000);
  }

  /* ============== AUTH (pseudo uniquement, via Firebase Anonymous Auth) ============== */
  function setupPseudoForm() {
    $("#pseudo-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const rawName = form.username.value.trim().replace(/\s+/g, " ");
      const errorEl = $("#pseudo-error");
      errorEl.textContent = "";

      // On exige un prénom ET un nom (au moins deux mots) pour éviter les
      // pseudos fantaisistes — un seul mot est rejeté d'entrée.
      const words = rawName.split(" ").filter(Boolean);
      if (words.length < 2 || words.some((w) => w.length < 2)) {
        errorEl.textContent = "Merci d'indiquer ton prénom ET ton nom (pas juste un pseudo).";
        return;
      }

      // Identifiant technique dérivé du nom, utilisé en interne pour
      // vérifier l'unicité (pas affiché tel quel dans l'app).
      const username = rawName
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // enlève les accents
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "_");

      try {
        // Réutilise la session anonyme existante si elle existe déjà
        // (pour ne pas créer un nouvel identifiant à chaque visite),
        // sinon en crée une nouvelle.
        let user = auth.currentUser;
        if (!user) {
          const cred = await auth.signInAnonymously();
          user = cred.user;
        }
        const uid = user.uid;

        // Vérifie l'unicité du nom
        const dup = await db.collection("users").where("username", "==", username).limit(1).get();
        const takenByAnother = dup.docs.some((d) => d.id !== uid);
        if (takenByAnother) {
          errorEl.textContent = "Ce nom est déjà utilisé par un autre membre.";
          return;
        }

        const existingDoc = await db.collection("users").doc(uid).get();
        const isNew = !existingDoc.exists;

        await db.collection("users").doc(uid).set(
          {
            uid,
            name: rawName,
            username,
            avatarUrl: "",
            createdAt: isNew ? firebase.firestore.FieldValue.serverTimestamp() : existingDoc.data().createdAt,
            isFirstLogin: isNew,
          },
          { merge: true }
        );

        if (isNew) {
          await db.collection("notifications").add({
            type: "welcome",
            text: `🔥 Bienvenue à ${rawName} dans Posi🍀`,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }

        // L'état d'auth n'a pas changé (l'utilisateur était peut-être déjà
        // connecté anonymement) donc onAuthStateChanged ne se redéclenche
        // pas tout seul : on l'appelle nous-mêmes pour afficher l'app.
        await onAuthStateChanged(user);
      } catch (err) {
        errorEl.textContent = friendlyAuthError(err);
      }
    });
  }

  function friendlyAuthError(err) {
    const map = {
      "auth/operation-not-allowed": "La connexion anonyme n'est pas activée dans Firebase (Authentication → Sign-in method → Anonyme).",
      "auth/unauthorized-domain": "Ce domaine n'est pas autorisé dans Firebase (Authentication → Settings → Domaines autorisés).",
      "permission-denied": "Accès refusé par les règles Firestore — vérifie qu'elles sont bien publiées.",
    };
    const code = err.code || "erreur inconnue";
    return map[code] || `Erreur (${code}) : ${err.message || "réessaie."}`;
  }

  function setupLogout() {
    $("#logout-btn").addEventListener("click", async () => {
      stopLocationTracking();
      await setOnlineStatus(false);
      await auth.signOut();
      location.reload();
    });
  }

  async function onAuthStateChanged(user) {
    $("#loader").classList.add("hidden");

    if (!user) {
      state.user = null;
      state.profile = null;
      $("#app").classList.add("hidden");
      $("#auth-screen").classList.remove("hidden");
      return;
    }

    state.user = user;

    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists) {
      // Authentifié anonymement mais aucun pseudo choisi pour l'instant :
      // on reste sur l'écran de saisie du pseudo.
      $("#auth-screen").classList.remove("hidden");
      $("#app").classList.add("hidden");
      return;
    }

    state.profile = doc.data();
    $("#auth-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#me-avatar").src = state.profile.avatarUrl || defaultAvatar(state.profile.name);

    await setOnlineStatus(true);
    initMapIfNeeded();
    listenToPositions();
    listenToUsers();
    listenToMessages();
    listenToNotifications();

    // Message de bienvenue à la toute première connexion
    if (state.profile.isFirstLogin) {
      $("#welcome-modal").classList.remove("hidden");
      db.collection("users").doc(user.uid).update({ isFirstLogin: false }).catch(() => {});
    } else {
      maybeAskGeolocation();
    }

    // Marque l'utilisateur hors-ligne proprement à la fermeture de l'onglet
    window.addEventListener("beforeunload", () => {
      rtdb.ref(`positions/${user.uid}`).update({ online: false });
    });
  }

  function defaultAvatar(name = "?") {
    const initial = encodeURIComponent(name.charAt(0).toUpperCase() || "P");
    return `https://api.dicebear.com/7.x/initials/svg?seed=${initial}&backgroundColor=0f5a3d`;
  }

  async function setOnlineStatus(isOnline) {
    if (!state.user) return;
    await db.collection("users").doc(state.user.uid).set(
      { online: isOnline, lastSeen: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  /* ============== GÉOLOCALISATION ============== */
  function setupGeoModal() {
    $("#geo-allow").addEventListener("click", () => {
      $("#geo-modal").classList.add("hidden");
      startLocationTracking();
    });
    $("#geo-deny").addEventListener("click", () => {
      $("#geo-modal").classList.add("hidden");
    });
  }

  function maybeAskGeolocation() {
    if (!navigator.geolocation) {
      showToast("La géolocalisation n'est pas supportée sur cet appareil.");
      return;
    }
    $("#geo-modal").classList.remove("hidden");
  }

  function startLocationTracking() {
    if (!navigator.geolocation || state.watchId) return;

    // Suivi continu (déclenché par le navigateur à chaque mouvement)
    state.watchId = navigator.geolocation.watchPosition(
      (pos) => cachePosition(pos),
      (err) => showToast("Impossible d'accéder à ta position : " + err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    // En complément : on force un envoi régulier toutes les 3 secondes
    // pour garantir une fréquence de mise à jour homogène entre membres.
    state.updateTimer = setInterval(() => {
      if (state.lastKnownPosition) pushPositionToServer(state.lastKnownPosition);
    }, 3000);
  }

  function stopLocationTracking() {
    if (state.watchId) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    if (state.updateTimer) {
      clearInterval(state.updateTimer);
      state.updateTimer = null;
    }
  }

  function cachePosition(pos) {
    state.lastKnownPosition = pos;
    pushPositionToServer(pos);
  }

  function pushPositionToServer(pos) {
    if (!state.user || !state.profile) return;
    const { latitude, longitude, speed, heading } = pos.coords;
    const uid = state.user.uid;
    const prev = state.lastPos[uid];
    const now = Date.now();

    let computedSpeedKmh = speed != null && !isNaN(speed) ? speed * 3.6 : 0;
    let computedHeading = heading != null && !isNaN(heading) ? heading : 0;

    if ((!speed || !heading) && prev) {
      const dtH = (now - prev.ts) / 3600000;
      const dKm = distanceKm(prev.lat, prev.lng, latitude, longitude);
      if (dtH > 0) computedSpeedKmh = computedSpeedKmh || dKm / dtH;
      computedHeading = computedHeading || bearing(prev.lat, prev.lng, latitude, longitude);
    }

    state.lastPos[uid] = { lat: latitude, lng: longitude, ts: now };

    rtdb.ref(`positions/${uid}`).set({
      uid,
      name: state.profile.name,
      username: state.profile.username,
      avatarUrl: state.profile.avatarUrl || "",
      lat: latitude,
      lng: longitude,
      speedKmh: Math.round(computedSpeedKmh * 10) / 10,
      heading: Math.round(computedHeading),
      online: true,
      updatedAt: now,
    });
  }

  /* ============== CARTE (LEAFLET) ============== */
  function initMapIfNeeded() {
    if (state.map) return;
    state.map = L.map("leaflet-map", { zoomControl: false }).setView([48.8566, 2.3522], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(state.map);
  }

  function setupMapControls() {
    $("#btn-center-me").addEventListener("click", () => {
      const uid = state.user && state.user.uid;
      const pos = uid && state.positionsCache[uid];
      if (pos && state.map) {
        state.map.flyTo([pos.lat, pos.lng], 16);
      } else {
        showToast("Ta position n'est pas encore disponible.");
      }
    });

    $("#btn-see-all").addEventListener("click", () => {
      const coords = Object.values(state.positionsCache).map((p) => [p.lat, p.lng]);
      if (coords.length && state.map) {
        state.map.fitBounds(coords, { padding: [40, 40] });
      }
    });
  }

  function buildMarkerIcon(pos, isMe) {
    const img = pos.avatarUrl
      ? `<img src="${pos.avatarUrl}" alt="" />`
      : `<img src="${defaultAvatar(pos.name)}" alt="" />`;
    return L.divIcon({
      className: "",
      html: `<div class="posi-marker${isMe ? " is-me" : ""}">${img}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
  }

  function listenToPositions() {
    rtdb.ref("positions").on("value", (snapshot) => {
      const data = snapshot.val() || {};
      state.positionsCache = data;
      renderMarkers(data);
      renderDashboard();
    });
  }

  function renderMarkers(positions) {
    if (!state.map) return;
    const meUid = state.user && state.user.uid;
    const seen = new Set();

    Object.entries(positions).forEach(([uid, pos]) => {
      if (typeof pos.lat !== "number" || typeof pos.lng !== "number") return;
      seen.add(uid);
      const isMe = uid === meUid;
      const icon = buildMarkerIcon(pos, isMe);

      if (state.markers[uid]) {
        state.markers[uid].setLatLng([pos.lat, pos.lng]);
        state.markers[uid].setIcon(icon);
      } else {
        const marker = L.marker([pos.lat, pos.lng], { icon }).addTo(state.map);
        marker.on("click", () => showMemberPopover(pos));
        state.markers[uid] = marker;
        if (isMe) state.map.setView([pos.lat, pos.lng], 15);
      }
    });

    // Supprime les marqueurs des membres qui n'ont plus de position active
    Object.keys(state.markers).forEach((uid) => {
      if (!seen.has(uid)) {
        state.map.removeLayer(state.markers[uid]);
        delete state.markers[uid];
      }
    });
  }

  function showMemberPopover(pos) {
    const el = $("#member-popover");
    const me = state.positionsCache[state.user.uid];
    let distText = "";
    if (me && me.lat) {
      const d = distanceKm(me.lat, me.lng, pos.lat, pos.lng);
      distText = `<span>📏 ${d.toFixed(2)} km de toi</span>`;
    }
    el.innerHTML = `
      <img src="${pos.avatarUrl || defaultAvatar(pos.name)}" alt="" />
      <h4>${escapeHtml(pos.name)}</h4>
      <span>@${escapeHtml(pos.username || "")}</span>
      <span>🕒 Actif ${timeAgo(pos.updatedAt)}</span>
      <span>🚀 ${pos.speedKmh || 0} km/h</span>
      ${distText}
    `;
    el.classList.remove("hidden");
    clearTimeout(state._popoverTimeout);
    state._popoverTimeout = setTimeout(() => el.classList.add("hidden"), 6000);
  }

  function setupMemberSearch() {
    $("#member-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q) return;
      const match = Object.values(state.positionsCache).find(
        (p) => p.name?.toLowerCase().includes(q) || p.username?.toLowerCase().includes(q)
      );
      if (match && state.map) {
        state.map.flyTo([match.lat, match.lng], 16);
        showMemberPopover(match);
      }
    });
  }

  /* ============== NAVIGATION ONGLETS ============== */
  function setupTopbarNav() {
    $all(".topbar-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $all(".topbar-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const view = tab.dataset.view;
        state.currentView = view;
        $all(".view").forEach((v) => v.classList.add("hidden"));
        $(`#view-${view}`).classList.remove("hidden");
        if (view === "map" && state.map) setTimeout(() => state.map.invalidateSize(), 200);
      });
    });
  }

  /* ============== UTILISATEURS / DASHBOARD ============== */
  function listenToUsers() {
    db.collection("users").onSnapshot((snap) => {
      state.membersCache = {};
      snap.forEach((doc) => (state.membersCache[doc.id] = doc.data()));
      renderDashboard();
    });
  }

  function renderDashboard() {
    const members = Object.values(state.membersCache);
    const positions = state.positionsCache;
    const total = members.length;
    const onlineCount = members.filter((m) => positions[m.uid]?.online).length;

    $("#stat-total").textContent = total;
    $("#stat-online").textContent = onlineCount;
    $("#stat-offline").textContent = Math.max(0, total - onlineCount);

    const me = positions[state.user?.uid];
    const rows = members
      .slice()
      .sort((a, b) => (positions[b.uid]?.online ? 1 : 0) - (positions[a.uid]?.online ? 1 : 0))
      .map((m) => {
        const pos = positions[m.uid];
        const isOnline = !!pos?.online;
        let distText = "—";
        if (me && pos && me.lat) {
          distText = distanceKm(me.lat, me.lng, pos.lat, pos.lng).toFixed(2) + " km";
        }
        return `
          <div class="member-row">
            <img src="${m.avatarUrl || defaultAvatar(m.name)}" alt="" />
            <div class="m-info">
              <div class="m-name">${escapeHtml(m.name)}</div>
              <div class="m-sub">
                <span class="dot ${isOnline ? "dot-online" : "dot-offline"}"></span>
                ${isOnline ? "En ligne" : "Vu " + timeAgo(pos?.updatedAt)}
              </div>
            </div>
            <div class="m-distance">${distText}</div>
          </div>
        `;
      })
      .join("");

    $("#member-table").innerHTML = rows || `<p style="color:var(--white-muted);font-size:13px;">Aucun membre pour le moment.</p>`;
  }

  /* ============== CHAT ============== */
  function setupChat() {
    $("#chat-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#chat-input");
      const text = input.value.trim();
      if (!text || !state.profile) return;
      input.value = "";
      await db.collection("messages").add({
        text,
        authorId: state.user.uid,
        authorName: state.profile.name,
        authorAvatar: state.profile.avatarUrl || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        readBy: [state.user.uid],
      });
    });

    const emojiBtn = $("#emoji-btn");
    const picker = $("#emoji-picker");
    const emojis = ["😀","😂","🔥","🍀","❤️","👍","🙏","😢","😮","🎉","😎","🙌","💬","📍","👋","🥳"];
    picker.innerHTML = emojis.map((e) => `<span>${e}</span>`).join("");
    emojiBtn.addEventListener("click", () => picker.classList.toggle("hidden"));
    picker.addEventListener("click", (e) => {
      if (e.target.tagName === "SPAN") {
        $("#chat-input").value += e.target.textContent;
        picker.classList.add("hidden");
      }
    });
  }

  function listenToMessages() {
    db.collection("messages")
      .orderBy("createdAt", "asc")
      .limitToLast(100)
      .onSnapshot((snap) => {
        const container = $("#chat-messages");
        const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;

        container.innerHTML = snap.docs
          .map((doc) => {
            const m = doc.data();
            const isMe = m.authorId === state.user.uid;
            const time = m.createdAt?.toDate
              ? m.createdAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
              : "";
            return `
              <div class="msg ${isMe ? "msg-me" : "msg-them"}" data-id="${doc.id}">
                <span class="msg-author">${escapeHtml(m.authorName || "")}</span>
                ${escapeHtml(m.text || "")}
                <span class="msg-meta">${time}${isMe ? " · ✓✓" : ""}</span>
              </div>
            `;
          })
          .join("");

        if (wasAtBottom) container.scrollTop = container.scrollHeight;
      });
  }

  /* ============== NOTIFICATIONS "NOUVEAU MEMBRE" ============== */
  function listenToNotifications() {
    const startTime = Date.now();
    db.collection("notifications")
      .orderBy("createdAt", "desc")
      .limit(5)
      .onSnapshot((snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const data = change.doc.data();
          const createdMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
          // On n'affiche que les notifications survenues après le chargement de la page
          if (createdMs >= startTime - 5000) {
            showToast(data.text);
          }
        });
      });
  }

  /* ============== MODALE DE BIENVENUE ============== */
  function setupWelcomeModal() {
    $("#welcome-close").addEventListener("click", () => {
      $("#welcome-modal").classList.add("hidden");
      maybeAskGeolocation();
    });
  }

  /* ============== SERVICE WORKER ============== */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Échec d'enregistrement du Service Worker :", err);
      });
    });
  }
})();
