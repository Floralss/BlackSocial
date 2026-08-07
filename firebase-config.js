export const firebaseConfig = {
  apiKey: "AIzaSyBGFONUBgybQr0KCn_Ao_ZT9HkWVSU4jEw",
  authDomain: "black-social-af844.firebaseapp.com",
  projectId: "black-social-af844",
  storageBucket: "black-social-af844.firebasestorage.app",
  messagingSenderId: "296441938682",
  appId: "1:296441938682:web:096a3e642bd00116f7bf43",
  measurementId: "G-2PX2QMR8HS"
};

export const vaultConfig = {
  apiKey: "AIzaSyCmXswh7MgI1tOcPCWl0AHBABY636gOczk",
  authDomain: "blackvault-7a10e.firebaseapp.com",
  projectId: "blackvault-7a10e",
  storageBucket: "blackvault-7a10e.firebasestorage.app",
  messagingSenderId: "1061227024519",
  appId: "1:1061227024519:web:d7fb72171bc26f5e4ce822"
};

// Владелец / супер-админ (полный доступ)
export const SUPER_ADMIN_EMAILS = [
  "strepoomich27@gmail.com"
];
// Статический список (дополнительно к role:admin в профиле)
export const ADMIN_EMAILS = [
  "strepoomich27@gmail.com"
];
// Секрет больше НЕ открывает админку обычным пользователям
export const ADMIN_SECRET = "";

export const COIN_PACK = { coins: 100, uah: 50 };
// Base: 1 BC = 0.5 UAH = $0.012
export const COIN_PACKS = [
  { coins: 1,    uah: 0.5 },
  { coins: 50,   uah: 25 },
  { coins: 100,  uah: 50 },
  { coins: 250,  uah: 125 },
  { coins: 500,  uah: 250 },
  { coins: 1000, uah: 500 },
  { coins: 2500, uah: 1250 },
  { coins: 5000, uah: 2500 }
];
export const RATES = { UAH: 1, USD: 0.024 };
