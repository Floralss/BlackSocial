import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, getDocs, serverTimestamp, increment, arrayUnion, arrayRemove, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import {
  firebaseConfig, vaultConfig, ADMIN_EMAILS, ADMIN_SECRET, COIN_PACK, RATES
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
const APP_VERSION = "1.5.0";
const APP_PATCH = "1.4.0"; // bump on each release
applyTheme(localStorage.getItem("bs_theme") || "dark");

function isAdmin() {
  if (!currentUser) return false;
  if (sessionStorage.getItem("bs_admin") === "1") return true;
  const email = (currentUser.email || "").toLowerCase().trim();
  return ADMIN_EMAILS.map(e => e.toLowerCase().trim()).includes(email);
}
function refreshAdminMenu() {
  const btn = document.getElementById("menuAdmin");
  if (!btn) return;
  btn.style.display = isAdmin() ? "flex" : "none";
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


function makeInviteCode() {
  return "bs_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
function inviteUrl(code) {
  const base = location.origin + location.pathname.replace(/index\.html$/i, "");
  return base + (base.endsWith("/") ? "" : "/") + "?join=" + encodeURIComponent(code);
}
function applyCustomCss(cssText) {
  let tag = document.getElementById("userCustomCss");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "userCustomCss";
    document.head.appendChild(tag);
  }
  tag.textContent = cssText || "";
}
applyCustomCss(localStorage.getItem("bs_custom_css") || "");
function applyTheme(theme) {
  document.body.classList.remove("theme-light", "theme-black", "theme-midnight");
  if (theme && theme !== "dark") document.body.classList.add("theme-" + theme);
  localStorage.setItem("bs_theme", theme || "dark");
  document.querySelectorAll(".theme-opt").forEach(b => {
    b.classList.toggle("sel", b.dataset.theme === (theme || "dark"));
  });
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

function isOnline(profile) {
  if (!profile) return false;
  if (profile.settings?.showOnline === false) return false;
  const ls = profile.lastSeen;
  if (!ls) return false;
  const t = ls.toDate ? ls.toDate() : new Date(ls);
  return (Date.now() - t.getTime()) < 2 * 60 * 1000; // 2 мин
}
let presenceTimer = null;
function startPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  const beat = async () => {
    if (!currentUser) return;
    try { await updateDoc(doc(db, "users", currentUser.uid), { lastSeen: serverTimestamp() }); } catch (_) {}
  };
  beat();
  presenceTimer = setInterval(beat, 45000);
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

document.getElementById("googleLoginBtn")?.addEventListener("click", async () => {
  if (authBusy) return;
  authBusy = true; setLoading(true);
  document.getElementById("loginError").textContent = "";
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error(err);
    document.getElementById("loginError").textContent = translateAuthError(err);
  } finally { authBusy = false; setLoading(false); }
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
    // ждём профиль после регистрации (гонка с createUser)
    if (!snap.exists()) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 150));
        snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) break;
      }
    }
    currentProfile = snap.exists() ? snap.data() : null;
    if (currentProfile?.deleted) {
      showToast("Аккаунт удалён администратором");
      await signOut(auth);
      return;
    }
    if (!snap.exists()) {
      const baseName = (user.displayName || (user.email || "User").split("@")[0]).slice(0, 24);
      let uname = (baseName.toLowerCase().replace(/[^a-z0-9_]/g, "") || ("u" + user.uid.slice(0, 8)));
      if (uname.length < 3) uname = "u" + user.uid.slice(0, 8);
      const taken = await getDocs(query(collection(db, "users"), where("username", "==", uname), limit(1)));
      if (!taken.empty) uname = uname.slice(0, 10) + user.uid.slice(0, 5);
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: user.displayName || baseName,
        username: uname,
        email: user.email || "",
        avatarUrl: user.photoURL || "",
        blackCoins: 0, deleted: false, contacts: [], nfts: [], gifts: [],
        createdAt: serverTimestamp()
      });
      snap = await getDoc(doc(db, "users", user.uid));
      currentProfile = snap.data();
    } else {
      currentProfile = snap.data();
      // НИКОГДА не перезаписываем username/name если уже есть
    }
    const ver = document.getElementById("appVersion");
    if (ver) ver.textContent = "BlackSocial v" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "1.4.0");
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    refreshAdminMenu();
    updateDrawer();
    startPresence();
    subscribeChats();
    // auto-join by link
    const joinCode = new URLSearchParams(location.search).get("join");
    if (joinCode) {
      history.replaceState({}, "", location.pathname);
      setTimeout(async () => {
        try {
          const snap = await getDocs(query(collection(db, "chats"), where("inviteCode", "==", joinCode), limit(1)));
          if (!snap.empty) {
            const c = { id: snap.docs[0].id, ...snap.docs[0].data() };
            await joinChat(c);
          } else showToast("Ссылка-приглашение не найдена");
        } catch (e) { console.warn(e); }
      }, 600);
    }
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
  ["profileScreen", "settingsScreen", "shopScreen", "adminScreen", "chatInfoScreen", "userProfileScreen", "contactsScreen", "nftScreen"].forEach(id => {
    document.getElementById(id)?.classList.add("hidden");
  });
  document.getElementById("app")?.classList.remove("overlay-open");
}
function showScreen(id) {
  hideAllScreens();
  document.getElementById(id)?.classList.remove("hidden");
  document.getElementById("app")?.classList.add("overlay-open");
}
document.getElementById("menuProfile").addEventListener("click", () => { closeDrawer(); openProfile(); });
document.getElementById("menuSettings").addEventListener("click", () => { closeDrawer(); openSettings(); });
document.getElementById("menuContacts")?.addEventListener("click", () => { closeDrawer(); openContacts(); });
document.getElementById("menuNft")?.addEventListener("click", () => { closeDrawer(); openNftScreen(); });
document.getElementById("closeContacts")?.addEventListener("click", () => { document.getElementById("contactsScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });
document.getElementById("closeNft")?.addEventListener("click", () => { document.getElementById("nftScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });
document.getElementById("closeChatInfo")?.addEventListener("click", () => { document.getElementById("chatInfoScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });
document.getElementById("closeUserProfile")?.addEventListener("click", () => { document.getElementById("userProfileScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });
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
  showScreen("profileScreen");
  setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
  document.getElementById("editName").value = currentProfile.name || "";
  document.getElementById("editUsername").value = currentProfile.username || "";
  document.getElementById("editEmail").value = currentProfile.email || "";
  const bioEl = document.getElementById("editBio");
  if (bioEl) bioEl.value = currentProfile.bio || "";
  const wh = document.getElementById("editWorkHours");
  if (wh) wh.value = currentProfile.workHours || "";
  // own nfts preview
  const box = document.getElementById("ownNftPreview");
  if (box) {
    box.innerHTML = "Загрузка…";
    loadUserNfts(currentUser.uid, currentProfile.nfts || []).then(list => {
      box.innerHTML = "";
      if (!list.length) box.innerHTML = '<span style="color:var(--text-2);font-size:13px">Нет NFT</span>';
      else list.forEach(n => box.appendChild(nftMiniEl(n)));
    });
  }
}
document.getElementById("closeProfile").addEventListener("click", () => { document.getElementById("profileScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });
document.getElementById("changeAvatarBtn").addEventListener("click", () => document.getElementById("avatarInput").click());
document.getElementById("avatarInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; e.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("Только изображения");
  if (file.size > MAX_IMAGE_SIZE) return showToast("Макс 8 МБ");
  setLoading(true);
  try {
    const url = await fileToDataUrl(file, 400, 0.65);
    if (url.length > 700000) throw new Error("Аватар слишком большой");
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
    const bio = document.getElementById("editBio")?.value.trim() || "";
    const workHours = document.getElementById("editWorkHours")?.value.trim() || "";
    await updateDoc(doc(db, "users", currentUser.uid), { name, username, bio, workHours });
    currentProfile.name = name; currentProfile.username = username; currentProfile.bio = bio;
    currentProfile.workHours = workHours;
    // обновить имя в личных чатах
    try {
      const chatsSnap = await getDocs(query(collection(db, "chats"), where("members", "array-contains", currentUser.uid)));
      for (const d of chatsSnap.docs) {
        const c = d.data();
        if (c.type === "private" && c.memberNames) {
          await updateDoc(doc(db, "chats", d.id), { [`memberNames.${currentUser.uid}`]: name });
        }
      }
    } catch (e) { console.warn("memberNames update", e); }
    updateDrawer(); showToast("Сохранено");
  } catch (err) { showToast(translateAuthError(err)); }
  finally { setLoading(false); }
});

/* SETTINGS */
let settingsView = "main";

function openSettings() {
  settingsView = "main";
  showScreen("settingsScreen");
  renderSettingsView();
}
document.getElementById("closeSettings").addEventListener("click", () => {
  if (settingsView !== "main") {
    settingsView = "main";
    renderSettingsView();
    return;
  }
  document.getElementById("settingsScreen").classList.add("hidden");
  document.getElementById("app")?.classList.remove("overlay-open");
});

function renderSettingsView() {
  const body = document.getElementById("settingsBody");
  const title = document.getElementById("settingsTitle");
  if (!body) return;
  const s = currentProfile.settings || {};
  const defaults = { showOnline: true, showPreview: true, confirmLogout: true, sound: true, hideCoins: false };

  if (settingsView === "main") {
    title.textContent = "Настройки";
    body.innerHTML = `
      <div class="settings-profile-card">
        <div class="settings-avatar" id="settingsAv"></div>
        <div>
          <div class="settings-name">${escapeHtml(currentProfile.name || "")}${hasPremium(currentProfile) ? " ✦" : ""}</div>
          <div class="settings-uname">@${escapeHtml(currentProfile.username || "")}</div>
        </div>
      </div>
      <div class="settings-menu-group">
        <button class="settings-menu-item" data-view="privacy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Конфиденциальность
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" data-view="notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Уведомления и звуки
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" data-view="security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Безопасность
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" data-view="advanced">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Продвинутые настройки
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" data-view="css">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Свой CSS
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" data-view="admin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Админ-доступ
          <span class="chev">›</span>
        </button>
      </div>
      <div class="settings-menu-group" style="margin-top:12px">
        <button class="settings-menu-item" id="settingsPremiumBtn">
          <span style="color:#a78bfa">✦</span> Black Premium
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" id="settingsStarsBtn">
          <span style="color:#fbbf24">★</span> Мои BlackCoin
          <span class="chev">›</span>
        </button>
        <button class="settings-menu-item" id="settingsGiftBtn">
          <span>🎁</span> Отправить подарок
          <span class="chev">›</span>
        </button>
      </div>
      <button class="btn-danger" id="logoutFromSettings" style="margin-top:20px;width:100%">Выйти из аккаунта</button>
    `;
    setAvatarEl(document.getElementById("settingsAv"), currentProfile);
    body.querySelectorAll("[data-view]").forEach(btn => {
      btn.onclick = () => { settingsView = btn.dataset.view; renderSettingsView(); };
    });
    document.getElementById("settingsPremiumBtn").onclick = () => {
      document.getElementById("settingsScreen").classList.add("hidden");
      openShop();
    };
    document.getElementById("settingsStarsBtn").onclick = () => {
      document.getElementById("settingsScreen").classList.add("hidden");
      openShop();
    };
    document.getElementById("settingsGiftBtn").onclick = () => {
      showToast("Открой профиль пользователя → 🎁 Подарить");
    };
    document.getElementById("logoutFromSettings").onclick = async () => {
      if (confirm("Выйти?")) await signOut(auth);
    };
    return;
  }

  title.textContent = {
    privacy: "Конфиденциальность",
    notifications: "Уведомления и звуки",
    security: "Безопасность",
    advanced: "Продвинутые",
    css: "Свой CSS",
    admin: "Админ-доступ"
  }[settingsView] || "Настройки";

  if (settingsView === "privacy") {
    const val = (k) => (s[k] !== undefined ? !!s[k] : defaults[k]);
    body.innerHTML = `
      <div class="settings-section">
        <div class="settings-row"><span>Показывать «в сети»</span><button type="button" class="toggle ${val("showOnline") ? "on" : ""}" data-key="showOnline"></button></div>
        <div class="settings-row"><span>Кто может писать</span>
          <select id="whoCanMessage" style="background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:8px">
            <option value="all" ${(s.whoCanMessage||"all")==="all" ? "selected" : ""}>Все</option>
            <option value="contacts" ${s.whoCanMessage==="contacts" ? "selected" : ""}>Только из чатов</option>
          </select>
        </div>
        <div class="settings-row"><span>Читать превью в списке</span><button type="button" class="toggle ${val("showPreview") ? "on" : ""}" data-key="showPreview"></button></div>
      </div>`;
  } else if (settingsView === "notifications") {
    const val = (k) => (s[k] !== undefined ? !!s[k] : defaults[k]);
    body.innerHTML = `
      <div class="settings-section">
        <div class="settings-row"><span>Звук сообщений (локально)</span><button type="button" class="toggle ${val("sound") ? "on" : ""}" data-key="sound"></button></div>
      </div>`;
  } else if (settingsView === "security") {
    const val = (k) => (s[k] !== undefined ? !!s[k] : defaults[k]);
    body.innerHTML = `
      <div class="settings-section">
        <div class="settings-row"><span>Подтверждение перед выходом</span><button type="button" class="toggle ${val("confirmLogout") ? "on" : ""}" data-key="confirmLogout"></button></div>
        <div class="settings-row"><span>Скрыть BlackCoin в меню</span><button type="button" class="toggle ${val("hideCoins") ? "on" : ""}" data-key="hideCoins"></button></div>
      </div>`;
  } else if (settingsView === "advanced") {
    body.innerHTML = `
      <div class="settings-section">
        <p style="font-size:13px;color:var(--text-2);padding:8px 0">Дополнительные параметры интерфейса.</p>
        <div class="settings-row"><span>Масштаб по умолчанию</span><span style="color:var(--text-2)">100%</span></div>
      </div>`;
  } else if (settingsView === "css") {
    body.innerHTML = `
      <div class="settings-section">
        <p style="font-size:12px;color:var(--text-2);margin-bottom:8px">Пиши CSS под себя. Пример: <code>:root { --accent:#22c55e; }</code></p>
        <textarea id="customCssArea" rows="8" style="width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:12px;padding:10px;font-family:monospace;font-size:12px" placeholder=":root { --bg:#000; --accent:#f43f5e; }"></textarea>
        <button class="btn-primary" id="saveCustomCss" style="width:100%;margin-top:8px">Применить CSS</button>
        <button class="btn-outline" id="resetCustomCss" style="width:100%;margin-top:8px">Сбросить</button>
      </div>`;
    const area = document.getElementById("customCssArea");
    if (area) area.value = localStorage.getItem("bs_custom_css") || currentProfile.settings?.customCss || "";
    document.getElementById("saveCustomCss")?.addEventListener("click", () => {
      const css = document.getElementById("customCssArea").value;
      localStorage.setItem("bs_custom_css", css);
      let st = document.getElementById("userCustomCss");
      if (!st) { st = document.createElement("style"); st.id = "userCustomCss"; document.head.appendChild(st); }
      st.textContent = css;
      showToast("CSS применён");
    });
    document.getElementById("resetCustomCss")?.addEventListener("click", () => {
      localStorage.removeItem("bs_custom_css");
      document.getElementById("customCssArea").value = "";
      const st = document.getElementById("userCustomCss");
      if (st) st.textContent = "";
      showToast("Сброшено");
    });
  } else if (settingsView === "admin") {
    body.innerHTML = `
      <div class="settings-section">
        <div class="profile-field"><label>Код админа</label><input type="password" id="adminUnlockCode" placeholder="код из firebase-config"></div>
        <button class="btn-primary" id="adminUnlockBtn" style="width:100%;margin-top:8px">Открыть админку</button>
      </div>`;
    document.getElementById("adminUnlockBtn")?.addEventListener("click", () => {
      const code = document.getElementById("adminUnlockCode").value.trim();
      if (code === ADMIN_SECRET || isAdmin()) {
        sessionStorage.setItem("bs_admin", "1");
        refreshAdminMenu();
        showToast("Админ-доступ открыт");
        document.getElementById("settingsScreen").classList.add("hidden");
        openAdmin();
      } else {
        showToast("Неверный код админа");
      }
    });
  }

  body.querySelectorAll(".toggle[data-key]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.classList.toggle("on");
      const settings = { ...(currentProfile.settings || {}) };
      settings[btn.dataset.key] = btn.classList.contains("on");
      currentProfile.settings = settings;
      try { await updateDoc(doc(db, "users", currentUser.uid), { settings }); updateDrawer(); }
      catch (e) { showToast(translateAuthError(e)); }
    });
  });
  const whoSel = document.getElementById("whoCanMessage");
  if (whoSel) {
    whoSel.addEventListener("change", async (e) => {
      const settings = { ...(currentProfile.settings || {}), whoCanMessage: e.target.value };
      currentProfile.settings = settings;
      try { await updateDoc(doc(db, "users", currentUser.uid), { settings }); }
      catch (err) { showToast(translateAuthError(err)); }
    });
  }
}

/* SHOP + BLACKVAULT PAY */
function openShop() {
  showScreen("shopScreen");
  document.getElementById("shopBalance").textContent = `${currentProfile.blackCoins || 0} BC`;
  const ve = document.getElementById("vaultEmail");
  if (ve && !ve.value) ve.value = currentUser.email || "";
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
document.getElementById("closeShop").addEventListener("click", () => { document.getElementById("shopScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });

document.getElementById("buyCoinsBtn").addEventListener("click", async () => {
  const email = document.getElementById("vaultEmail").value.trim();
  const pass = document.getElementById("vaultPassword").value;
  if (!email || !pass) return showToast("Укажи email и пароль BlackVault");
  setLoading(true);
  try {
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
    document.getElementById("vaultEmail").value = "";
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
  showScreen("adminScreen");
}
document.getElementById("closeAdmin").addEventListener("click", () => { document.getElementById("adminScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });

async function findUserByUsername(uname) {
  uname = (uname || "").replace(/^@/, "").toLowerCase().trim();
  if (!uname) return null;
  // by username
  let snap = await getDocs(query(collection(db, "users"), where("username", "==", uname), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  // by email
  if (uname.includes("@")) {
    snap = await getDocs(query(collection(db, "users"), where("email", "==", uname), limit(1)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return null;
}
document.getElementById("adminGiveBtn").addEventListener("click", async () => {
  if (!isAdmin()) return showToast("Нет доступа админа");
  setLoading(true);
  try {
    const u = await findUserByUsername(document.getElementById("adminGiveUser").value);
    const amt = parseInt(document.getElementById("adminGiveAmount").value, 10);
    if (!u) return showToast("Пользователь не найден");
    if (!amt || amt < 1) return showToast("Укажи сумму BC");
    await updateDoc(doc(db, "users", u.id), { blackCoins: increment(amt) });
    showToast(`Выдано ${amt} BC → @${u.username}`);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});
document.getElementById("adminDelBtn").addEventListener("click", async () => {
  if (!isAdmin()) return showToast("Нет доступа админа");
  setLoading(true);
  try {
    const u = await findUserByUsername(document.getElementById("adminDelUser").value);
    if (!u) return showToast("Не найден");
    if (!confirm(`Удалить @${u.username}?`)) return;
    await updateDoc(doc(db, "users", u.id), { deleted: true });
    showToast("Аккаунт удалён (deleted=true)");
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});
document.getElementById("adminRestoreBtn").addEventListener("click", async () => {
  if (!isAdmin()) return showToast("Нет доступа админа");
  setLoading(true);
  try {
    const u = await findUserByUsername(document.getElementById("adminRestoreUser").value);
    if (!u) return showToast("Не найден");
    await updateDoc(doc(db, "users", u.id), { deleted: false });
    showToast("Аккаунт восстановлен");
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
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
  const inv = document.getElementById("inviteBtn");
  if (inv) {
    const showInv = currentChat.type === "group" || currentChat.type === "channel";
    inv.classList.toggle("hidden", !showInv);
  }
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

      // Special centered gift cards (Telegram-style)
      if (m.type === "gift" && m.gift) {
        const g = m.gift;
        const fromName = escapeHtml(m.senderName || g.fromName || "Кто-то");
        let headerText = "";
        let cardHtml = "";
        if (g.kind === "nft" || g.kind === "collectible") {
          headerText = `${fromName} передал(а) Вам уникальный коллекционный подарок`;
          cardHtml = `
            <div class="gift-card gift-nft">
              <div class="gift-ribbon">подарок</div>
              <div class="gift-art" style="background:${g.bg || 'linear-gradient(135deg,#1a1a2e,#0a0a12)'}">
                ${g.imageUrl ? `<img src="${escapeHtml(g.imageUrl)}" alt="">` : `<span class="gift-emoji-big">${g.emoji || "🎁"}</span>`}
              </div>
              <div class="gift-title">Подарок от ${fromName}</div>
              <div class="gift-name">${escapeHtml(g.name || "Коллекционный подарок")}${g.nftId ? ` #${g.nftId}` : ""}</div>
              ${g.model ? `<div class="gift-meta-row"><span>Модель</span><span>${escapeHtml(g.model)}</span></div>` : ""}
              ${g.backdrop ? `<div class="gift-meta-row"><span>Фон</span><span>${escapeHtml(g.backdrop)}</span></div>` : ""}
              ${g.symbol ? `<div class="gift-meta-row"><span>Значок</span><span>${escapeHtml(g.symbol)}</span></div>` : ""}
              <button type="button" class="gift-btn">Посмотреть</button>
            </div>`;
        } else if (g.kind === "coins" || g.kind === "stars") {
          headerText = `${fromName} отправил(а) Вам подарок стоимостью ${g.amount || 0} BC`;
          cardHtml = `
            <div class="gift-card gift-stars">
              <div class="gift-box-art">
                <div class="gift-star-icon">★</div>
                <div class="gift-box-open">🎁</div>
              </div>
              <div class="gift-amount">${g.amount || 0} BlackCoin</div>
              <div class="gift-desc">Используйте BlackCoin, чтобы открывать контент и получать услуги в BlackSocial.</div>
              <button type="button" class="gift-btn">Подробнее</button>
            </div>`;
        } else if (g.kind === "premium") {
          headerText = `${fromName} подарил(а) Вам Premium`;
          cardHtml = `
            <div class="gift-card gift-premium">
              <div class="gift-box-art premium-box">
                <div class="gift-star-icon">★</div>
                <div class="gift-box-open">🎁</div>
              </div>
              <div class="gift-amount">Premium на ${g.months || 1} мес</div>
              <div class="gift-desc">Подписка на эксклюзивные функции BlackSocial.</div>
              <button type="button" class="gift-btn">Активировать</button>
            </div>`;
        } else {
          headerText = `${fromName} отправил(а) подарок`;
          cardHtml = `
            <div class="gift-card">
              <div class="gift-art" style="background:${g.bg || '#f59e0b'}">${g.emoji || "🎁"}</div>
              <div class="gift-name">${escapeHtml(g.name || "Подарок")}</div>
              ${g.message ? `<div class="gift-msg">«${escapeHtml(g.message)}»</div>` : ""}
            </div>`;
        }
        const row = el(`
          <div class="msg-row gift-row">
            <div class="gift-header-text">${headerText}</div>
            ${cardHtml}
            <div class="msg-meta gift-meta"><span class="msg-time">${fmtTime(m.timestamp)}</span></div>
          </div>`);
        msgsEl.appendChild(row);
        return;
      }

      let inner = "";
      if (m.imageUrl) {
        if (m.mediaType === "video" || (typeof m.imageUrl === "string" && m.imageUrl.startsWith("data:video"))) {
          inner += `<video class="msg-img" src="${escapeHtml(m.imageUrl)}" controls playsinline style="max-width:100%;border-radius:12px"></video>`;
        } else {
          inner += `<img class="msg-img" src="${escapeHtml(m.imageUrl)}" alt="" loading="lazy">`;
        }
      }
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
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) { showToast("Только фото/видео"); continue; }
    if (f.type.startsWith("video/") && f.size > 15 * 1024 * 1024) { showToast("Видео макс 15 МБ"); continue; }
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
function fileToDataUrl(file, maxW = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (file.type.startsWith("video/")) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (maxW && w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}
async function uploadImage(file, chatId) {
  // Без Firebase Storage (CORS с Vercel/Netlify часто ломает). Шлём сжатый data URL.
  const isVid = file.type.startsWith("video/");
  if (isVid && file.size > 8 * 1024 * 1024) throw new Error("Видео до 8 МБ");
  const dataUrl = await fileToDataUrl(file, isVid ? 0 : 1280, 0.7);
  if (dataUrl.length > 900000) throw new Error("Файл слишком большой — сожми или выбери меньше");
  return dataUrl;
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
        text: msgText, imageUrl,
        mediaType: files[i].type.startsWith("video/") ? "video" : "image",
        timestamp: serverTimestamp()
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
  term = (term || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
  box.innerHTML = term ? '<div class="search-empty">Поиск…</div>' : "";
  if (!term) return;
  try {
    const found = new Map();

    // точное совпадение
    try {
      const exact = await getDocs(query(collection(db, "users"), where("username", "==", term), limit(5)));
      exact.forEach(ds => found.set(ds.id, { id: ds.id, ...ds.data() }));
    } catch (e) { console.warn("exact", e); }

    // префикс
    try {
      const pref = await getDocs(query(
        collection(db, "users"),
        where("username", ">=", term),
        where("username", "<=", term + "\uf8ff"),
        limit(25)
      ));
      pref.forEach(ds => found.set(ds.id, { id: ds.id, ...ds.data() }));
    } catch (e) { console.warn("prefix", e); }

    // запасной вариант: сканируем users и фильтруем на клиенте
    if (found.size === 0) {
      const all = await getDocs(query(collection(db, "users"), limit(200)));
      all.forEach(ds => {
        const u = { id: ds.id, ...ds.data() };
        const un = String(u.username || "").toLowerCase();
        const nm = String(u.name || "").toLowerCase();
        if (un === term || un.startsWith(term) || un.includes(term) || nm.includes(term)) {
          found.set(ds.id, u);
        }
      });
    }

    box.innerHTML = "";
    let n = 0;
    for (const u of found.values()) {
      if (!u.uid) u.uid = u.id;
      if (u.uid === currentUser.uid) continue;
      if (u.deleted === true) continue;
      n++;
      const item = el(`<div class="search-result-item"><div class="sr-avatar" style="background:${hashColor(u.name)}">${initials(u.name)}</div><div><div class="sr-name">${escapeHtml(u.name || "?")}</div><div class="sr-username">@${escapeHtml(u.username || "")}</div></div></div>`);
      item.onclick = () => onPick(u);
      box.appendChild(item);
    }
    if (!n) {
      // если нашли только себя
      const selfHit = [...found.values()].some(u => (u.uid || u.id) === currentUser.uid);
      if (selfHit) {
        box.innerHTML = '<div class="search-empty">Это твой юзернейм — себя в чат добавить нельзя</div>';
      } else {
        box.innerHTML = '<div class="search-empty">Никого нет. Проверь юзернейм без @</div>';
      }
    }
  } catch (err) {
    console.error(err);
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
document.getElementById("groupPublicToggle")?.addEventListener("click", function() {
  this.classList.toggle("on");
});
document.getElementById("channelPublicToggle")?.addEventListener("click", function() {
  this.classList.toggle("on");
});

document.getElementById("createGroupBtn").onclick = async () => {
  const name = document.getElementById("groupName").value.trim();
  const ids = [currentUser.uid, ...Object.keys(groupSelected)];
  if (!name) return showToast("Укажи название группы");
  if (ids.length < 1) return showToast("Ошибка участников");
  const isPublic = document.getElementById("groupPublicToggle")?.classList.contains("on") !== false;
  setLoading(true);
  try {
    const inviteCode = makeInviteCode();
    const ref = await addDoc(collection(db, "chats"), {
      type: "group", name, members: ids, admins: [currentUser.uid],
      public: isPublic, inviteCode,
      lastMessage: `${currentProfile.name} создал группу`, lastMessageTime: serverTimestamp()
    });
    document.getElementById("groupName").value = ""; groupSelected = {}; renderChips();
    modal.classList.add("hidden"); openChat(ref.id);
    showToast("Группа создана · ссылка в кнопке 🔗");
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
};
document.getElementById("createChannelBtn").onclick = async () => {
  const name = document.getElementById("channelName").value.trim();
  const desc = document.getElementById("channelDesc").value.trim();
  if (!name) return showToast("Название");
  const isPublic = document.getElementById("channelPublicToggle")?.classList.contains("on") !== false;
  setLoading(true);
  try {
    const inviteCode = makeInviteCode();
    const ref = await addDoc(collection(db, "chats"), {
      type: "channel", name, description: desc,
      members: [currentUser.uid], admins: [currentUser.uid],
      public: isPublic, inviteCode,
      lastMessage: `Канал «${name}»`, lastMessageTime: serverTimestamp()
    });
    document.getElementById("channelName").value = "";
    document.getElementById("channelDesc").value = "";
    modal.classList.add("hidden"); openChat(ref.id);
    showToast("Канал создан · ссылка в кнопке 🔗");
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
};

/* DISCOVER groups/channels */
let discoverTimeout;
document.getElementById("discoverSearch")?.addEventListener("input", (e) => {
  clearTimeout(discoverTimeout);
  const val = e.target.value.trim().toLowerCase();
  discoverTimeout = setTimeout(() => searchPublicChats(val), 300);
});

async function searchPublicChats(term) {
  const box = document.getElementById("discoverResults");
  if (!box) return;
  box.innerHTML = term ? '<div class="search-empty">Поиск…</div>' : "";
  if (!term) return;
  try {
    const snap = await getDocs(query(collection(db, "chats"), where("public", "==", true), limit(50)));
    box.innerHTML = "";
    let n = 0;
    snap.forEach(ds => {
      const c = { id: ds.id, ...ds.data() };
      if (!["group", "channel"].includes(c.type)) return;
      const name = (c.name || "").toLowerCase();
      if (!name.includes(term)) return;
      if ((c.members || []).includes(currentUser.uid)) return;
      n++;
      const icon = c.type === "channel" ? "📢" : "👥";
      const item = el(`<div class="search-result-item"><div class="sr-avatar" style="background:${hashColor(c.name)}">${icon}</div><div><div class="sr-name">${escapeHtml(c.name)}</div><div class="sr-username">${c.type === "channel" ? "Канал" : "Группа"} · ${(c.members || []).length}</div></div></div>`);
      item.onclick = () => joinChat(c);
      box.appendChild(item);
    });
    if (!n) box.innerHTML = '<div class="search-empty">Ничего не найдено среди публичных</div>';
  } catch (err) {
    box.innerHTML = `<div class="search-empty" style="color:var(--danger)">${escapeHtml(translateAuthError(err))}</div>`;
  }
}

async function joinChat(chat) {
  setLoading(true);
  try {
    const ref = doc(db, "chats", chat.id);
    const members = chat.members || [];
    if (!members.includes(currentUser.uid)) {
      await updateDoc(ref, { members: [...members, currentUser.uid] });
    }
    modal.classList.add("hidden");
    showToast("Ты вступил!");
    // wait snapshot
    setTimeout(() => openChat(chat.id), 400);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

document.getElementById("joinByLinkBtn")?.addEventListener("click", async () => {
  let raw = document.getElementById("joinLinkInput").value.trim();
  if (!raw) return showToast("Вставь ссылку или код");
  let code = raw;
  try {
    if (raw.includes("join=")) code = new URL(raw, location.href).searchParams.get("join") || raw;
  } catch (_) {}
  code = code.replace(/^.*join=/, "").split("&")[0].trim();
  setLoading(true);
  try {
    const snap = await getDocs(query(collection(db, "chats"), where("inviteCode", "==", code), limit(1)));
    if (snap.empty) { showToast("Ссылка недействительна"); return; }
    const c = { id: snap.docs[0].id, ...snap.docs[0].data() };
    await joinChat(c);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});

/* INVITE LINK in chat */
document.getElementById("inviteBtn")?.addEventListener("click", async () => {
  if (!currentChat || !["group", "channel"].includes(currentChat.type)) return;
  let code = currentChat.inviteCode;
  if (!code) {
    code = makeInviteCode();
    try {
      await updateDoc(doc(db, "chats", currentChatId), { inviteCode: code });
      currentChat.inviteCode = code;
    } catch (e) { return showToast(translateAuthError(e)); }
  }
  document.getElementById("inviteCodeOut").value = code;
  document.getElementById("inviteLinkOut").value = inviteUrl(code);
  document.getElementById("inviteModal").classList.remove("hidden");
});
document.getElementById("closeInviteModal")?.addEventListener("click", () => {
  document.getElementById("inviteModal").classList.add("hidden");
});
document.getElementById("copyInviteBtn")?.addEventListener("click", async () => {
  const link = document.getElementById("inviteLinkOut").value;
  try {
    await navigator.clipboard.writeText(link);
    showToast("Ссылка скопирована");
  } catch (_) {
    document.getElementById("inviteLinkOut").select();
    showToast("Выдели и скопируй вручную");
  }
});
document.getElementById("regenInviteBtn")?.addEventListener("click", async () => {
  if (!currentChatId) return;
  const code = makeInviteCode();
  try {
    await updateDoc(doc(db, "chats", currentChatId), { inviteCode: code });
    currentChat.inviteCode = code;
    document.getElementById("inviteCodeOut").value = code;
    document.getElementById("inviteLinkOut").value = inviteUrl(code);
    showToast("Новая ссылка создана");
  } catch (e) { showToast(translateAuthError(e)); }
});



/* ===== CHAT INFO / MEMBERS / PROFILE ===== */
document.getElementById("chatInfoBtn")?.addEventListener("click", () => {
  if (!currentChat) return;
  if (currentChat.type === "private") openPeerProfile();
  else openChatInfo();
});

async function openPeerProfile() {
  const otherUid = currentChat.members.find(m => m !== currentUser.uid);
  if (!otherUid) return;
  setLoading(true);
  try {
    const snap = await getDoc(doc(db, "users", otherUid));
    if (!snap.exists()) return showToast("Профиль не найден");
    const u = { uid: otherUid, ...snap.data() };
    await renderUserProfile(u, true);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

async function renderUserProfile(u, isPeer) {
  showScreen("userProfileScreen");
  const body = document.getElementById("userProfileBody");
  body.innerHTML = "";
  const contacts = currentProfile.contacts || [];
  const isContact = contacts.includes(u.uid);
  const head = el(`<div class="tg-profile">
    <div class="profile-avatar-big" id="peerAv"></div>
    <div class="tg-name">${escapeHtml(u.name || "")} ${hasPremium(u) ? "✦" : ""}</div>
    <div class="tg-status">${isOnline(u) ? "в сети" : "был(а) недавно"}</div>
  </div>`);
  body.appendChild(head);
  setAvatarEl(document.getElementById("peerAv"), u);

  // NFT / gifts row
  const nfts = await loadUserNfts(u.uid, u.nfts || []);
  const userGifts = u.gifts || [];
  const giftsSec = el(`<div class="tg-section">
    <div class="tg-gifts-head"><span>🎁 Подарки и NFT</span><span style="color:var(--text-2);font-weight:500">${userGifts.length + nfts.length}</span></div>
    <div class="tg-gifts-row" id="peerGifts"></div>
  </div>`);
  body.appendChild(giftsSec);
  const row = document.getElementById("peerGifts");
  if (!userGifts.length && !nfts.length) {
    row.innerHTML = '<span style="color:var(--text-2);font-size:13px;padding:4px 0">Пока пусто</span>';
  } else {
    userGifts.slice(-12).reverse().forEach(g => {
      const m = el(`<div class="tg-gift-mini" title="${escapeHtml((g.fromName||"") + ": " + (g.message||g.name||""))}"></div>`);
      if (g.imageUrl) { const im=document.createElement("img"); im.src=g.imageUrl; m.appendChild(im); }
      else { m.style.background = g.bg || "#f59e0b"; m.textContent = g.emoji || "🎁"; }
      row.appendChild(m);
    });
    nfts.forEach(n => row.appendChild(nftMiniEl(n)));
  }

  // info rows
  const info = el(`<div class="tg-section"></div>`);
  if (u.bio) {
    info.appendChild(el(`<div class="tg-row"><div class="tg-row-label">О себе</div><div class="tg-row-value">${escapeHtml(u.bio)}</div></div>`));
  }
  if (u.workHours) {
    info.appendChild(el(`<div class="tg-row"><div class="tg-row-label">Активность</div><div class="tg-row-value">${escapeHtml(u.workHours)}</div></div>`));
  }
  info.appendChild(el(`<div class="tg-row"><div class="tg-row-label">Имя пользователя</div><div class="tg-row-value">@${escapeHtml(u.username || "")}</div></div>`));
  if (hasPremium(u)) {
    info.appendChild(el(`<div class="tg-row"><div class="tg-row-label">Статус</div><div class="tg-row-value"><span class="premium-badge">PREMIUM</span></div></div>`));
  }
  body.appendChild(info);

  if (isPeer) {
    const actions = el(`<div class="profile-actions" style="margin-top:16px">
      <button class="btn-primary" id="toggleContactBtn">${isContact ? "Удалить из контактов" : "Добавить в контакты"}</button>
      <button class="btn-outline" id="sendGiftBtn" style="width:100%">🎁 Подарить</button>
      <button class="btn-outline" id="writePeerBtn" style="width:100%">Написать</button>
      <button class="btn-outline" id="callBetaBtn" style="width:100%">📞 Звонок (бета)</button>
    </div>`);
    body.appendChild(actions);
    document.getElementById("sendGiftBtn").onclick = () => sendGiftToUser(u);
    document.getElementById("callBetaBtn").onclick = () => showToast("Звонки в бета-тесте. Скоро · баги известны");
    document.getElementById("toggleContactBtn").onclick = async () => {
      try {
        if (isContact) {
          await updateDoc(doc(db, "users", currentUser.uid), { contacts: arrayRemove(u.uid) });
          currentProfile.contacts = (currentProfile.contacts || []).filter(x => x !== u.uid);
          showToast("Удалён из контактов");
        } else {
          await updateDoc(doc(db, "users", currentUser.uid), { contacts: arrayUnion(u.uid) });
          currentProfile.contacts = [...(currentProfile.contacts || []), u.uid];
          showToast("В контактах");
        }
        renderUserProfile(u, true);
      } catch (e) { showToast(translateAuthError(e)); }
    };
    document.getElementById("writePeerBtn").onclick = () => {
      document.getElementById("userProfileScreen").classList.add("hidden");
    };
  }
}

async function openChatInfo() {
  if (!currentChat) return;
  showScreen("chatInfoScreen");
  document.getElementById("chatInfoTitle").textContent = currentChat.type === "channel" ? "Канал" : "Группа";
  const body = document.getElementById("chatInfoBody");
  body.innerHTML = '<div class="search-empty">Загрузка…</div>';
  const isAdm = (currentChat.admins || []).includes(currentUser.uid);
  const members = currentChat.members || [];

  const photoUrl = currentChat.photoUrl || "";
  let html = `
    <div class="profile-avatar-wrap">
      <div class="profile-avatar-big" id="ciAvatar" style="background:${hashColor(currentChat.name)};${!photoUrl ? "" : "background-image:url(" + photoUrl + ");background-size:cover;background-position:center"}">${photoUrl ? "" : initials(currentChat.name)}</div>
      ${isAdm ? `<button type="button" class="btn-outline" id="ciChangePhoto" style="margin-top:8px">Сменить фото</button>
      <input type="file" id="ciPhotoInput" accept="image/*" class="hidden">` : ""}
      <div style="font-size:18px;font-weight:700;margin-top:8px">${escapeHtml(currentChat.name || "")}</div>
      <div style="color:var(--text-2);font-size:13px">${currentChat.type === "channel" ? "Канал" : "Группа"} · ${members.length} участн. · ${currentChat.public ? "Открытый" : "Закрытый"}</div>
    </div>`;

  if (isAdm) {
    html += `
    <div class="settings-section"><h3>Настройки</h3>
      <div class="profile-field"><label>Название</label><input type="text" id="ciName" value="${escapeHtml(currentChat.name || "")}"></div>
      <div class="profile-field"><label>Описание</label><input type="text" id="ciDesc" value="${escapeHtml(currentChat.description || "")}"></div>
      <div class="settings-row"><span>Статус: Открытый (в поиске)</span><button type="button" class="toggle ${currentChat.public ? "on" : ""}" id="ciPublic"></button></div>
      <div class="settings-row"><span>Закрытый (только по ссылке)</span><button type="button" class="toggle ${!currentChat.public ? "on" : ""}" id="ciPrivate"></button></div>
      <div class="settings-row"><span>Реакции</span><button type="button" class="toggle ${currentChat.reactions !== false ? "on" : ""}" id="ciReact"></button></div>
      <button class="btn-primary" id="ciSave" style="width:100%;margin-top:8px">Сохранить</button>
      <button class="btn-outline" id="ciInvite" style="width:100%;margin-top:8px">Ссылка-приглашение</button>
    </div>`;
  } else {
    html += `<div class="settings-section"><button class="btn-outline" id="ciInvite" style="width:100%">Ссылка-приглашение</button></div>`;
  }

  html += `<div class="settings-section"><h3>Участники (${members.length})</h3><div id="ciMembers"></div></div>`;
  if (isAdm) {
    html += `<button class="btn-danger" id="ciDelete" style="margin-top:12px">Удалить ${currentChat.type === "channel" ? "канал" : "группу"}</button>`;
  } else {
    html += `<button class="btn-danger" id="ciLeave" style="margin-top:12px">Покинуть</button>`;
  }
  body.innerHTML = html;

  // Photo change
  if (isAdm) {
    document.getElementById("ciChangePhoto")?.addEventListener("click", () => document.getElementById("ciPhotoInput").click());
    document.getElementById("ciPhotoInput")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      setLoading(true);
      try {
        const dataUrl = await fileToDataUrl(file, 512, 0.8);
        await updateDoc(doc(db, "chats", currentChatId), { photoUrl: dataUrl });
        currentChat.photoUrl = dataUrl;
        const av = document.getElementById("ciAvatar");
        if (av) {
          av.style.backgroundImage = `url(${dataUrl})`;
          av.style.backgroundSize = "cover";
          av.style.backgroundPosition = "center";
          av.textContent = "";
        }
        showToast("Фото обновлено");
      } catch (err) { showToast(translateAuthError(err)); }
      finally { setLoading(false); }
    });
  }

  const list = document.getElementById("ciMembers");
  for (const uid of members.slice(0, 50)) {
    try {
      const s = await getDoc(doc(db, "users", uid));
      const u = s.exists() ? s.data() : { name: uid.slice(0, 6), username: "?" };
      const role = (currentChat.admins || []).includes(uid) ? "админ" : "";
      const canRemove = isAdm && uid !== currentUser.uid;
      const row = el(`<div class="member-item" data-uid="${uid}">
        <div class="sr-avatar" style="background:${hashColor(u.name)}">${initials(u.name)}</div>
        <div style="flex:1"><div class="sr-name">${escapeHtml(u.name || "")}</div><div class="sr-username">@${escapeHtml(u.username || "")}</div></div>
        ${role ? `<span class="role-tag">${role}</span>` : ""}
        ${canRemove ? `<button type="button" class="btn-danger-sm ci-remove-member" title="Удалить">✕</button>` : ""}
      </div>`);
      list.appendChild(row);
    } catch (_) {}
  }

  // Remove member handlers
  list?.querySelectorAll(".ci-remove-member").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = btn.closest(".member-item");
      const uid = item?.dataset.uid;
      if (!uid || !confirm("Удалить участника из " + (currentChat.type === "channel" ? "канала" : "группы") + "?")) return;
      try {
        await updateDoc(doc(db, "chats", currentChatId), { members: arrayRemove(uid) });
        currentChat.members = (currentChat.members || []).filter(m => m !== uid);
        item.remove();
        showToast("Участник удалён");
      } catch (err) { showToast(translateAuthError(err)); }
    });
  });

  document.getElementById("ciPublic")?.addEventListener("click", function() {
    this.classList.toggle("on");
    const priv = document.getElementById("ciPrivate");
    if (priv) {
      if (this.classList.contains("on")) priv.classList.remove("on");
      else priv.classList.add("on");
    }
  });
  document.getElementById("ciPrivate")?.addEventListener("click", function() {
    this.classList.toggle("on");
    const pub = document.getElementById("ciPublic");
    if (pub) {
      if (this.classList.contains("on")) pub.classList.remove("on");
      else pub.classList.add("on");
    }
  });
  document.getElementById("ciReact")?.addEventListener("click", function() { this.classList.toggle("on"); });
  document.getElementById("ciSave")?.addEventListener("click", async () => {
    try {
      const isPublic = document.getElementById("ciPublic")?.classList.contains("on") || false;
      await updateDoc(doc(db, "chats", currentChatId), {
        name: document.getElementById("ciName").value.trim() || currentChat.name,
        description: document.getElementById("ciDesc").value.trim(),
        public: isPublic,
        reactions: document.getElementById("ciReact")?.classList.contains("on") !== false
      });
      showToast("Сохранено");
      currentChat.name = document.getElementById("ciName").value.trim();
      currentChat.public = isPublic;
    } catch (e) { showToast(translateAuthError(e)); }
  });
  document.getElementById("ciInvite")?.addEventListener("click", () => {
    document.getElementById("chatInfoScreen").classList.add("hidden");
    document.getElementById("inviteBtn")?.click();
  });
  document.getElementById("ciLeave")?.addEventListener("click", async () => {
    if (!confirm("Покинуть?")) return;
    try {
      await updateDoc(doc(db, "chats", currentChatId), { members: arrayRemove(currentUser.uid) });
      document.getElementById("chatInfoScreen").classList.add("hidden");
      document.getElementById("backBtn").click();
      showToast("Ты вышел");
    } catch (e) { showToast(translateAuthError(e)); }
  });
  document.getElementById("ciDelete")?.addEventListener("click", async () => {
    if (!confirm("Удалить безвозвратно?")) return;
    try {
      await updateDoc(doc(db, "chats", currentChatId), { deleted: true, members: [] });
      document.getElementById("chatInfoScreen").classList.add("hidden");
      document.getElementById("backBtn").click();
      showToast("Удалено");
    } catch (e) { showToast(translateAuthError(e)); }
  });
}

async function openContacts() {
  showScreen("contactsScreen");
  const body = document.getElementById("contactsBody");
  body.innerHTML = '<div class="search-empty">Загрузка…</div>';
  const ids = currentProfile.contacts || [];
  if (!ids.length) {
    body.innerHTML = '<div class="search-empty">Контактов нет. Открой личку → ℹ → Добавить в контакты</div>';
    return;
  }
  body.innerHTML = "";
  for (const uid of ids) {
    try {
      const s = await getDoc(doc(db, "users", uid));
      if (!s.exists()) continue;
      const u = s.data();
      const row = el(`<div class="contact-item">
        <div class="sr-avatar" style="background:${hashColor(u.name)}">${initials(u.name)}</div>
        <div><div class="sr-name">${escapeHtml(u.name)}</div><div class="sr-username">@${escapeHtml(u.username)}</div></div>
      </div>`);
      row.onclick = () => startPrivateChat(u);
      body.appendChild(row);
    } catch (_) {}
  }
}

/* ===== NFT ===== */
async function openNftScreen() {
  showScreen("nftScreen");
  await renderNfts();
}

async function renderNfts() {
  const my = document.getElementById("myNftGrid");
  const market = document.getElementById("marketNftGrid");
  if (!my || !market) return;
  my.innerHTML = market.innerHTML = '<div class="search-empty">…</div>';
  try {
    const ownedIds = currentProfile.nfts || [];
    const snap = await getDocs(query(collection(db, "nfts"), limit(100)));
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => (a.nftId || 99999) - (b.nftId || 99999));

    my.innerHTML = "";
    market.innerHTML = "";
    let myN = 0, mN = 0;
    for (const n of all) {
      const card = nftCardEl(n, ownedIds.includes(n.id));
      if (ownedIds.includes(n.id)) { my.appendChild(card); myN++; }
      if (n.onSale && (n.remaining || 0) > 0 && n.price > 0) {
        const buy = nftCardEl(n, false, true);
        market.appendChild(buy); mN++;
      }
    }
    if (!myN) my.innerHTML = '<div class="search-empty">Пока пусто</div>';
    if (!mN) market.innerHTML = '<div class="search-empty">Нет предложений</div>';
  } catch (e) {
    my.innerHTML = `<div class="search-empty" style="color:var(--danger)">${escapeHtml(translateAuthError(e))}</div>`;
  }
}

function nftCardEl(n, owned, canBuy) {
  const rare = (n.nftId || 999) <= 10 ? "LEGENDARY" : (n.nftId || 999) <= 50 ? "RARE" : "COMMON";
  const card = el(`<div class="nft-card">
    <div class="nft-art"><span class="nft-rare">#${n.nftId || "?"} · ${rare}</span></div>
    <div class="nft-meta">
      <div class="nft-name">${escapeHtml(n.name || "NFT")}</div>
      <div class="nft-id">${owned ? "В коллекции" : `осталось ${n.remaining ?? n.supply ?? 0}`}</div>
      ${canBuy ? `<div class="nft-price">${n.price} BC · купить</div>` : (n.price ? `<div class="nft-price">${n.price} BC</div>` : "")}
    </div>
  </div>`);
  const art = card.querySelector(".nft-art");
  applyNftArt(art, n);
  if (canBuy) card.onclick = () => buyNft(n);
  return card;
}
function applyNftArt(artEl, n) {
  if (!artEl || !n) return;
  artEl.innerHTML = `<span class="nft-rare">#${n.nftId || "?"} · ${(n.nftId || 999) <= 10 ? "LEGENDARY" : (n.nftId || 999) <= 50 ? "RARE" : "COMMON"}</span>`;
  if (n.imageUrl) {
    const img = document.createElement("img");
    img.src = n.imageUrl;
    img.alt = n.name || "";
    artEl.appendChild(img);
  } else {
    artEl.style.background = n.bg || "linear-gradient(135deg,#7c3aed,#ec4899)";
    const em = document.createElement("span");
    em.textContent = n.emoji || "◆";
    em.style.fontSize = "52px";
    artEl.appendChild(em);
  }
}
function nftMiniEl(n) {
  const d = el(`<div class="tg-gift-mini" title="${escapeHtml(n.name || "")} #${n.nftId || ""}"></div>`);
  if (n.imageUrl) {
    const img = document.createElement("img");
    img.src = n.imageUrl;
    d.appendChild(img);
  } else {
    d.style.background = n.bg || "linear-gradient(135deg,#7c3aed,#ec4899)";
    d.textContent = n.emoji || "◆";
  }
  return d;
}
async function loadUserNfts(uid, nftIds) {
  if (!nftIds || !nftIds.length) return [];
  const out = [];
  for (const id of nftIds.slice(0, 24)) {
    try {
      const s = await getDoc(doc(db, "nfts", id));
      if (s.exists()) out.push({ id: s.id, ...s.data() });
    } catch (_) {}
  }
  out.sort((a, b) => (a.nftId || 9999) - (b.nftId || 9999));
  return out;
}

async function buyNft(n) {
  if (!confirm(`Купить «${n.name}» за ${n.price} BC?`)) return;
  const bal = currentProfile.blackCoins || 0;
  if (bal < n.price) return showToast("Недостаточно BC");
  if ((n.remaining || 0) < 1) return showToast("Распродано");
  setLoading(true);
  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      blackCoins: increment(-n.price),
      nfts: arrayUnion(n.id)
    });
    await updateDoc(doc(db, "nfts", n.id), { remaining: increment(-1) });
    currentProfile.blackCoins = bal - n.price;
    currentProfile.nfts = [...(currentProfile.nfts || []), n.id];
    showToast("NFT куплен!");
    renderNfts();
    updateDrawer();
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

/* Admin NFT + extra */
document.getElementById("nftCreateBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return showToast("Нет доступа");
  const name = document.getElementById("nftName").value.trim();
  if (!name) return showToast("Название");
  setLoading(true);
  try {
    // next id = count + 1
    const all = await getDocs(query(collection(db, "nfts"), limit(500)));
    const nftId = all.size + 1;
    const supply = Math.max(1, parseInt(document.getElementById("nftSupply").value, 10) || 1);
    const price = Math.max(0, parseInt(document.getElementById("nftPrice").value, 10) || 0);
    let imageUrl = document.getElementById("nftImage").value.trim() || "";
    const nfile = document.getElementById("nftImageFile")?.files?.[0];
    if (nfile) imageUrl = await fileToDataUrl(nfile, 640, 0.75);
    const ref = await addDoc(collection(db, "nfts"), {
      nftId, name,
      description: document.getElementById("nftDesc").value.trim(),
      bg: document.getElementById("nftBg").value.trim() || "linear-gradient(135deg,#7c3aed,#ec4899)",
      emoji: document.getElementById("nftEmoji").value.trim() || "◆",
      imageUrl,
      supply, remaining: supply, price,
      onSale: price > 0,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });
    // give one to admin
    await updateDoc(doc(db, "users", currentUser.uid), { nfts: arrayUnion(ref.id) });
    currentProfile.nfts = [...(currentProfile.nfts || []), ref.id];
    if (price > 0) await updateDoc(ref, { remaining: supply - 1 });
    showToast(`NFT #${nftId} создан`);
    document.getElementById("nftName").value = "";
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});

document.getElementById("nftGiveBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  setLoading(true);
  try {
    const u = await findUserByUsername(document.getElementById("nftGiveUser").value);
    const nftIdNum = parseInt(document.getElementById("nftGiveId").value, 10);
    if (!u || !nftIdNum) return showToast("Юзер и ID NFT");
    const snap = await getDocs(query(collection(db, "nfts"), where("nftId", "==", nftIdNum), limit(1)));
    if (snap.empty) return showToast("NFT не найден");
    const nftDoc = snap.docs[0];
    await updateDoc(doc(db, "users", u.id), { nfts: arrayUnion(nftDoc.id) });
    showToast(`NFT #${nftIdNum} → @${u.username}`);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});

document.getElementById("adminTakeBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  setLoading(true);
  try {
    const u = await findUserByUsername(document.getElementById("adminTakeUser").value);
    const amt = parseInt(document.getElementById("adminTakeAmount").value, 10);
    if (!u || !amt) return showToast("Данные");
    await updateDoc(doc(db, "users", u.id), { blackCoins: increment(-amt) });
    showToast(`Списано ${amt} BC`);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});

document.getElementById("adminPremBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  setLoading(true);
  try {
    const u = await findUserByUsername(document.getElementById("adminPremUser").value);
    const months = parseInt(document.getElementById("adminPremMonths").value, 10) || 1;
    if (!u) return showToast("Не найден");
    const until = new Date(Date.now() + months * 30 * 24 * 3600 * 1000);
    await updateDoc(doc(db, "users", u.id), { premiumUntil: until });
    showToast(`Premium @${u.username} на ${months} мес`);
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});

document.getElementById("adminBroadcastBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const text = document.getElementById("adminBroadcast").value.trim();
  if (!text) return;
  try {
    await addDoc(collection(db, "announcements"), { text, at: serverTimestamp(), by: currentUser.uid });
    showToast("Announcement сохранён");
  } catch (e) { showToast(translateAuthError(e)); }
});


/* Plus menu */
document.getElementById("plusBtn")?.addEventListener("click", () => {
  document.getElementById("plusMenu")?.classList.toggle("hidden");
});
document.getElementById("plusPhoto")?.addEventListener("click", () => {
  document.getElementById("plusMenu")?.classList.add("hidden");
  document.getElementById("fileInput").accept = "image/*";
  document.getElementById("fileInput").click();
});
document.getElementById("plusVideo")?.addEventListener("click", () => {
  document.getElementById("plusMenu")?.classList.add("hidden");
  document.getElementById("fileInput").accept = "video/mp4,video/webm,video/*";
  document.getElementById("fileInput").click();
});
document.getElementById("plusWallet")?.addEventListener("click", () => {
  document.getElementById("plusMenu")?.classList.add("hidden");
  window.open("https://floralss.github.io/BlackVault/", "_blank");
});
document.getElementById("attachBtn")?.addEventListener("click", () => {
  document.getElementById("fileInput").accept = "image/*,video/*";
});

/* Delete NFT */
document.getElementById("nftDeleteBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const idNum = parseInt(document.getElementById("nftDeleteId").value, 10);
  if (!idNum) return showToast("ID NFT");
  setLoading(true);
  try {
    const snap = await getDocs(query(collection(db, "nfts"), where("nftId", "==", idNum), limit(1)));
    if (snap.empty) return showToast("Не найден");
    await deleteDoc(doc(db, "nfts", snap.docs[0].id));
    showToast("NFT удалён из каталога");
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});

/* Create gift template */
document.getElementById("giftCreateBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const name = document.getElementById("giftName").value.trim();
  if (!name) return showToast("Название");
  setLoading(true);
  try {
    let imageUrl = document.getElementById("giftImageUrl")?.value.trim() || "";
    const file = document.getElementById("giftImageFile")?.files?.[0];
    if (file) imageUrl = await fileToDataUrl(file, 512, 0.75);
    await addDoc(collection(db, "giftCatalog"), {
      name,
      emoji: document.getElementById("giftEmoji").value.trim() || "🎁",
      bg: document.getElementById("giftBg").value.trim() || "linear-gradient(135deg,#f59e0b,#ef4444)",
      imageUrl,
      price: parseInt(document.getElementById("giftPrice").value, 10) || 25,
      createdAt: serverTimestamp()
    });
    showToast("Подарок в каталоге");
    document.getElementById("giftName").value = "";
    if (document.getElementById("giftImageFile")) document.getElementById("giftImageFile").value = "";
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
});


async function sendGiftToUser(toUser) {
  // Gift picker modal
  const existing = document.getElementById("giftPickerModal");
  if (existing) existing.remove();

  const modal = el(`<div class="modal-overlay" id="giftPickerModal">
    <div class="modal-box" style="max-width:360px">
      <div class="modal-header">
        <h3>Подарить ${escapeHtml(toUser.name || "")}</h3>
        <button type="button" class="modal-close" id="giftPickerClose">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn-outline gift-pick-btn" data-kind="collectible">🎁 Коллекционный подарок / NFT</button>
        <button class="btn-outline gift-pick-btn" data-kind="coins">🪙 BlackCoin (как звёзды)</button>
        <button class="btn-outline gift-pick-btn" data-kind="premium">✦ Premium</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(modal);
  document.getElementById("giftPickerClose").onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.querySelectorAll(".gift-pick-btn").forEach(btn => {
    btn.onclick = async () => {
      modal.remove();
      const kind = btn.dataset.kind;
      if (kind === "collectible") await doSendCollectibleGift(toUser);
      else if (kind === "coins") await doSendCoinsGift(toUser);
      else if (kind === "premium") await doSendPremiumGift(toUser);
    };
  });
}

async function ensurePrivateChat(otherUid, otherName) {
  const uid1 = currentUser.uid, uid2 = otherUid;
  const chatId = [uid1, uid2].sort().join("_");
  const chatRef = doc(db, "chats", chatId);
  if (!(await getDoc(chatRef)).exists()) {
    await setDoc(chatRef, {
      type: "private", members: [uid1, uid2],
      memberNames: { [uid1]: currentProfile.name, [uid2]: otherName || "?" },
      lastMessage: "", lastMessageTime: serverTimestamp()
    });
  }
  return chatId;
}

async function doSendCollectibleGift(toUser) {
  setLoading(true);
  try {
    const cat = await getDocs(query(collection(db, "giftCatalog"), limit(40)));
    if (cat.empty) { showToast("Каталог подарков пуст — создай в админке"); return; }
    const list = cat.docs.map(d => ({ id: d.id, ...d.data() }));
    // Simple pick: show prompt with names or take first for now; better: small list
    let pick = list[0];
    if (list.length > 1) {
      const names = list.map((p, i) => `${i + 1}. ${p.name} (${p.price || 25} BC)`).join("\n");
      const choice = prompt("Выбери подарок (номер):\n" + names, "1");
      const idx = Math.max(0, (parseInt(choice, 10) || 1) - 1);
      pick = list[idx] || list[0];
    }
    const price = pick.price || 25;
    if ((currentProfile.blackCoins || 0) < price) { showToast("Недостаточно BC"); return; }
    const msg = prompt("Послание к подарку (необязательно):", "") || "";

    await updateDoc(doc(db, "users", currentUser.uid), { blackCoins: increment(-price) });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) - price;

    const gift = {
      kind: "collectible",
      catalogId: pick.id, name: pick.name, emoji: pick.emoji || "🎁", bg: pick.bg || "linear-gradient(135deg,#1a1a2e,#0a0a12)",
      imageUrl: pick.imageUrl || "",
      model: pick.model || "Standard",
      backdrop: pick.backdrop || "Black",
      symbol: pick.symbol || "Gift",
      nftId: pick.nftId || Math.floor(Math.random() * 90000 + 10000),
      fromUid: currentUser.uid, fromName: currentProfile.name,
      message: msg, at: Date.now()
    };
    await updateDoc(doc(db, "users", toUser.uid), { gifts: arrayUnion(gift) });

    // Send centered gift message into private chat
    const chatId = await ensurePrivateChat(toUser.uid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift",
      gift,
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text: "",
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `🎁 ${currentProfile.name} подарил(а) ${pick.name}`,
      lastMessageTime: serverTimestamp()
    });

    showToast("Коллекционный подарок отправлен!");
    updateDrawer();
    if (currentChatId === chatId) { /* already open, snapshot will refresh */ }
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

async function doSendCoinsGift(toUser) {
  const amountStr = prompt("Сколько BlackCoin подарить?", "100");
  const amount = Math.max(1, parseInt(amountStr, 10) || 0);
  if (!amount) return;
  if ((currentProfile.blackCoins || 0) < amount) { showToast("Недостаточно BC"); return; }
  setLoading(true);
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { blackCoins: increment(-amount) });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) - amount;
    await updateDoc(doc(db, "users", toUser.uid), { blackCoins: increment(amount) });

    const gift = {
      kind: "coins",
      amount,
      fromUid: currentUser.uid, fromName: currentProfile.name,
      at: Date.now()
    };
    await updateDoc(doc(db, "users", toUser.uid), { gifts: arrayUnion(gift) });

    const chatId = await ensurePrivateChat(toUser.uid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift",
      gift,
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text: "",
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `🪙 ${currentProfile.name} подарил(а) ${amount} BC`,
      lastMessageTime: serverTimestamp()
    });

    showToast(`${amount} BC отправлено!`);
    updateDrawer();
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

async function doSendPremiumGift(toUser) {
  const monthsStr = prompt("На сколько месяцев Premium? (1 / 3 / 6 / 12)", "1");
  const months = [1, 3, 6, 12].includes(parseInt(monthsStr, 10)) ? parseInt(monthsStr, 10) : 1;
  const costMap = { 1: 200, 3: 500, 6: 900, 12: 1500 };
  const cost = costMap[months] || 200;
  if ((currentProfile.blackCoins || 0) < cost) { showToast("Недостаточно BC"); return; }
  setLoading(true);
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { blackCoins: increment(-cost) });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) - cost;

    // Extend recipient premium
    const snap = await getDoc(doc(db, "users", toUser.uid));
    const rec = snap.exists() ? snap.data() : {};
    const base = rec.premiumUntil
      ? (rec.premiumUntil.toDate ? rec.premiumUntil.toDate() : new Date(rec.premiumUntil))
      : new Date();
    if (base < new Date()) base.setTime(Date.now());
    const until = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    await updateDoc(doc(db, "users", toUser.uid), { premiumUntil: until });

    const gift = {
      kind: "premium",
      months,
      fromUid: currentUser.uid, fromName: currentProfile.name,
      at: Date.now()
    };
    await updateDoc(doc(db, "users", toUser.uid), { gifts: arrayUnion(gift) });

    const chatId = await ensurePrivateChat(toUser.uid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift",
      gift,
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text: "",
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `✦ ${currentProfile.name} подарил(а) Premium на ${months} мес`,
      lastMessageTime: serverTimestamp()
    });

    showToast(`Premium на ${months} мес отправлен!`);
    updateDrawer();
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}
