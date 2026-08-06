# BlackSocial

Мини-мессенджер в духе Telegram, но со своим визуальным языком.  
Стек: чистый HTML / CSS / JS + Firebase (Auth + Firestore). Без сборщиков — просто открыл и работает.

## Что умеет

- Регистрация и вход по email + паролю, уникальный юзернейм
- Список чатов в реальном времени
- Личные чаты (поиск по юзернейму)
- Группы (несколько участников)
- Каналы (писать могут только админы)
- Сообщения в реальном времени
- Разделители дат («Сегодня», «Вчера»…)
- Адаптив под мобильные (кнопка «назад», скрытие списка)
- Тёмная тема в стиле WhatsApp/Telegram, но со своим акцентом (зелёный)

## Что нужно сделать в Firebase (один раз)

Проект `black-social-af844` уже подключён, но в консоли Firebase нужно:

### 1. Authentication
**Authentication → Sign-in method → Email/Password → Enable**

### 2. Firestore
**Firestore Database → Create database** (production mode, любой регион)

### 3. Rules — вставь и опубликуй:

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

### 4. Индекс
При первом поиске по юзернейму Firebase предложит создать композитный индекс — просто кликни «Create index».

## Как запустить

Firebase Auth не работает через `file://`. Запусти локальный сервер:

```bash
cd blacksocial
npx serve .
# или
python3 -m http.server 8080
```

Открой `http://localhost:3000` (или `:8080`).

## Структура

```
blacksocial/
├── index.html
├── style.css
├── app.js
├── firebase-config.js
└── README.md
```

## Что можно добавить дальше

- Фото / файлы (Firebase Storage)
- Онлайн-статус
- Push-уведомления
- Редактирование / удаление сообщений
- Пагинация истории
- Несколько админов в каналах
- Закреплённые сообщения
