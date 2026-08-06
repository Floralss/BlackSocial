import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, getDocs, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import {
  firebaseConfig, vaultConfig, ADMIN_EMAILS, COIN_PACK, RATES
} from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "default");
const storage = getStorage(app);

// BlackVault secondary app
const vaultApp = initializeApp(vaultConfig, "vault");
const vaultAuth = getAuth(vaultApp);
const vaultDb = getFirestore(vaultApp); // default for vault

let currentUser = null;
let currentProfile = null;
let currentChatId = null;
let currentChat = null;
let unsubMessages = null;
let unsubChats = null;
let allChats = [];
let pendingFiles = [];
let authBusy = false;
let selectedPayCur = "UAH";
let selectedPremiumMonths = 1;

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const PREMIUM_PRICE = { 1: 200, 3: 540, 6: 960, 12: 1680 };

function isAdmin() {
  return currentUser && ADMIN_EMAILS.map(e => e.toLowerCase()).includes((currentUser.email || "").toLowerCase());
}

function detectRegion() {
  const lang = (navigator.language || "uk").toLowerCase();
  if (lang.startsWith("ru")) return "RUB";
  if (lang.startsWith("be")) return "BYN";
  if (lang.startsWith("kk")) return "KZT";
  if (lang.startsWith("en")) return "USD";
  return "UAH";
}

