# Posi 🔥🍀

Plateforme privée de quartier : carte en direct, chat et notifications, en PWA installable sur Android, iPhone et ordinateur.

---

## 1. Structure du projet

```
/
├── index.html      → structure des écrans (auth, carte, chat, dashboard)
├── style.css        → design system (glassmorphism, noir/émeraude/néon)
├── firebase.js       → initialisation Firebase (à configurer, voir ci-dessous)
├── app.js            → toute la logique (auth, géoloc, carte, chat, dashboard)
├── manifest.json      → configuration PWA
├── sw.js               → Service Worker (cache + notifications push)
├── vercel.json          → configuration de déploiement Vercel
└── assets/               → icônes PWA (192x192, 512x512, maskable)
```

---

## 2. Configurer Firebase (obligatoire avant de lancer le site)

### 2.1 Créer le projet
1. Va sur [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet**.
2. Une fois créé, clique sur l'icône **Web `</>`** pour enregistrer une app web.
3. Copie l'objet `firebaseConfig` généré et colle-le dans **`firebase.js`**, à la place des valeurs `REPLACE_WITH_...`.

### 2.2 Activer les services nécessaires
Dans le menu latéral de la Console Firebase :

| Service | Où l'activer | Pourquoi |
|---|---|---|
| **Authentication** | Authentication → Sign-in method → activer **Email/Mot de passe** | Connexion / inscription |
| **Firestore Database** | Firestore Database → Créer une base (mode production) | Profils, messages, notifications |
| **Realtime Database** | Realtime Database → Créer une base | Positions GPS en direct (mises à jour très fréquentes) |
| **Storage** | Storage → Commencer | Photos de profil |
| **Cloud Messaging** | Project settings → Cloud Messaging | Notifications push (optionnel) |

### 2.3 Règles de sécurité Firestore
Colle ceci dans **Firestore → Règles** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId;
      allow delete: if false;
    }

    match /messages/{messageId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.authorId == request.auth.uid;
      allow update: if request.auth != null
                    && resource.data.authorId == request.auth.uid;
      allow delete: if request.auth != null
                    && resource.data.authorId == request.auth.uid;
    }

    match /notifications/{notifId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if false;
    }
  }
}
```

### 2.4 Règles de sécurité Realtime Database (positions)
Colle ceci dans **Realtime Database → Règles** :

```json
{
  "rules": {
    "positions": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

> Ces règles garantissent que **chaque membre ne peut modifier que ses propres données** (profil, position), tout en pouvant lire celles des autres — indispensable pour la carte partagée.

### 2.5 Storage (photos de profil)
Dans **Storage → Règles** :

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatars/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## 3. Lancer le site en local

Comme le projet est en JS vanilla, un simple serveur statique suffit :

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Puis ouvre `http://localhost:8080`.

---

## 4. Déployer sur Vercel

1. Installe la CLI si besoin : `npm i -g vercel`.
2. Depuis le dossier du projet : `vercel`.
3. Suis les instructions (le fichier `vercel.json` est déjà prêt).
4. Pour la production : `vercel --prod`.

Tu peux aussi connecter le dépôt GitHub directement depuis [vercel.com](https://vercel.com) → **New Project** → sélectionner le repo → Deploy.

⚠️ Pense à ajouter le domaine Vercel (`ton-projet.vercel.app`) dans **Firebase → Authentication → Settings → Domaines autorisés**, sinon la connexion échouera.

---

## 5. Icônes PWA

Ajoute dans `assets/` :
- `icon-192.png` (192×192)
- `icon-512.png` (512×512)
- `icon-maskable-512.png` (512×512, avec marge de sécurité pour le masquage adaptatif Android)

Tu peux les générer facilement avec [realfavicongenerator.net](https://realfavicongenerator.net) ou [maskable.app](https://maskable.app).

---

## 6. Utilisation des fonctionnalités

- **Inscription** : nom, pseudo, email, mot de passe, photo (optionnelle). Un message de bienvenue animé s'affiche à la première connexion, puis Posi demande l'autorisation de localisation.
- **Partage de position** : une fois autorisée, ta position est envoyée toutes les ~3 secondes et visible par tous les membres sur la carte, avec vitesse et direction approximatives.
- **Carte** : zoom, centrage sur soi (🎯), vue d'ensemble (👥), recherche d'un membre par nom/pseudo, popover avec distance et dernière activité.
- **Chat** : messages instantanés, emoji, horodatage, statut "vu" (✓✓ pour tes propres messages), historique des 100 derniers messages.
- **Dashboard** : nombre total de membres, connectés/hors ligne, dernière activité et distance par rapport à toi.
- **Notifications** : chaque nouvelle inscription déclenche un toast `🔥 Bienvenue à [Nom] dans Posi🍀` pour tous les membres connectés.

---

## 7. Sécurité — points clés

- Toutes les pages de l'app (`#app`) ne s'affichent qu'après authentification (`auth.onAuthStateChanged`).
- Chaque utilisateur ne peut écrire que dans **son propre** document `users/{uid}` et **sa propre** entrée `positions/{uid}` (voir règles ci-dessus) — personne ne peut falsifier la position d'un autre membre.
- Les mots de passe ne transitent jamais en clair côté client : ils sont gérés entièrement par Firebase Authentication.
- Pense à limiter l'inscription à ton quartier en pratique (lien d'invitation privé, modération manuelle des comptes, etc.) — Firebase ne fait pas cette vérification à ta place.

---

## 8. Note importante sur la confidentialité

Posi partage la position **précise et en temps réel** de chaque membre avec **tous les autres membres**. Avant de déployer ce projet pour de vrais utilisateurs :

- Assure-toi que chaque personne comprend clairement ce qu'elle partage et avec qui (le texte de consentement dans l'écran de connexion peut être adapté).
- Permets à chaque membre de désactiver le partage à tout moment (bouton "Plus tard" déjà présent, à compléter par un vrai interrupteur dans un profil si besoin).
- Réfléchis à une durée de rétention des positions (par exemple, les supprimer après quelques heures) plutôt que de les conserver indéfiniment.
