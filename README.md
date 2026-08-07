# BlackSocial

Файлы: `index.html` · `style.css` · `app.js` · `firebase-config.js`

## Запуск
```bash
python -m http.server 8080
```
http://localhost:8080 — **не file://**

## Firebase (black-social-af844)
- Firestore database id: **default**
- Storage Rules (фото):
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
        && request.resource.size < 8 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```
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

## Админка
В `firebase-config.js` → `ADMIN_EMAILS` добавь свою почту.

## BlackCoin
100 BC = 50 ₴. Оплата с кошелька **BlackVault** (тот же email + пароль Vault).
Регион валюты определяется по языку браузера (UAH/RUB/BYN/…).

## Premium
200 BC / месяц (скидки на 3/6/12 мес).

## Фиксы (07.08.2026)
- Подарки NFT / коллекционные: сообщение по центру чата с текстом + карточкой (как в Telegram), не просто картинка.
- Подарок BlackCoin (звёзды) и Premium другому пользователю — с такой же карточкой в чате.
- Настройки канала/группы: смена фото, статус Открытый/Закрытый, удаление участников.
- Настройки полностью переделаны в стиле Telegram (меню → подэкраны: Конфиденциальность, Уведомления и т.д.).
- UI подарочных карточек и общий полиш интерфейса.
