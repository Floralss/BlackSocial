# BlackSocial

Файлы:
- index.html
- style.css
- app.js

## Запуск
```bash
python -m http.server 8080
```
Открой http://localhost:8080

**Не открывай через file://** — ES modules не работают.

## Firebase
- База: **default** (не (default))
- Auth: Email/Password
- Firestore Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
- Storage Rules:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
