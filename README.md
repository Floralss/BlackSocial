# BlackSocial

Мини-мессенджер (Telegram-like) на чистом HTML/CSS/JS + Firebase.

- Личные чаты, группы, каналы
- Сообщения в реальном времени
- **Загрузка фото** (Firebase Storage)
- Тёмная тема, мобильная вёрстка

## Важно: деплой на GitHub Pages

GitHub Actions «pages build and deployment» часто висит в очереди на free-tier.  
**Не используй GitHub Actions для Pages.** Делай так:

1. Залей файлы в репозиторий **в корень** (или в папку `/docs`).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**
3. Branch: `main` (или `master`), folder: `/ (root)` или `/docs`
4. Save

Сайт появится через 1–2 минуты на `https://USERNAME.github.io/REPO/`.

### Firebase: разреши домен Pages

**Authentication → Settings → Authorized domains → Add domain**  
добавь: `USERNAME.github.io`

Без этого вход/регистрация на GitHub Pages не будут работать.

---

## Настройка Firebase (один раз)

### 1. Authentication
**Authentication → Sign-in method → Email/Password → Enable**

### 2. Firestore
**Firestore Database → Create database** (production)

**Rules** → вставь и Publish:

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

### 3. Storage (для фото)
**Storage → Get started** (если ещё не включен)

**Rules** → вставь и Publish:

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

### 4. Индекс Firestore
При первом поиске по юзернейму Firebase покажет ссылку «Create index» — кликни один раз.

---

## Локальный запуск

```bash
npx serve .
# или
python3 -m http.server 8080
```

Открой `http://localhost:3000` (или `:8080`).  
`file://` не работает с Firebase Auth.

## Файлы

```
index.html
style.css
app.js
firebase-config.js
README.md
```

Никакой сборки не нужно — это статика.
