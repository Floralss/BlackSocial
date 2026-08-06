# BlackSocial — один файл

Всё в `index.html` (CSS + JS + Firebase внутри).

## GitHub Pages (без Actions)

1. Cancel все queued workflows в Actions.
2. Settings → Pages → **Source: Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Залей в **корень** репозитория:
   - `index.html`
   - `.nojekyll`
5. Push → через 1–2 мин сайт на `https://USERNAME.github.io/REPO/`

6. Firebase → Authentication → Authorized domains → добавь `USERNAME.github.io`

## Firebase (один раз)

### Auth
Email/Password → Enable

### Firestore rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId;
    }
    match /chats/{chatId} {
      allow read: if request.auth != null && request.auth.uid in resource.data.members;
      allow create: if request.auth != null && request.auth.uid in request.resource.data.members;
      allow update: if request.auth != null && request.auth.uid in resource.data.members;
      match /messages/{messageId} {
        allow read: if request.auth != null &&
          request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.members;
        allow create: if request.auth != null &&
          request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.members;
      }
    }
  }
}
```

### Storage rules (фото)
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /chats/{chatId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.resource.size < 8 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

## Локально
```bash
python3 -m http.server 8080
```
Открой http://localhost:8080