function formatPrice(uah, cur) {
  const rate = RATES[cur] || 1;
  const amount = uah * rate;
  const symbols = { UAH: "₴", RUB: "₽", BYN: "Br", USD: "$", KZT: "₸" };
  const names = { UAH: "грн", RUB: "руб", BYN: "бел. руб", USD: "USD", KZT: "тенге" };
  if (cur === "USD") return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(cur === "BYN" ? 2 : 0)} ${symbols[cur] || cur} (${names[cur] || cur})`;
}

function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 42%)`;
}
function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}
function fmtTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
function fmtDateSep(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Сегодня";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
function sameDay(a, b) {
  if (!a || !b) return false;
  const da = a.toDate ? a.toDate() : new Date(a);
  const db = b.toDate ? b.toDate() : new Date(b);
  return da.toDateString() === db.toDateString();
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}
function showToast(text, ms = 3200) {
  document.querySelector(".upload-toast")?.remove();
  const t = el(`<div class="upload-toast">${escapeHtml(text)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function setLoading(on) {
  let ov = document.getElementById("loadingOverlay");
  if (on) {
    if (!ov) {
      ov = el('<div class="loading-overlay" id="loadingOverlay"><div class="spinner"></div></div>');
      document.body.appendChild(ov);
    }
  } else ov?.remove();
}
function translateAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/email-already-in-use": "Email уже зарегистрирован",
    "auth/invalid-email": "Некорректный email",
    "auth/weak-password": "Пароль мин. 6 символов",
    "auth/invalid-credential": "Неверный email или пароль",
    "auth/invalid-login-credentials": "Неверный email или пароль",
    "auth/too-many-requests": "Слишком много попыток",
    "auth/network-request-failed": "Сеть / Authorized domains",
    "permission-denied": "Нет доступа (Rules)",
    "storage/unauthorized": "Storage: нет прав на загрузку. Проверь Storage Rules"
  };
  return map[code] || err?.message || String(err);
}
function setAvatarEl(node, profile) {
  if (!node || !profile) return;
  node.innerHTML = "";
  node.style.background = hashColor(profile.name);
  if (profile.avatarUrl) {
    const img = document.createElement("img");
    img.src = profile.avatarUrl;
    img.alt = "";
    node.appendChild(img);
  } else node.textContent = initials(profile.name);
}
function hasPremium(p) {
  if (!p?.premiumUntil) return false;
  const t = p.premiumUntil.toDate ? p.premiumUntil.toDate() : new Date(p.premiumUntil);
  return t > new Date();
}

/* AUTH */
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("loginForm").classList.toggle("hidden", tab.dataset.tab !== "login");
    document.getElementById("registerForm").classList.toggle("hidden", tab.dataset.tab !== "register");
  });
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (authBusy) return;
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errBox = document.getElementById("loginError");
  errBox.textContent = "";
  authBusy = true; setLoading(true);
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (err) { errBox.textContent = translateAuthError(err); }
  finally { authBusy = false; setLoading(false); }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (authBusy) return;
  const name = document.getElementById("regName").value.trim();
  let username = document.getElementById("regUsername").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const errBox = document.getElementById("registerError");
  errBox.textContent = "";
  if (!name || username.length < 3) { errBox.textContent = "Имя и юзернейм (мин. 3)"; return; }
  authBusy = true; setLoading(true);
  let uid = null;
  try {
    const ex = await getDocs(query(collection(db, "users"), where("username", "==", username), limit(1)));
    if (!ex.empty) { errBox.textContent = "Юзернейм занят"; return; }
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
    await setDoc(doc(db, "users", uid), {
      uid, name, username, email, avatarUrl: "", blackCoins: 0,
      premiumUntil: null, deleted: false, settings: {},
      createdAt: serverTimestamp()
    });
  } catch (err) {
    errBox.textContent = translateAuthError(err);
    if (uid) try { await signOut(auth); } catch (_) {}
  } finally { authBusy = false; setLoading(false); }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null; currentProfile = null;
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
    closeDrawer();
    if (unsubChats) unsubChats();
    if (unsubMessages) unsubMessages();
    return;
  }
  setLoading(true);
  try {
    currentUser = user;
    let snap = await getDoc(doc(db, "users", user.uid));
    currentProfile = snap.exists() ? snap.data() : null;
    if (currentProfile?.deleted) {
      showToast("Аккаунт удалён администратором");
      await signOut(auth);
      return;
    }
    if (!currentProfile) {
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid, name: (user.email || "User").split("@")[0],
        username: "u" + user.uid.slice(0, 8), email: user.email || "",
        avatarUrl: "", blackCoins: 0, deleted: false, createdAt: serverTimestamp()
      });
      snap = await getDoc(doc(db, "users", user.uid));
      currentProfile = snap.data();
    }
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("menuAdmin").classList.toggle("hidden", !isAdmin());
    updateDrawer();
    subscribeChats();
  } catch (e) {
    showToast(translateAuthError(e));
    await signOut(auth);
  } finally { setLoading(false); }
});

/* DRAWER */
function openDrawer() {
  updateDrawer();
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawerOverlay").classList.add("open");
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
}
function updateDrawer() {
  if (!currentProfile) return;
  setAvatarEl(document.getElementById("drawerAvatar"), currentProfile);
  document.getElementById("drawerName").textContent = currentProfile.name + (hasPremium(currentProfile) ? " ✦" : "");
  document.getElementById("drawerUsername").textContent = "@" + currentProfile.username;
  const hide = currentProfile.settings?.hideCoins;
  document.getElementById("drawerCoins").style.display = hide ? "none" : "inline-flex";
  document.getElementById("drawerCoins").textContent = `🪙 ${currentProfile.blackCoins || 0} BC`;
}
document.getElementById("menuBtn").addEventListener("click", openDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);

function hideAllScreens() {
  ["profileScreen", "settingsScreen", "shopScreen", "adminScreen"].forEach(id => {
    document.getElementById(id).classList.add("hidden");
  });
}
document.getElementById("menuProfile").addEventListener("click", () => { closeDrawer(); openProfile(); });
document.getElementById("menuSettings").addEventListener("click", () => { closeDrawer(); openSettings(); });
document.getElementById("menuShop").addEventListener("click", () => { closeDrawer(); openShop(); });
document.getElementById("menuAdmin").addEventListener("click", () => { closeDrawer(); openAdmin(); });
document.getElementById("menuNewChat").addEventListener("click", () => { closeDrawer(); openModal("private"); });
document.getElementById("menuNewGroup").addEventListener("click", () => { closeDrawer(); openModal("group"); });
document.getElementById("menuNewChannel").addEventListener("click", () => { closeDrawer(); openModal("channel"); });
document.getElementById("menuLogout").addEventListener("click", async () => {
  closeDrawer();
  const need = currentProfile?.settings?.confirmLogout !== false;
  if (!need || confirm("Выйти?")) await signOut(auth);
});

/* PROFILE */
function openProfile() {
  hideAllScreens();
  document.getElementById("profileScreen").classList.remove("hidden");
  setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
  document.getElementById("editName").value = currentProfile.name || "";
  document.getElementById("editUsername").value = currentProfile.username || "";
  document.getElementById("editEmail").value = currentProfile.email || "";
}
document.getElementById("closeProfile").addEventListener("click", () => document.getElementById("profileScreen").classList.add("hidden"));
document.getElementById("changeAvatarBtn").addEventListener("click", () => document.getElementById("avatarInput").click());
document.getElementById("avatarInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; e.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Только изображения");
  if (file.size > MAX_IMAGE_SIZE) return showToast("Макс 8 МБ");
  setLoading(true);
  try {
    const path = `avatars/${currentUser.uid}_${Date.now()}`;
    await uploadBytes(ref(storage, path), file, { contentType: file.type });
    const url = await getDownloadURL(ref(storage, path));
    await updateDoc(doc(db, "users", currentUser.uid), { avatarUrl: url });
    currentProfile.avatarUrl = url;
    setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
    updateDrawer();
    showToast("Аватар обновлён");
  } catch (err) { showToast(translateAuthError(err)); }
  finally { setLoading(false); }
});
document.getElementById("saveProfileBtn").addEventListener("click", async () => {
  const name = document.getElementById("editName").value.trim();
  let username = document.getElementById("editUsername").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!name || username.length < 3) return showToast("Проверь имя и юзернейм");
  setLoading(true);
  try {
    if (username !== currentProfile.username) {
      const ex = await getDocs(query(collection(db, "users"), where("username", "==", username), limit(1)));
      if (!ex.empty) { showToast("Юзернейм занят"); return; }
    }
    await updateDoc(doc(db, "users", currentUser.uid), { name, username });
    currentProfile.name = name; currentProfile.username = username;
    updateDrawer(); showToast("Сохранено");
  } catch (err) { showToast(translateAuthError(err)); }
  finally { setLoading(false); }
});

/* SETTINGS */
function openSettings() {
  hideAllScreens();
  document.getElementById("settingsScreen").classList.remove("hidden");
  const s = currentProfile.settings || {};
  document.querySelectorAll(".toggle[data-key]").forEach(btn => {
    const k = btn.dataset.key;
    const on = s[k] !== false && s[k] !== undefined ? !!s[k] : btn.classList.contains("on");
    // defaults
    const defaults = { showOnline: true, showPreview: true, confirmLogout: true, sound: true, hideCoins: false };
    const val = s[k] !== undefined ? !!s[k] : defaults[k];
    btn.classList.toggle("on", val);
  });
  document.getElementById("whoCanMessage").value = s.whoCanMessage || "all";
}
document.getElementById("closeSettings").addEventListener("click", () => document.getElementById("settingsScreen").classList.add("hidden"));
document.querySelectorAll(".toggle[data-key]").forEach(btn => {
  btn.addEventListener("click", async () => {
    btn.classList.toggle("on");
    const settings = { ...(currentProfile.settings || {}) };
    settings[btn.dataset.key] = btn.classList.contains("on");
    currentProfile.settings = settings;
    try { await updateDoc(doc(db, "users", currentUser.uid), { settings }); updateDrawer(); }
    catch (e) { showToast(translateAuthError(e)); }
  });
});
document.getElementById("whoCanMessage").addEventListener("change", async (e) => {
  const settings = { ...(currentProfile.settings || {}), whoCanMessage: e.target.value };
  currentProfile.settings = settings;
  try { await updateDoc(doc(db, "users", currentUser.uid), { settings }); }
  catch (err) { showToast(translateAuthError(err)); }
});
document.getElementById("logoutFromSettings").addEventListener("click", async () => {
  if (confirm("Выйти?")) await signOut(auth);
});

/* SHOP + BLACKVAULT PAY */
function openShop() {
  hideAllScreens();
  document.getElementById("shopScreen").classList.remove("hidden");
  document.getElementById("shopBalance").textContent = `${currentProfile.blackCoins || 0} BC`;
  selectedPayCur = detectRegion();
  const grid = document.getElementById("currGrid");
  grid.innerHTML = "";
  ["UAH", "RUB", "BYN", "USD", "KZT"].forEach(cur => {
    const opt = el(`<div class="curr-opt${cur === selectedPayCur ? " sel" : ""}" data-cur="${cur}">${cur}<small>${formatPrice(COIN_PACK.uah, cur)}</small></div>`);
    opt.addEventListener("click", () => {
      selectedPayCur = cur;
      grid.querySelectorAll(".curr-opt").forEach(x => x.classList.toggle("sel", x.dataset.cur === cur));
      document.getElementById("packPriceLabel").textContent = formatPrice(COIN_PACK.uah, cur);
    });
    grid.appendChild(opt);
  });
  document.getElementById("packPriceLabel").textContent = formatPrice(COIN_PACK.uah, selectedPayCur);
  if (hasPremium(currentProfile)) {
    const until = currentProfile.premiumUntil.toDate ? currentProfile.premiumUntil.toDate() : new Date(currentProfile.premiumUntil);
    document.getElementById("premiumStatus").textContent = "Premium до " + until.toLocaleDateString("ru-RU");
  } else document.getElementById("premiumStatus").textContent = "Premium не активен";
}
document.getElementById("closeShop").addEventListener("click", () => document.getElementById("shopScreen").classList.add("hidden"));

document.getElementById("buyCoinsBtn").addEventListener("click", async () => {
  const pass = document.getElementById("vaultPassword").value;
  if (!pass) return showToast("Введи пароль BlackVault");
  setLoading(true);
  try {
    // Login to BlackVault with same email
    const email = currentUser.email;
    const cred = await signInWithEmailAndPassword(vaultAuth, email, pass);
    const wSnap = await getDoc(doc(vaultDb, "wallets", cred.user.uid));
    if (!wSnap.exists()) throw new Error("Кошелёк BlackVault не найден");
    const wallet = wSnap.data();
    const cur = selectedPayCur;
    const amount = COIN_PACK.uah * (RATES[cur] || 1);
    const bal = (wallet.balances && wallet.balances[cur]) || 0;
    if (bal < amount) throw new Error(`Недостаточно ${cur}. Нужно ${amount.toFixed(2)}, есть ${bal.toFixed(2)}`);
    await updateDoc(doc(vaultDb, "wallets", cred.user.uid), {
      [`balances.${cur}`]: increment(-amount)
    });
    // log tx on vault if possible
    try {
      await addDoc(collection(vaultDb, "tx"), {
        uid: cred.user.uid, type: "blacksocial_coins", currency: cur, amount,
        createdAt: serverTimestamp()
      });
    } catch (_) {}
    await updateDoc(doc(db, "users", currentUser.uid), {
      blackCoins: increment(COIN_PACK.coins)
    });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) + COIN_PACK.coins;
    document.getElementById("shopBalance").textContent = `${currentProfile.blackCoins} BC`;
    updateDrawer();
    document.getElementById("vaultPassword").value = "";
    showToast(`+${COIN_PACK.coins} BC · списано ${amount.toFixed(2)} ${cur}`);
  } catch (err) {
    console.error(err);
    showToast(translateAuthError(err) || err.message || String(err));
  } finally { setLoading(false); }
});

document.querySelectorAll("#premiumMonths .month-opt").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll("#premiumMonths .month-opt").forEach(x => x.classList.remove("sel"));
    opt.classList.add("sel");
    selectedPremiumMonths = parseInt(opt.dataset.m, 10);
  });
});
document.getElementById("buyPremiumBtn").addEventListener("click", async () => {
  const cost = PREMIUM_PRICE[selectedPremiumMonths] || 200;
  const bal = currentProfile.blackCoins || 0;
  if (bal < cost) return showToast(`Нужно ${cost} BC, у тебя ${bal}`);
  setLoading(true);
  try {
    const base = hasPremium(currentProfile)
      ? (currentProfile.premiumUntil.toDate ? currentProfile.premiumUntil.toDate() : new Date(currentProfile.premiumUntil))
      : new Date();
    const until = new Date(base.getTime() + selectedPremiumMonths * 30 * 24 * 60 * 60 * 1000);
    await updateDoc(doc(db, "users", currentUser.uid), {
      blackCoins: increment(-cost),
      premiumUntil: until
    });
    currentProfile.blackCoins = bal - cost;
    currentProfile.premiumUntil = until;
    document.getElementById("shopBalance").textContent = `${currentProfile.blackCoins} BC`;
    document.getElementById("premiumStatus").textContent = "Premium до " + until.toLocaleDateString("ru-RU");
    updateDrawer();
    showToast("Premium оформлен!");
  } catch (err) { showToast(translateAuthError(err)); }
  finally { setLoading(false); }
});

/* ADMIN */
function openAdmin() {
  if (!isAdmin()) return showToast("Нет доступа");
  hideAllScreens();
  document.getElementById("adminScreen").classList.remove("hidden");
}
document.getElementById("closeAdmin").addEventListener("click", () => document.getElementById("adminScreen").classList.add("hidden"));

async function findUserByUsername(uname) {
  uname = uname.replace(/^@/, "").toLowerCase().trim();
  const snap = await getDocs(query(collection(db, "users"), where("username", "==", uname), limit(1)));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}
document.getElementById("adminGiveBtn").addEventListener("click", async () => {
  const u = await findUserByUsername(document.getElementById("adminGiveUser").value);
  const amt = parseInt(document.getElementById("adminGiveAmount").value, 10);
  if (!u) return showToast("Пользователь не найден");
  if (!amt || amt < 1) return showToast("Укажи сумму");
  await updateDoc(doc(db, "users", u.id), { blackCoins: increment(amt) });
  showToast(`Выдано ${amt} BC → @${u.username}`);
});
document.getElementById("adminDelBtn").addEventListener("click", async () => {
  const u = await findUserByUsername(document.getElementById("adminDelUser").value);
  if (!u) return showToast("Не найден");
  if (!confirm(`Удалить @${u.username}?`)) return;
  await updateDoc(doc(db, "users", u.id), { deleted: true });
  showToast("Аккаунт помечен удалённым");
});
document.getElementById("adminRestoreBtn").addEventListener("click", async () => {
  const u = await findUserByUsername(document.getElementById("adminRestoreUser").value);
  if (!u) return showToast("Не найден");
  await updateDoc(doc(db, "users", u.id), { deleted: false });
  showToast("Восстановлен");
});

/* CHATS */
function subscribeChats() {
  if (unsubChats) unsubChats();
  const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid));
  unsubChats = onSnapshot(q, snap => {
    allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allChats.sort((a, b) => (b.lastMessageTime?.toMillis?.() || 0) - (a.lastMessageTime?.toMillis?.() || 0));
    renderChatList();
  }, err => showToast(translateAuthError(err)));
}
function chatDisplayName(chat) {
  if (chat.type === "private") {
    const other = chat.members.find(m => m !== currentUser.uid);
    return chat.memberNames?.[other] || "Пользователь";
  }
  return chat.name || "Без названия";
}
function renderChatList() {
  const listEl = document.getElementById("chatList");
  const filter = document.getElementById("searchInput").value.trim().toLowerCase();
  listEl.innerHTML = "";
  const filtered = allChats.filter(c => chatDisplayName(c).toLowerCase().includes(filter));
  if (!filtered.length) {
    listEl.innerHTML = '<div class="search-empty">Нет чатов · ☰ → Новый чат</div>';
    return;
  }
  filtered.forEach(c => {
    const name = chatDisplayName(c);
    const icon = c.type === "group" ? "👥 " : c.type === "channel" ? "📢 " : "";
    const item = el(`
      <div class="chat-item" data-id="${c.id}">
        <div class="chat-avatar" style="background:${hashColor(name)}">${initials(name)}</div>
        <div class="chat-meta">
          <div class="chat-top-row">
            <div class="chat-name">${escapeHtml(name)}</div>
            <div class="chat-time">${fmtTime(c.lastMessageTime)}</div>
          </div>
          <div class="chat-preview">${icon}${escapeHtml(c.lastMessage || "Нет сообщений")}</div>
        </div>
      </div>`);
    item.addEventListener("click", () => openChat(c.id));
    if (c.id === currentChatId) item.classList.add("active");
    listEl.appendChild(item);
  });
}
document.getElementById("searchInput").addEventListener("input", renderChatList);

function openChat(chatId) {
  currentChatId = chatId;
  currentChat = allChats.find(c => c.id === chatId);
  if (!currentChat) return;
  pendingFiles = []; renderPreviewBar(); hideAllScreens();
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("chatView").classList.remove("hidden");
  document.getElementById("app").classList.add("chat-open");
  renderChatList();
  const name = chatDisplayName(currentChat);
  const hAv = document.getElementById("chatHeaderAvatar");
  hAv.style.background = hashColor(name); hAv.textContent = initials(name);
  document.getElementById("chatHeaderName").textContent = name;
  let sub = "личный чат";
  if (currentChat.type === "group") sub = `Группа · ${currentChat.members.length}`;
  if (currentChat.type === "channel") sub = `Канал · ${currentChat.members.length}`;
  document.getElementById("chatHeaderSub").textContent = sub;
  const isChannel = currentChat.type === "channel";
  const isAdm = !isChannel || (currentChat.admins || []).includes(currentUser.uid);
  document.getElementById("composer").classList.toggle("hidden", !isAdm);
  document.getElementById("composerLocked").classList.toggle("hidden", isAdm);
  if (unsubMessages) unsubMessages();
  const msgsEl = document.getElementById("messages");
  msgsEl.innerHTML = "";
  const mq = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubMessages = onSnapshot(mq, snap => {
    msgsEl.innerHTML = "";
    let lastTs = null;
    snap.forEach(ds => {
      const m = ds.data();
      if (!sameDay(lastTs, m.timestamp))
        msgsEl.appendChild(el(`<div class="date-sep">${fmtDateSep(m.timestamp)}</div>`));
      lastTs = m.timestamp;
      const own = m.senderId === currentUser.uid;
      const showSender = !own && currentChat.type !== "private";
      let inner = "";
      if (m.imageUrl) inner += `<img class="msg-img" src="${escapeHtml(m.imageUrl)}" alt="" loading="lazy">`;
      if (m.text) inner += `<div class="msg-text">${escapeHtml(m.text)}</div>`;
      if (!inner) inner = '<div class="msg-text">…</div>';
      const row = el(`
        <div class="msg-row ${own ? "own" : "other"}">
          ${showSender ? `<div class="msg-sender">${escapeHtml(m.senderName)}</div>` : ""}
          <div class="msg-bubble ${m.imageUrl ? "has-image" : ""}">${inner}</div>
          <div class="msg-meta"><span class="msg-time">${fmtTime(m.timestamp)}</span></div>
        </div>`);
      if (m.imageUrl) row.querySelector(".msg-img").onclick = () => openLightbox(m.imageUrl);
      msgsEl.appendChild(row);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }, err => showToast(translateAuthError(err)));
}
document.getElementById("backBtn").addEventListener("click", () => {
  currentChatId = null; currentChat = null; pendingFiles = []; renderPreviewBar();
  document.getElementById("chatView").classList.add("hidden");
  document.getElementById("emptyState").classList.remove("hidden");
  document.getElementById("app").classList.remove("chat-open");
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  renderChatList();
});
function openLightbox(url) {
  document.getElementById("lightboxImg").src = url;
  document.getElementById("lightbox").classList.remove("hidden");
}
document.getElementById("lightboxClose").onclick = () => {
  document.getElementById("lightbox").classList.add("hidden");
  document.getElementById("lightboxImg").src = "";
};
document.getElementById("lightbox").onclick = (e) => {
  if (e.target.id === "lightbox") document.getElementById("lightboxClose").click();
};

/* SEND + IMAGES */
document.getElementById("attachBtn").onclick = () => document.getElementById("fileInput").click();
document.getElementById("fileInput").onchange = (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  for (const f of files) {
    if (!f.type.startsWith("image/")) { showToast("Только фото"); continue; }
    if (f.size > MAX_IMAGE_SIZE) { showToast("Макс 8 МБ"); continue; }
    if (pendingFiles.length >= 5) { showToast("Макс 5 фото"); break; }
    pendingFiles.push(f);
  }
  renderPreviewBar();
};
function renderPreviewBar() {
  const bar = document.getElementById("previewBar");
  bar.innerHTML = "";
  if (!pendingFiles.length) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  pendingFiles.forEach((file, idx) => {
    const item = el(`<div class="preview-item"><img src="${URL.createObjectURL(file)}" alt=""><button type="button" class="preview-rm">✕</button></div>`);
    item.querySelector(".preview-rm").onclick = () => { pendingFiles.splice(idx, 1); renderPreviewBar(); };
    bar.appendChild(item);
  });
}
async function uploadImage(file, chatId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `chats/${chatId}/${currentUser.uid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  return await getDownloadURL(r);
}
async function sendMessage() {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  const files = [...pendingFiles];
  if ((!text && !files.length) || !currentChatId) return;
  input.value = ""; pendingFiles = []; renderPreviewBar();
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;
  try {
    if (files.length) showToast("Загрузка фото…");
    for (let i = 0; i < files.length; i++) {
      let imageUrl;
      try {
        imageUrl = await uploadImage(files[i], currentChatId);
      } catch (upErr) {
        console.error(upErr);
        showToast("Фото: " + translateAuthError(upErr));
        continue;
      }
      const msgText = (i === files.length - 1 && text) ? text : "";
      await addDoc(collection(db, "chats", currentChatId, "messages"), {
        senderId: currentUser.uid, senderName: currentProfile.name,
        text: msgText, imageUrl, timestamp: serverTimestamp()
      });
    }
    if (!files.length && text) {
      await addDoc(collection(db, "chats", currentChatId, "messages"), {
        senderId: currentUser.uid, senderName: currentProfile.name,
        text, timestamp: serverTimestamp()
      });
    }
    let lastPreview = text;
    if (files.length) lastPreview = text ? `📷 ${text}` : "📷 Фото";
    await updateDoc(doc(db, "chats", currentChatId), {
      lastMessage: (lastPreview || "📷").slice(0, 80),
      lastMessageTime: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    showToast(translateAuthError(err));
  } finally { sendBtn.disabled = false; }
}
document.getElementById("sendBtn").onclick = sendMessage;
document.getElementById("msgInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

/* MODAL */
const modal = document.getElementById("newChatModal");
function openModal(tab) {
  modal.classList.remove("hidden");
  document.querySelectorAll(".modal-tab").forEach(t => t.classList.toggle("active", t.dataset.mtab === tab));
  document.querySelectorAll(".modal-pane").forEach(p => p.classList.add("hidden"));
  document.getElementById("pane-" + tab).classList.remove("hidden");
}
document.getElementById("closeModal").onclick = () => modal.classList.add("hidden");
modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };
document.querySelectorAll(".modal-tab").forEach(tab => {
  tab.onclick = () => openModal(tab.dataset.mtab);
});
let userSearchTimeout;
document.getElementById("userSearch").oninput = (e) => {
  clearTimeout(userSearchTimeout);
  const val = e.target.value.trim().toLowerCase().replace(/^@/, "");
  userSearchTimeout = setTimeout(() => searchUsers(val, "userSearchResults", async (u) => {
    modal.classList.add("hidden");
    document.getElementById("userSearch").value = "";
    document.getElementById("userSearchResults").innerHTML = "";
    await startPrivateChat(u);
  }), 250);
};
async function searchUsers(term, elId, onPick) {
  const box = document.getElementById(elId);
  box.innerHTML = term ? '<div class="search-empty">Поиск…</div>' : "";
  if (!term) return;
  try {
    const snap = await getDocs(query(
      collection(db, "users"),
      where("username", ">=", term), where("username", "<=", term + "\uf8ff"), limit(15)
    ));
    box.innerHTML = "";
    let n = 0;
    snap.forEach(ds => {
      const u = ds.data();
      if (u.uid === currentUser.uid || u.deleted) return;
      n++;
      const item = el(`<div class="search-result-item"><div class="sr-avatar" style="background:${hashColor(u.name)}">${initials(u.name)}</div><div><div class="sr-name">${escapeHtml(u.name)}</div><div class="sr-username">@${escapeHtml(u.username)}</div></div></div>`);
      item.onclick = () => onPick(u);
      box.appendChild(item);
    });
    if (!n) box.innerHTML = '<div class="search-empty">Никого нет</div>';
  } catch (err) {
    box.innerHTML = `<div class="search-empty" style="color:var(--danger)">${escapeHtml(translateAuthError(err))}</div>`;
  }
}
async function startPrivateChat(other) {
  const uid1 = currentUser.uid, uid2 = other.uid;
  const chatId = [uid1, uid2].sort().join("_");
  const chatRef = doc(db, "chats", chatId);
  try {
    if (!(await getDoc(chatRef)).exists()) {
      await setDoc(chatRef, {
        type: "private", members: [uid1, uid2],
        memberNames: { [uid1]: currentProfile.name, [uid2]: other.name },
        lastMessage: "", lastMessageTime: serverTimestamp()
      });
    }
    openChat(chatId);
  } catch (err) { showToast(translateAuthError(err)); }
}
let groupSelected = {};
document.getElementById("groupUserSearch").oninput = (e) => {
  clearTimeout(userSearchTimeout);
  const val = e.target.value.trim().toLowerCase().replace(/^@/, "");
  userSearchTimeout = setTimeout(() => searchUsers(val, "groupSearchResults", (u) => {
    groupSelected[u.uid] = u;
    renderChips();
    document.getElementById("groupUserSearch").value = "";
    document.getElementById("groupSearchResults").innerHTML = "";
  }), 250);
};
function renderChips() {
  const box = document.getElementById("groupSelected");
  box.innerHTML = "";
  Object.values(groupSelected).forEach(u => {
    const chip = el(`<div class="chip">${escapeHtml(u.name)} <button type="button">✕</button></div>`);
    chip.querySelector("button").onclick = () => { delete groupSelected[u.uid]; renderChips(); };
    box.appendChild(chip);
  });
}
document.getElementById("createGroupBtn").onclick = async () => {
  const name = document.getElementById("groupName").value.trim();
  const ids = [currentUser.uid, ...Object.keys(groupSelected)];
  if (!name || ids.length < 2) return showToast("Название и участники");
  setLoading(true);
  try {
    const ref = await addDoc(collection(db, "chats"), {
      type: "group", name, members: ids, admins: [currentUser.uid],
      lastMessage: `${currentProfile.name} создал группу`, lastMessageTime: serverTimestamp()
    });
    document.getElementById("groupName").value = ""; groupSelected = {}; renderChips();
    modal.classList.add("hidden"); openChat(ref.id);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
};
document.getElementById("createChannelBtn").onclick = async () => {
  const name = document.getElementById("channelName").value.trim();
  const desc = document.getElementById("channelDesc").value.trim();
  if (!name) return showToast("Название");
  setLoading(true);
  try {
    const ref = await addDoc(collection(db, "chats"), {
      type: "channel", name, description: desc,
      members: [currentUser.uid], admins: [currentUser.uid],
      lastMessage: `Канал «${name}»`, lastMessageTime: serverTimestamp()
    });
    document.getElementById("channelName").value = "";
    document.getElementById("channelDesc").value = "";
    modal.classList.add("hidden"); openChat(ref.id);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
};
