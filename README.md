# BlackSocial

Мини-аналог Telegram: приватные чаты, группы, каналы, сообщения в реальном времени.
Стек: чистый HTML/CSS/JS + Firebase (Auth + Firestore). Без сборки — просто открой в браузере.

## Что нужно сделать в консоли Firebase (один раз)

Проект `black-social-af844` уже подключён (данные из твоего сообщения), но в консоли надо включить два сервиса:

1. **Authentication → Sign-in method → Email/Password → включить.**
2. **Firestore Database → Create database** (режим "production", любой регион).
3. **Firestore → Rules** — вставь и опубликуй:

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

Без этих правил вся база будет либо полностью закрыта (по умолчанию), либо полностью открыта — обязательно вставь именно это.

4. Также в Firestore нужен **композитный индекс** для поиска юзернеймов — Firebase сам предложит ссылку "Create index" в консоли браузера при первом поиске, просто кликни по ней один раз.

## Как запустить

Firebase Auth не работает при открытии файла напрямую как `file://index.html` в некоторых браузерах — запусти локальный сервер:

```bash
cd blacksocial
npx serve .
# или
python3 -m http.server 8080
```

Открой `http://localhost:3000` (или `:8080`).

## Что уже работает

- Регистрация / вход по email + паролю, юзернейм для поиска
- Список чатов в реальном времени (как в скриншоте: тёмная тема, аватарки-инициалы, время, превью)
- Приватные чаты — поиск собеседника по юзернейму
- Группы — создание, добавление нескольких участников
- Каналы — писать могут только админы (создатель), остальные только читают
- Сообщения в реальном времени (Firestore onSnapshot), без перезагрузки страницы

## Что стоит добавить дальше (осознанно не делал в первой версии, чтобы не плодить баги)

- Загрузка файлов/фото (Firebase Storage)
- Онлайн/"был в сети"
- Push-уведомления
- Админка каналов (несколько админов, бан участников)
- Редактирование/удаление сообщений
- Пагинация истории сообщений (сейчас грузится весь чат целиком)

## Структура файлов

```
blacksocial/
├── index.html          — разметка
├── style.css            — тёмная тема
├── firebase-config.js   — твой конфиг Firebase
├── app.js                — вся логика (auth, чаты, группы, каналы, сообщения)
└── README.md
```
