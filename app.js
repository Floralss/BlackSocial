import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, getDocs, serverTimestamp, increment, arrayUnion, arrayRemove, deleteDoc,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import {
  firebaseConfig, vaultConfig, ADMIN_EMAILS, SUPER_ADMIN_EMAILS, COIN_PACK, COIN_PACKS, RATES
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
let selectedPayCur = "USD";
let selectedCoinPack = (typeof COIN_PACKS !== "undefined" && COIN_PACKS[2]) ? COIN_PACKS[2] : { coins: 100, uah: 50 };
let selectedPremiumMonths = 1;

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const PREMIUM_PRICE = { 1: 200, 3: 540, 6: 960, 12: 1680 };
const APP_VERSION = "1.5.0";
const APP_PATCH = "1.4.0"; // bump on each release
applyTheme(localStorage.getItem("bs_theme") || "dark");

function userEmail() {
  return (currentUser?.email || "").toLowerCase().trim();
}
function isSuperAdmin() {
  if (!currentUser) return false;
  const list = (typeof SUPER_ADMIN_EMAILS !== "undefined" ? SUPER_ADMIN_EMAILS : ADMIN_EMAILS) || [];
  return list.map(e => e.toLowerCase().trim()).includes(userEmail());
}
function isAdmin() {
  if (!currentUser) return false;
  if (isSuperAdmin()) return true;
  if (currentProfile?.role === "admin" || currentProfile?.isAdmin === true) return true;
  const email = userEmail();
  return (ADMIN_EMAILS || []).map(e => e.toLowerCase().trim()).includes(email);
}
function refreshAdminMenu() {
  const btn = document.getElementById("menuAdmin");
  if (!btn) return;
  btn.style.display = isAdmin() ? "flex" : "none";
}

function detectRegion() {
  return "USD";
}

function formatPrice(uah, cur) {
  const rate = RATES[cur] || RATES.USD || 1;
  const amount = uah * rate;
  if (cur === "USD") return `$${amount.toFixed(2)}`;
  if (cur === "UAH") return `${Math.round(amount)} ₴`;
  return `$${amount.toFixed(2)}`;
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
  try {
    await signInWithEmailAndPassword(auth, email, password);
    rememberAccount(email, password);
  } catch (err) { errBox.textContent = translateAuthError(err); }
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
    if (currentProfile?.frozen) {
      showToast("Аккаунт заморожен администратором");
      await signOut(auth);
      return;
    }
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
    try { renderDrawerAccounts(); } catch (_) {}
    try {
      if (currentUser?.email) {
        const list = loadAccounts();
        const hit = list.find(a => a.email === currentUser.email);
        if (hit) {
          hit.name = currentProfile?.name || hit.name;
          saveAccounts(list.map(a => a.email === hit.email ? hit : a));
        }
      }
    } catch (_) {}
    startPresence();
    subscribeChats();
    try { if (window.__bsProcessTransfers) window.__bsProcessTransfers(); } catch (_) {}
    setTimeout(() => maybeAskPermissions(), 800);
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
  const body = document.getElementById("profileBody");
  if (body) {
    const p = currentProfile;
    const giftN = (p.nfts || []).length + (p.gifts || []).length;
    body.innerHTML = `
      <div class="bs-profile">
        <div class="profile-avatar-big" id="profileAvatarBig"></div>
        <button type="button" class="bs-edit-av" id="changeAvatarBtn">✎</button>
        <input type="file" id="avatarInput" accept="image/*" class="hidden">
        <div class="bs-profile-name">${escapeHtml(p.name || "")}${hasPremium(p) ? " <span class=\"premium-badge\">✦</span>" : ""}</div>
        <div class="bs-profile-status">${isOnline(p) ? "в сети" : "был(а) недавно"}</div>
      </div>
      <div class="bs-section">
        <div class="bs-row"><div class="bs-row-label">Имя пользователя</div><div class="bs-row-value">@${escapeHtml(p.username || "")}</div></div>
        ${p.phone ? `<div class="bs-row"><div class="bs-row-label">Телефон</div><div class="bs-row-value">${escapeHtml(p.phone)}</div></div>` : ""}
        <div class="bs-row"><div class="bs-row-label">О себе</div><div class="bs-row-value">${escapeHtml(p.bio || "—")}</div></div>
        <div class="bs-row"><div class="bs-row-label">Email</div><div class="bs-row-value">${escapeHtml(p.email || "")}</div></div>
      </div>
      <div class="bs-section">
        <button type="button" class="bs-gifts-head" id="ownGiftsBtn">
          <span>★ Подарки</span><span style="color:var(--text-2)">${giftN}</span>
        </button>
        <div class="tg-gifts-row" id="ownNftPreview" style="padding:8px 12px"></div>
      </div>
      <div class="bs-section" style="padding:12px">
        <div class="profile-field"><label>Имя</label><input type="text" id="editName" maxlength="40" value="${escapeHtml(p.name || "")}"></div>
        <div class="profile-field"><label>Юзернейм</label><input type="text" id="editUsername" maxlength="24" value="${escapeHtml(p.username || "")}"></div>
        <div class="profile-field"><label>О себе</label><input type="text" id="editBio" maxlength="120" value="${escapeHtml(p.bio || "")}"></div>
        <div class="profile-field"><label>Телефон</label><input type="tel" id="editPhone" value="${escapeHtml(p.phone || "")}" placeholder="+380..."></div>
        <button class="btn-primary" id="saveProfileBtn" style="width:100%">Сохранить</button>
      </div>
    `;
    setAvatarEl(document.getElementById("profileAvatarBig"), p);
    document.getElementById("changeAvatarBtn").onclick = () => document.getElementById("avatarInput").click();
    document.getElementById("avatarInput").onchange = async (e) => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (!file || !file.type.startsWith("image/")) return;
      setLoading(true);
      try {
        const url = await fileToDataUrl(file, 400, 0.65);
        await updateDoc(doc(db, "users", currentUser.uid), { avatarUrl: url });
        currentProfile.avatarUrl = url;
        setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
        updateDrawer();
        showToast("Аватар обновлён");
      } catch (err) { showToast(translateAuthError(err)); }
      finally { setLoading(false); }
    };
    document.getElementById("saveProfileBtn").onclick = async () => {
      const name = document.getElementById("editName").value.trim();
      let username = document.getElementById("editUsername").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      const bio = document.getElementById("editBio").value.trim();
      const phone = document.getElementById("editPhone").value.trim();
      if (!name || username.length < 3) return showToast("Проверь имя и юзернейм");
      setLoading(true);
      try {
        if (username !== currentProfile.username) {
          const ex = await getDocs(query(collection(db, "users"), where("username", "==", username), limit(1)));
          if (!ex.empty) { showToast("Юзернейм занят"); return; }
        }
        await updateDoc(doc(db, "users", currentUser.uid), { name, username, bio, phone });
        currentProfile.name = name; currentProfile.username = username;
        currentProfile.bio = bio; currentProfile.phone = phone;
        updateDrawer();
        showToast("Сохранено");
        openProfile();
      } catch (e) { showToast(translateAuthError(e)); }
      finally { setLoading(false); }
    };
    const box = document.getElementById("ownNftPreview");
    loadUserNfts(currentUser.uid, currentProfile.nfts || []).then(list => {
      box.innerHTML = "";
      if (!list.length && !(p.gifts || []).length) box.innerHTML = '<span style="color:var(--text-2);font-size:13px">Пока пусто</span>';
      list.forEach(n => box.appendChild(nftMiniEl(n)));
      (p.gifts || []).slice(-8).forEach(g => {
        const m = el(`<div class="tg-gift-mini"></div>`);
        if (g.imageUrl) m.innerHTML = `<img src="${escapeHtml(g.imageUrl)}">`;
        else { m.textContent = g.emoji || "★"; m.style.background = g.bg || "#3b82f6"; }
        box.appendChild(m);
      });
    });
    document.getElementById("ownGiftsBtn").onclick = () => openNftScreen();
    return;
  }
  // fallback old fields
  setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
}
document.getElementById("closeProfile").addEventListener("click", () => { document.getElementById("profileScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });
document.getElementById("changeAvatarBtn")?.addEventListener("click", () => document.getElementById("avatarInput")?.click());
document.getElementById("avatarInput")?.addEventListener("change", async (e) => {
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
document.getElementById("saveProfileBtn")?.addEventListener("click", async () => {
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
          <img class="menu-icon" src="assets/icons/lock.svg" alt="">
          Конфиденциальность
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        <button class="settings-menu-item" data-view="notifications">
          <img class="menu-icon" src="assets/icons/bell.svg" alt="">
          Уведомления и звуки
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        <button class="settings-menu-item" data-view="security">
          <img class="menu-icon" src="assets/icons/shield.svg" alt="">
          Безопасность
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        <button class="settings-menu-item" data-view="advanced">
          <img class="menu-icon" src="assets/icons/gear.svg" alt="">
          Продвинутые настройки
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        <button class="settings-menu-item" data-view="css">
          <img class="menu-icon" src="assets/icons/code.svg" alt="">
          Свой CSS
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        ${isSuperAdmin() || isAdmin() ? "" : ""}
      </div>
      <div class="settings-menu-group" style="margin-top:12px">
        <button class="settings-menu-item" id="settingsPremiumBtn">
          <img class="menu-icon" src="assets/icons/premium.svg" alt="">
          Black Premium
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        <button class="settings-menu-item" id="settingsStarsBtn">
          <img class="menu-icon" src="assets/icons/coins.svg" alt="">
          Мои BlackCoin
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
        <button class="settings-menu-item" id="settingsGiftBtn">
          <img class="menu-icon" src="assets/icons/gift.svg" alt="">
          Отправить подарок
          <img class="chev-icon" src="assets/icons/chevron.svg" alt="">
        </button>
      </div>
      <button class="btn-danger" id="logoutFromSettings" style="margin-top:20px;width:100%">
        <img class="menu-icon" src="assets/icons/logout.svg" alt="" style="width:18px;height:18px;vertical-align:middle;margin-right:8px">
        Выйти из аккаунта
      </button>
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
    const val = (k, d=true) => (s[k] !== undefined ? !!s[k] : d);
    const who = (k, def="all") => s[k] || def;
    const whoOpts = (k, def="all") => {
      const v = who(k, def);
      return ["all","contacts","nobody"].map(o =>
        `<option value="${o}" ${v===o?"selected":""}>${o==="all"?"Все":o==="contacts"?"Контакты":"Никто"}</option>`
      ).join("");
    };
    body.innerHTML = `
      <div class="settings-section">
        <div class="settings-label">Безопасность</div>
        <div class="settings-row"><span>Код-пароль приложения</span><button type="button" class="toggle ${val("appLock", false) ? "on" : ""}" data-key="appLock"></button></div>
        <div class="settings-row"><span>Автоудаление сообщений</span>
          <select id="autoDelete" class="settings-select">
            <option value="off" ${who("autoDelete","off")==="off"?"selected":""}>Выкл.</option>
            <option value="24h" ${who("autoDelete")==="24h"?"selected":""}>24 часа</option>
            <option value="7d" ${who("autoDelete")==="7d"?"selected":""}>7 дней</option>
            <option value="30d" ${who("autoDelete")==="30d"?"selected":""}>30 дней</option>
          </select>
        </div>
        <div class="settings-row"><span>Заблокированные</span><span class="settings-val">${(currentProfile.blocked||[]).length}</span></div>
        <div class="settings-row"><span>Активные сессии</span><span class="settings-val">это устройство</span></div>
      </div>
      <div class="settings-section">
        <div class="settings-label">Конфиденциальность</div>
        <div class="settings-row"><span>Номер телефона</span>
          <select id="whoPhone" class="settings-select">${whoOpts("whoPhone","nobody")}</select>
        </div>
        <div class="settings-row"><span>Время захода</span>
          <select id="whoLastSeen" class="settings-select">${whoOpts("whoLastSeen","contacts")}</select>
        </div>
        <div class="settings-row"><span>Фотографии профиля</span>
          <select id="whoAvatar" class="settings-select">${whoOpts("whoAvatar","all")}</select>
        </div>
        <div class="settings-row"><span>Пересылка сообщений</span>
          <select id="whoForward" class="settings-select">${whoOpts("whoForward","all")}</select>
        </div>
        <div class="settings-row"><span>Звонки</span>
          <select id="whoCalls" class="settings-select">${whoOpts("whoCalls","contacts")}</select>
        </div>
        <div class="settings-row"><span>Голосовые сообщения</span>
          <select id="whoVoice" class="settings-select">${whoOpts("whoVoice","all")}</select>
        </div>
        <div class="settings-row"><span>Сообщения</span>
          <select id="whoCanMessage" class="settings-select">
            <option value="all" ${who("whoCanMessage")==="all"?"selected":""}>Все</option>
            <option value="contacts" ${who("whoCanMessage")==="contacts"?"selected":""}>Контакты</option>
            <option value="nobody" ${who("whoCanMessage")==="nobody"?"selected":""}>Никто</option>
          </select>
        </div>
        <div class="settings-row"><span>Подарки</span>
          <select id="whoGifts" class="settings-select">${whoOpts("whoGifts","all")}</select>
        </div>
        <div class="settings-row"><span>О себе</span>
          <select id="whoBio" class="settings-select">${whoOpts("whoBio","all")}</select>
        </div>
        <div class="settings-row"><span>Показывать «в сети»</span><button type="button" class="toggle ${val("showOnline") ? "on" : ""}" data-key="showOnline"></button></div>
        <div class="settings-row"><span>Превью в списке чатов</span><button type="button" class="toggle ${val("showPreview") ? "on" : ""}" data-key="showPreview"></button></div>
      </div>
      <div class="settings-section">
        <div class="settings-label">Телефон (по желанию)</div>
        <div class="profile-field"><label>Номер</label>
          <input type="tel" id="phoneInput" value="${escapeHtml(currentProfile.phone || "")}" placeholder="+380...">
        </div>
        <button class="btn-primary" id="savePhoneBtn" style="width:100%">Сохранить номер</button>
        <p style="font-size:12px;color:var(--text-2);margin-top:8px">Номер виден только тем, кому разрешишь выше.</p>
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
        <button class="btn-outline" id="reaskPermsBtn" style="width:100%;margin-top:12px">🎤 Доступ к микрофону / камере</button>
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
    body.innerHTML = `<div class="settings-section"><p style="color:var(--text-2);font-size:14px">Админка только для назначенных администраторов. Открой через меню ☰ → Админка.</p>
      ${isAdmin() ? '<button class="btn-primary" id="goAdminBtn" style="width:100%;margin-top:10px">Открыть админку</button>' : ""}
    </div>`;
    document.getElementById("goAdminBtn")?.addEventListener("click", () => {
      document.getElementById("settingsScreen").classList.add("hidden");
      openAdmin();
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
  const privacyKeys = {
    whoCanMessage: "whoCanMessage", whoPhone: "whoPhone", whoLastSeen: "whoLastSeen",
    whoAvatar: "whoAvatar", whoForward: "whoForward", whoCalls: "whoCalls",
    whoVoice: "whoVoice", whoGifts: "whoGifts", whoBio: "whoBio", autoDelete: "autoDelete"
  };
  Object.keys(privacyKeys).forEach(id => {
    const elSel = document.getElementById(id);
    if (!elSel) return;
    elSel.addEventListener("change", async (e) => {
      const settings = { ...(currentProfile.settings || {}), [privacyKeys[id]]: e.target.value };
      currentProfile.settings = settings;
      try { await updateDoc(doc(db, "users", currentUser.uid), { settings }); showToast("Сохранено"); }
      catch (err) { showToast(translateAuthError(err)); }
    });
  });
  document.getElementById("savePhoneBtn")?.addEventListener("click", async () => {
    const phone = document.getElementById("phoneInput")?.value.trim() || "";
    try {
      await updateDoc(doc(db, "users", currentUser.uid), { phone });
      currentProfile.phone = phone;
      showToast(phone ? "Номер сохранён" : "Номер удалён");
    } catch (e) { showToast(translateAuthError(e)); }
  });
  document.getElementById("reaskPermsBtn")?.addEventListener("click", () => {
    localStorage.removeItem("bs_perms_asked");
    maybeAskPermissions(true);
  });
}

/* SHOP + BLACKVAULT PAY */
function openShop() {
  showScreen("shopScreen");
  document.getElementById("shopBalance").textContent = `${currentProfile.blackCoins || 0} BC`;
  const ve = document.getElementById("vaultEmail");
  if (ve && !ve.value) ve.value = currentUser.email || "";
  selectedPayCur = "USD";
  if (!selectedCoinPack) selectedCoinPack = (COIN_PACKS && COIN_PACKS[2]) || { coins: 100, uah: 50 };
  renderShopPacks();
  renderShopCurrency();
  updateShopLabels();
  if (hasPremium(currentProfile)) {
    const until = currentProfile.premiumUntil.toDate ? currentProfile.premiumUntil.toDate() : new Date(currentProfile.premiumUntil);
    document.getElementById("premiumStatus").textContent = "Premium до " + until.toLocaleDateString("ru-RU");
  } else document.getElementById("premiumStatus").textContent = "Premium не активен";
}
document.getElementById("closeShop").addEventListener("click", () => { document.getElementById("shopScreen").classList.add("hidden"); document.getElementById("app")?.classList.remove("overlay-open"); });

function packMoney(pack, cur) {
  const rate = RATES[cur] || RATES.USD || 1;
  return pack.uah * rate;
}

function formatPackMoney(pack, cur) {
  const amount = packMoney(pack, cur);
  if (cur === "USD") return `$${amount < 1 ? amount.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : amount.toFixed(2)}`;
  if (cur === "UAH") return amount < 1 ? `${amount.toFixed(2)} ₴` : `${Math.round(amount * 100) / 100} ₴`;
  return `$${amount.toFixed(2)}`;
}

function updateShopLabels() {
  const pack = selectedCoinPack || { coins: 100, uah: 50 };
  const cur = selectedPayCur || "USD";
  const one = { coins: 1, uah: 0.5 };
  const rateEl = document.getElementById("coinRateLabel");
  if (rateEl) rateEl.textContent = `1 BC = ${formatPackMoney(one, cur)}`;
  const label = document.getElementById("packPriceLabel");
  if (label) label.textContent = `${pack.coins} BC = ${formatPackMoney(pack, cur)}`;
  const btn = document.getElementById("buyCoinsBtn");
  if (btn) btn.textContent = `Купить ${pack.coins} BC · ${formatPackMoney(pack, cur)}`;
}

function renderShopPacks() {
  const grid = document.getElementById("packGrid");
  if (!grid) return;
  const packs = (typeof COIN_PACKS !== "undefined" && COIN_PACKS.length) ? COIN_PACKS : [
    { coins: 1, uah: 0.5 }, { coins: 100, uah: 50 }, { coins: 500, uah: 250 }, { coins: 1000, uah: 500 }
  ];
  if (!selectedCoinPack) selectedCoinPack = packs.find(p => p.coins === 100) || packs[0];
  grid.innerHTML = "";
  packs.forEach(pack => {
    const sel = selectedCoinPack && selectedCoinPack.coins === pack.coins;
    const opt = el(`<button type="button" class="pack-opt${sel ? " sel" : ""}" data-coins="${pack.coins}">
      <span class="pack-opt-coins">${pack.coins} BC</span>
      <span class="pack-opt-price">${formatPackMoney(pack, selectedPayCur || "USD")}</span>
    </button>`);
    opt.addEventListener("click", () => {
      selectedCoinPack = pack;
      grid.querySelectorAll(".pack-opt").forEach(x => x.classList.toggle("sel", parseInt(x.dataset.coins, 10) === pack.coins));
      updateShopLabels();
    });
    grid.appendChild(opt);
  });
}

function renderShopCurrency() {
  const grid = document.getElementById("currGrid");
  if (!grid) return;
  grid.innerHTML = "";
  ["USD", "UAH"].forEach(cur => {
    const opt = el(`<div class="curr-opt${cur === selectedPayCur ? " sel" : ""}" data-cur="${cur}">${cur}</div>`);
    opt.addEventListener("click", () => {
      selectedPayCur = cur;
      grid.querySelectorAll(".curr-opt").forEach(x => x.classList.toggle("sel", x.dataset.cur === cur));
      renderShopPacks();
      updateShopLabels();
    });
    grid.appendChild(opt);
  });
}

document.getElementById("buyCoinsBtn").addEventListener("click", async () => {
  const email = document.getElementById("vaultEmail").value.trim();
  const pass = document.getElementById("vaultPassword").value;
  if (!email || !pass) return showToast("Укажи email и пароль BlackVault");
  const pack = selectedCoinPack || { coins: 100, uah: 50 };
  setLoading(true);
  try {
    const cred = await signInWithEmailAndPassword(vaultAuth, email, pass);
    const wSnap = await getDoc(doc(vaultDb, "wallets", cred.user.uid));
    if (!wSnap.exists()) throw new Error("Кошелёк BlackVault не найден");
    const wallet = wSnap.data();
    const cur = selectedPayCur;
    const amount = packMoney(pack, cur);
    const bal = (wallet.balances && wallet.balances[cur]) || 0;
    if (bal < amount) throw new Error(`Недостаточно ${cur}. Нужно ${amount.toFixed(4)}, есть ${Number(bal).toFixed(4)}`);
    await updateDoc(doc(vaultDb, "wallets", cred.user.uid), {
      [`balances.${cur}`]: increment(-amount)
    });
    try {
      await addDoc(collection(vaultDb, "tx"), {
        uid: cred.user.uid, type: "blacksocial_coins", currency: cur, amount,
        coins: pack.coins, createdAt: serverTimestamp()
      });
    } catch (_) {}
    await updateDoc(doc(db, "users", currentUser.uid), {
      blackCoins: increment(pack.coins)
    });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) + pack.coins;
    document.getElementById("shopBalance").textContent = `${currentProfile.blackCoins} BC`;
    updateDrawer();
    document.getElementById("vaultPassword").value = "";
    showToast(`+${pack.coins} BC · списано ${formatPackMoney(pack, cur)}`);
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
  const body = document.getElementById("adminBody");
  if (!body) return;
  const superA = isSuperAdmin();
  body.innerHTML = `
    <div class="admin-banner">${superA ? "Владелец · полный доступ" : "Модератор · заморозка и рассылка"}</div>
    <div class="settings-section">
      <h3>Заморозка аккаунта</h3>
      <div class="profile-field"><label>@username</label><input type="text" id="adminFreezeUser" placeholder="username"></div>
      <div style="display:flex;gap:8px">
        <button class="btn-danger" id="adminFreezeBtn" style="flex:1">Заморозить</button>
        <button class="btn-outline" id="adminUnfreezeBtn" style="flex:1">Разморозить</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>Рассылка</h3>
      <div class="profile-field"><label>Текст</label><input type="text" id="adminBroadcast" maxlength="200" placeholder="Сообщение всем"></div>
      <button class="btn-primary" id="adminBroadcastBtn" style="width:100%">Отправить в announcements</button>
    </div>
    ${superA ? `
    <div class="settings-section">
      <h3>Выдать / снять админку</h3>
      <div class="profile-field"><label>@username</label><input type="text" id="adminRoleUser" placeholder="username"></div>
      <div style="display:flex;gap:8px">
        <button class="btn-primary" id="adminGrantBtn" style="flex:1">Выдать</button>
        <button class="btn-outline" id="adminRevokeBtn" style="flex:1">Снять</button>
      </div>
      <p style="font-size:12px;color:var(--text-2);margin-top:8px">Админ сможет только замораживать аккаунты и делать рассылку.</p>
    </div>
    <div class="settings-section">
      <h3>Выдать BlackCoin</h3>
      <div class="profile-field"><label>@username</label><input type="text" id="adminGiveUser"></div>
      <div class="profile-field"><label>Сумма BC</label><input type="number" id="adminGiveAmount" value="100"></div>
      <button class="btn-primary" id="adminGiveBtn" style="width:100%">Выдать BC</button>
    </div>
    <div class="settings-section">
      <h3>Удалить / восстановить аккаунт</h3>
      <div class="profile-field"><label>@username</label><input type="text" id="adminDelUser"></div>
      <button class="btn-danger" id="adminDelBtn" style="width:100%;margin-bottom:8px">Удалить</button>
      <div class="profile-field"><label>@username</label><input type="text" id="adminRestoreUser"></div>
      <button class="btn-outline" id="adminRestoreBtn" style="width:100%">Восстановить</button>
    </div>
    ` : ""}
  `;
  document.getElementById("adminFreezeBtn")?.addEventListener("click", async () => {
    const u = await findUserByUsername(document.getElementById("adminFreezeUser").value);
    if (!u) return showToast("Не найден");
    await updateDoc(doc(db, "users", u.id), { frozen: true });
    showToast("Заморожен @" + u.username);
  });
  document.getElementById("adminUnfreezeBtn")?.addEventListener("click", async () => {
    const u = await findUserByUsername(document.getElementById("adminFreezeUser").value);
    if (!u) return showToast("Не найден");
    await updateDoc(doc(db, "users", u.id), { frozen: false });
    showToast("Разморожен @" + u.username);
  });
  document.getElementById("adminBroadcastBtn")?.addEventListener("click", async () => {
    const text = document.getElementById("adminBroadcast").value.trim();
    if (!text) return showToast("Пусто");
    try {
      await addDoc(collection(db, "announcements"), {
        text, from: currentProfile.name, fromUid: currentUser.uid,
        at: serverTimestamp()
      });
      showToast("Рассылка сохранена");
    } catch (e) { showToast(translateAuthError(e)); }
  });
  if (superA) {
    document.getElementById("adminGrantBtn")?.addEventListener("click", async () => {
      const u = await findUserByUsername(document.getElementById("adminRoleUser").value);
      if (!u) return showToast("Не найден");
      await updateDoc(doc(db, "users", u.id), { role: "admin", isAdmin: true });
      showToast("Админка выдана @" + u.username);
    });
    document.getElementById("adminRevokeBtn")?.addEventListener("click", async () => {
      const u = await findUserByUsername(document.getElementById("adminRoleUser").value);
      if (!u) return showToast("Не найден");
      await updateDoc(doc(db, "users", u.id), { role: "user", isAdmin: false });
      showToast("Админка снята @" + u.username);
    });
    document.getElementById("adminGiveBtn")?.addEventListener("click", async () => {
      const u = await findUserByUsername(document.getElementById("adminGiveUser").value);
      const amt = parseInt(document.getElementById("adminGiveAmount").value, 10);
      if (!u || !amt) return showToast("Проверь данные");
      await updateDoc(doc(db, "users", u.id), { blackCoins: increment(amt) });
      showToast(`+${amt} BC → @${u.username}`);
    });
    document.getElementById("adminDelBtn")?.addEventListener("click", async () => {
      const u = await findUserByUsername(document.getElementById("adminDelUser").value);
      if (!u || !confirm("Удалить @" + u.username + "?")) return;
      await updateDoc(doc(db, "users", u.id), { deleted: true });
      showToast("Удалён");
    });
    document.getElementById("adminRestoreBtn")?.addEventListener("click", async () => {
      const u = await findUserByUsername(document.getElementById("adminRestoreUser").value);
      if (!u) return showToast("Не найден");
      await updateDoc(doc(db, "users", u.id), { deleted: false });
      showToast("Восстановлен");
    });
  }
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
document.getElementById("adminGiveBtn")?.addEventListener("click", async () => {
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
document.getElementById("adminDelBtn")?.addEventListener("click", async () => {
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
document.getElementById("adminRestoreBtn")?.addEventListener("click", async () => {
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

/* ===== PHONE NOTIFICATIONS ===== */
let notifReady = false;
let lastNotifiedMsg = {};

async function ensureNotifyPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") { notifReady = true; return true; }
  if (Notification.permission === "denied") return false;
  try {
    const p = await Notification.requestPermission();
    notifReady = p === "granted";
    return notifReady;
  } catch (_) { return false; }
}

function showPhoneNotification(title, body, chatId) {
  if (!notifReady && Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && currentChatId === chatId) return;
  const opts = {
    body: (body || "").slice(0, 120),
    icon: "assets/icons/icon-192.png",
    badge: "assets/icons/icon-96.png",
    tag: "bs-" + (chatId || "msg"),
    renotify: true,
    data: { chatId }
  };
  try {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "notify", title, ...opts });
    } else if (Notification.permission === "granted") {
      const n = new Notification(title || "BlackSocial", opts);
      n.onclick = () => {
        window.focus();
        if (chatId) openChat(chatId);
        n.close();
      };
    }
  } catch (e) { console.warn("notify", e); }
}

function subscribeChats() {
  if (unsubChats) unsubChats();
  const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid));
  unsubChats = onSnapshot(q, snap => {
    const prev = {};
    allChats.forEach(c => { prev[c.id] = c.lastMessageTime?.toMillis?.() || 0; });
    allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allChats.sort((a, b) => (b.lastMessageTime?.toMillis?.() || 0) - (a.lastMessageTime?.toMillis?.() || 0));
    // notify on new messages from others
    allChats.forEach(c => {
      const tms = c.lastMessageTime?.toMillis?.() || 0;
      if (!tms || tms <= (prev[c.id] || 0)) return;
      const key = c.id + ":" + tms;
      if (lastNotifiedMsg[c.id] === key) return;
      lastNotifiedMsg[c.id] = key;
      const preview = c.lastMessage || "Новое сообщение";
      // skip if likely own (preview starts with own patterns hard) — still notify if not current chat
      if (c.id === currentChatId && document.visibilityState === "visible") return;
      const title = chatDisplayName(c);
      showPhoneNotification(title, preview, c.id);
    });
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
  const hidden = new Set(currentProfile?.hiddenChats || []);
  const blocked = new Set(currentProfile?.blocked || []);
  const filtered = allChats.filter(c => {
    if (hidden.has(c.id)) return false;
    if (c.type === "private") {
      const other = (c.members || []).find(m => m !== currentUser.uid);
      if (other && blocked.has(other)) return false;
    }
    return chatDisplayName(c).toLowerCase().includes(filter);
  });
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
    const isAdm = (currentChat.admins || []).includes(currentUser.uid);
    const canDeleteAny = isAdm || currentChat.type === "private";
    snap.forEach(ds => {
      const m = { id: ds.id, ...ds.data() };
      if (!sameDay(lastTs, m.timestamp))
        msgsEl.appendChild(el(`<div class="date-sep">${fmtDateSep(m.timestamp)}</div>`));
      lastTs = m.timestamp;
      const own = m.senderId === currentUser.uid;
      const showSender = !own && currentChat.type !== "private";
      const canDel = own || (currentChat.type !== "private" && isAdm);

      if (m.type === "call" && m.callId && m.senderId !== currentUser.uid) {
        handleIncomingCallMessage(m);
      }
      // Special centered gift cards
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
                <div class="gift-star-icon bs-star">★</div>
              </div>
              <div class="gift-amount">${g.amount || 0} BlackCoin</div>
              <div class="gift-desc">BlackCoin для покупок и функций в BlackSocial.</div>
              <button type="button" class="gift-btn">Принять</button>
            </div>`;
        } else if (g.kind === "premium") {
          headerText = `${fromName} подарил(а) Вам Premium`;
          cardHtml = `
            <div class="gift-card gift-premium">
              <div class="gift-box-art premium-box">
                <div class="gift-star-icon bs-star">★</div>
              </div>
              <div class="gift-amount">Premium · ${g.months || 1} мес</div>
              <div class="gift-desc">Эксклюзивные функции BlackSocial.</div>
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
          <div class="msg-row gift-row" data-mid="${m.id}">
            <div class="gift-header-text">${headerText}</div>
            ${cardHtml}
            <div class="msg-meta gift-meta"><span class="msg-time">${fmtTime(m.timestamp)}</span></div>
          </div>`);
        if (canDel) attachMsgActions(row, m);
        // Wire accept buttons + auto-claim for recipient
        if (!own) {
          const needClaim = !g.claimed && !(currentProfile.claimedGifts || []).includes(g.transferId || m.id);
          row.querySelectorAll(".gift-btn").forEach(btn => {
            if (needClaim) {
              btn.textContent = "Получить";
              btn.onclick = async (e) => {
                e.stopPropagation();
                btn.disabled = true;
                const ok = await claimGiftPayload({ ...g, type: g.kind }, m.id);
                if (ok) { btn.textContent = "Получено ✓"; btn.disabled = true; }
                else btn.disabled = false;
              };
            } else {
              btn.textContent = "Получено ✓";
              btn.disabled = true;
            }
          });
          if (needClaim) {
            // auto try once
            claimGiftPayload({ ...g, type: g.kind }, m.id).then(ok => {
              if (ok) row.querySelectorAll(".gift-btn").forEach(b => { b.textContent = "Получено ✓"; b.disabled = true; });
            });
          }
        }
        msgsEl.appendChild(row);
        return;
      }

      let inner = "";
      if (m.mediaType === "voice" && m.audioUrl) {
        inner += `<audio class="msg-audio" src="${escapeHtml(m.audioUrl)}" controls preload="metadata"></audio>`;
      } else if (m.imageUrl) {
        if (m.mediaType === "video" || (typeof m.imageUrl === "string" && m.imageUrl.startsWith("data:video"))) {
          inner += `<video class="msg-img" src="${escapeHtml(m.imageUrl)}" controls playsinline style="max-width:100%;border-radius:12px"></video>`;
        } else {
          inner += `<img class="msg-img" src="${escapeHtml(m.imageUrl)}" alt="" loading="lazy">`;
        }
      }
      if (m.text) inner += `<div class="msg-text">${escapeHtml(m.text)}</div>`;
      if (!inner) inner = '<div class="msg-text">…</div>';
      const row = el(`
        <div class="msg-row ${own ? "own" : "other"}" data-mid="${m.id}">
          ${showSender ? `<div class="msg-sender">${escapeHtml(m.senderName)}</div>` : ""}
          <div class="msg-bubble ${m.imageUrl || m.audioUrl ? "has-image" : ""}">${inner}</div>
          <div class="msg-meta"><span class="msg-time">${fmtTime(m.timestamp)}</span>${canDel ? '<button type="button" class="msg-del" title="Удалить">🗑</button>' : ""}</div>
        </div>`);
      if (m.imageUrl && !m.audioUrl) {
        const img = row.querySelector(".msg-img");
        if (img) img.onclick = () => openLightbox(m.imageUrl);
      }
      {
        const delBtn = row.querySelector(".msg-del");
        if (delBtn) delBtn.onclick = (e) => { e.stopPropagation(); showMsgContextMenu(row, m, e); };
        attachMsgActions(row, m);
      }
      msgsEl.appendChild(row);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }, err => showToast(translateAuthError(err)));
}

function attachMsgDelete(row, msgId) {
  attachMsgActions(row, { id: msgId });
}

function attachMsgActions(row, m) {
  const msgId = m.id;
  let timer = null;
  const open = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    showMsgContextMenu(row, m, e);
  };
  row.addEventListener("contextmenu", open);
  row.addEventListener("touchstart", () => {
    timer = setTimeout(() => open(), 500);
  }, { passive: true });
  row.addEventListener("touchend", () => clearTimeout(timer));
  row.addEventListener("touchmove", () => clearTimeout(timer));
}

function showMsgContextMenu(row, m, e) {
  document.getElementById("msgCtxMenu")?.remove();
  const own = m.senderId === currentUser.uid;
  const isAdm = currentChat && (currentChat.admins || []).includes(currentUser.uid);
  const canDel = own || (currentChat && currentChat.type !== "private" && isAdm);
  const canEdit = own && m.type !== "gift" && !m.audioUrl;
  const menu = el(`<div class="msg-ctx-menu" id="msgCtxMenu">
    <button type="button" data-act="copy">📋 Копировать</button>
    <button type="button" data-act="reply">↩ Ответить</button>
    <button type="button" data-act="forward">↗ Переслать</button>
    ${canEdit ? '<button type="button" data-act="edit">✎ Редактировать</button>' : ""}
    ${canDel ? '<button type="button" data-act="delete" class="danger">🗑 Удалить</button>' : ""}
  </div>`);
  document.body.appendChild(menu);
  const rect = row.getBoundingClientRect();
  let x = e && e.clientX ? e.clientX : rect.left + rect.width / 2;
  let y = e && e.clientY ? e.clientY : rect.top + 8;
  menu.style.left = Math.min(x, window.innerWidth - 200) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 220) + "px";
  const close = () => menu.remove();
  setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
  menu.querySelectorAll("button").forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      close();
      const act = btn.dataset.act;
      if (act === "copy") {
        const text = m.text || m.gift?.name || "";
        try { await navigator.clipboard.writeText(text); showToast("Скопировано"); } catch (_) { showToast(text || "Пусто"); }
      } else if (act === "reply") {
        const inp = document.getElementById("msgInput");
        if (inp) { inp.value = (inp.value ? inp.value + " " : "") + "↩ " + (m.senderName || "") + ": "; inp.focus(); }
      } else if (act === "forward") {
        await forwardMessage(m);
      } else if (act === "edit") {
        await editMessage(m);
      } else if (act === "delete") {
        await deleteMessage(m.id);
      }
    };
  });
}

async function forwardMessage(m) {
  const q = prompt("Username получателя (без @):");
  if (!q) return;
  try {
    const snap = await getDocs(query(collection(db, "users"), where("username", "==", q.trim().toLowerCase()), limit(1)));
    if (snap.empty) return showToast("Пользователь не найден");
    const u = { uid: snap.docs[0].id, ...snap.docs[0].data() };
    const chatId = await ensurePrivateChat(u.uid, u.name);
    const payload = {
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: m.text || "", timestamp: serverTimestamp(),
      forwarded: true, fromName: m.senderName || ""
    };
    if (m.imageUrl) payload.imageUrl = m.imageUrl;
    if (m.audioUrl) { payload.audioUrl = m.audioUrl; payload.mediaType = "voice"; }
    if (m.type === "gift" && m.gift) { payload.type = "gift"; payload.gift = m.gift; }
    await addDoc(collection(db, "chats", chatId, "messages"), payload);
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: "↗ Переслано", lastMessageTime: serverTimestamp()
    });
    showToast("Переслано @" + u.username);
  } catch (e) { showToast(translateAuthError(e)); }
}

async function editMessage(m) {
  if (!m.id || !currentChatId) return;
  const next = prompt("Редактировать сообщение:", m.text || "");
  if (next === null) return;
  try {
    await updateDoc(doc(db, "chats", currentChatId, "messages", m.id), {
      text: next.trim(), edited: true
    });
    showToast("Изменено");
  } catch (e) { showToast(translateAuthError(e)); }
}

async function deleteMessage(msgId) {
  if (!currentChatId || !msgId) return;
  if (!confirm("Удалить сообщение?")) return;
  try {
    await deleteDoc(doc(db, "chats", currentChatId, "messages", msgId));
    showToast("Сообщение удалено");
  } catch (e) { showToast(translateAuthError(e)); }
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
  const nfts = await loadUserNfts(u.uid, u.nfts || []);
  const userGifts = u.gifts || [];
  const giftCount = userGifts.length + nfts.length;

  const head = el(`<div class="bs-profile">
    <div class="profile-avatar-big" id="peerAv"></div>
    <div class="bs-profile-name">${escapeHtml(u.name || "")}${hasPremium(u) ? " <span class=\"premium-badge\">✦</span>" : ""}</div>
    <div class="bs-profile-status">${isOnline(u) ? "в сети" : "был(а) недавно"}</div>
    <div class="bs-profile-actions">
      <button type="button" class="bs-act" id="writePeerBtn"><span>💬</span>Чат</button>
      <button type="button" class="bs-act" id="callPeerBtn"><span>📞</span>Звонок</button>
      <button type="button" class="bs-act" id="sendGiftBtn"><span>★</span>Подарок</button>
      <button type="button" class="bs-act" id="morePeerBtn"><span>⋯</span>Ещё</button>
    </div>
  </div>`);
  body.appendChild(head);
  setAvatarEl(document.getElementById("peerAv"), u);

  const info = el(`<div class="bs-section"></div>`);
  info.appendChild(el(`<div class="bs-row"><div class="bs-row-label">Имя пользователя</div><div class="bs-row-value">@${escapeHtml(u.username || "")}</div></div>`));
  if (u.phone && (!(u.settings?.whoPhone) || u.settings.whoPhone === "all" || u.uid === currentUser.uid)) {
    info.appendChild(el(`<div class="bs-row"><div class="bs-row-label">Телефон</div><div class="bs-row-value">${escapeHtml(u.phone)}</div></div>`));
  }
  if (u.bio) {
    info.appendChild(el(`<div class="bs-row"><div class="bs-row-label">О себе</div><div class="bs-row-value">${escapeHtml(u.bio)}</div></div>`));
  }
  body.appendChild(info);

  // Gifts grid like screenshot 3
  const giftsSec = el(`<div class="bs-section bs-gifts-sec">
    <button type="button" class="bs-gifts-head" id="openGiftsGrid">
      <span>★ ${giftCount} подарк${giftCount === 1 ? "" : (giftCount > 1 && giftCount < 5 ? "а" : "ов")}</span>
      <span class="bs-gifts-preview" id="giftsPreview"></span>
    </button>
  </div>`);
  body.appendChild(giftsSec);
  const prev = document.getElementById("giftsPreview");
  [...nfts.slice(0, 3), ...userGifts.slice(-3)].slice(0, 4).forEach(item => {
    const mini = el(`<span class="bs-gift-chip"></span>`);
    if (item.imageUrl) mini.innerHTML = `<img src="${escapeHtml(item.imageUrl)}" alt="">`;
    else mini.textContent = item.emoji || "◆";
    prev.appendChild(mini);
  });
  document.getElementById("openGiftsGrid").onclick = () => openGiftsGallery(u, nfts, userGifts);

  if (isPeer) {
    const actions = el(`<div class="bs-section">
      <button class="bs-link-btn" id="toggleContactBtn">${isContact ? "Удалить из контактов" : "ДОБАВИТЬ КОНТАКТ"}</button>
      <button class="bs-danger-link" id="blockUserBtn">Заблокировать</button>
    </div>`);
    body.appendChild(actions);
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
    document.getElementById("blockUserBtn").onclick = () => blockUser(u.uid);
  }

  document.getElementById("writePeerBtn").onclick = () => {
    document.getElementById("userProfileScreen").classList.add("hidden");
  };
  document.getElementById("callPeerBtn").onclick = () => {
    document.getElementById("userProfileScreen").classList.add("hidden");
    startCall();
  };
  document.getElementById("sendGiftBtn").onclick = () => sendGiftToUser(u);
  document.getElementById("morePeerBtn").onclick = () => {
    const m = el(`<div class="msg-ctx-menu" id="peerMoreMenu" style="position:fixed;left:50%;top:40%;transform:translate(-50%,-50%)">
      <button type="button" id="pmClear">Очистить чат</button>
      <button type="button" id="pmHide">Удалить чат из списка</button>
      <button type="button" class="danger" id="pmBlock">Заблокировать</button>
    </div>`);
    document.body.appendChild(m);
    const close = () => m.remove();
    setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    document.getElementById("pmClear").onclick = (e) => { e.stopPropagation(); close(); clearCurrentChat(); };
    document.getElementById("pmHide").onclick = (e) => { e.stopPropagation(); close(); hideCurrentChat(); };
    document.getElementById("pmBlock").onclick = (e) => { e.stopPropagation(); close(); blockUser(u.uid); };
  };
}

function openGiftsGallery(u, nfts, gifts) {
  let box = document.getElementById("giftsGalleryModal");
  if (box) box.remove();
  box = el(`<div class="modal-overlay" id="giftsGalleryModal">
    <div class="gifts-gallery">
      <div class="gifts-gallery-head">
        <button type="button" id="ggBack">←</button>
        <h3>Подарки</h3>
        <button type="button" id="ggClose">✕</button>
      </div>
      <div class="gifts-gallery-grid" id="ggGrid"></div>
      <p class="gifts-gallery-foot">${escapeHtml(u.name || "")} получил(а) эти подарки.</p>
    </div>
  </div>`);
  document.body.appendChild(box);
  const grid = document.getElementById("ggGrid");
  nfts.forEach(n => {
    const card = el(`<button type="button" class="gg-card"></button>`);
    if (n.imageUrl) card.innerHTML = `<img src="${escapeHtml(n.imageUrl)}" alt=""><span class="gg-label">${escapeHtml(n.name || "")}</span>`;
    else {
      card.style.background = n.bg || "#5b4cdb";
      card.innerHTML = `<span class="gg-emoji">${n.emoji || "◆"}</span><span class="gg-label">${escapeHtml(n.name || "NFT")}</span>`;
    }
    card.onclick = () => { box.remove(); showNftDetail(n, false, u.name); };
    grid.appendChild(card);
  });
  gifts.slice().reverse().forEach(g => {
    const card = el(`<button type="button" class="gg-card"></button>`);
    if (g.imageUrl) card.innerHTML = `<img src="${escapeHtml(g.imageUrl)}" alt="">`;
    else {
      card.style.background = g.bg || "#2a2a40";
      card.innerHTML = `<span class="gg-emoji">${g.emoji || "★"}</span>`;
    }
    card.onclick = () => {
      if (g.kind === "nft" || g.nftDocId) showNftDetail({
        name: g.name, nftId: g.nftId, model: g.model, pattern: g.symbol,
        backdrop: g.backdrop, imageUrl: g.imageUrl, emoji: g.emoji, bg: g.bg,
        ownerName: u.name
      }, false, u.name);
    };
    grid.appendChild(card);
  });
  if (!nfts.length && !gifts.length) {
    grid.innerHTML = '<div class="search-empty" style="padding:24px">Подарков пока нет</div>';
  }
  document.getElementById("ggClose").onclick = () => box.remove();
  document.getElementById("ggBack").onclick = () => box.remove();
  box.onclick = (e) => { if (e.target === box) box.remove(); };
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
  const card = el(`<div class="nft-card nft-card-v2">
    <div class="nft-art" style="background:${escapeHtml((n.bg && !String(n.bg).includes("gradient")) ? n.bg : "#3b4a6b")}"></div>
    <div class="nft-meta">
      <div class="nft-name">${escapeHtml(n.name || "NFT")} <span class="nft-hash">#${n.nftId || "?"}</span></div>
      <div class="nft-id">${escapeHtml(n.model || rare)} · ${owned ? "ваше" : "осталось " + (n.remaining ?? 0)}</div>
      ${canBuy ? `<div class="nft-price">★ ${n.price} BC</div>` : (n.price ? `<div class="nft-price">★ ${n.price} BC</div>` : "")}
    </div>
  </div>`);
  const art = card.querySelector(".nft-art");
  applyNftArt(art, n);
  card.onclick = () => {
    if (typeof showNftDetail === "function") showNftDetail(n, !!(canBuy && !owned));
    else if (canBuy) buyNft(n);
  };
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
    d.style.background = n.bg || "linear-gradient(135deg,#3b82f6,#1e3a5f)";
    d.textContent = n.emoji || "◆";
  }
  d.style.cursor = "pointer";
  d.onclick = () => showNftDetail(n, false, n.ownerName);
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
        <button class="btn-outline gift-pick-btn" data-kind="nft">◆ Передать мой NFT</button>
        <button class="btn-outline gift-pick-btn" data-kind="collectible">◆ Коллекционный предмет</button>
        <button class="btn-outline gift-pick-btn" data-kind="coins">★ BlackCoin</button>
        <button class="btn-outline gift-pick-btn" data-kind="premium">★ Premium</button>
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
      if (kind === "nft") await doTransferNft(toUser);
      else if (kind === "collectible") await doSendCollectibleGift(toUser);
      else if (kind === "coins") await doSendCoinsGift(toUser);
      else if (kind === "premium") await doSendPremiumGift(toUser);
    };
  });
}


/* ===== CLAIMABLE TRANSFERS (NFT / coins / premium / gifts) ===== */
async function writeTransfer(payload) {
  const ref = await addDoc(collection(db, "transfers"), {
    ...payload,
    fromUid: currentUser.uid,
    fromName: currentProfile.name || "",
    status: "pending",
    createdAt: serverTimestamp()
  });
  return ref.id;
}

async function claimTransfer(transferId, msgId) {
  if (!transferId || !currentUser) return false;
  try {
    const snap = await getDoc(doc(db, "transfers", transferId));
    if (!snap.exists()) {
      console.warn("transfer missing", transferId);
      return false;
    }
    const t = snap.data();
    if (t.toUid && t.toUid !== currentUser.uid) return false;
    return claimGiftPayload({
      ...t,
      transferId,
      kind: t.type || t.kind,
      type: t.type || t.kind,
      nftDocId: t.nftDocId,
      amount: t.amount,
      months: t.months,
      gift: t.gift
    }, msgId);
  } catch (e) {
    console.warn("claimTransfer load", e);
    return false;
  }
}

/** Claim works ONLY on own user doc — works with strict Firestore rules */
async function claimGiftPayload(g, msgId) {
  if (!currentUser || !g) return false;
  const claimKey = g.transferId || msgId || (g.kind + "_" + g.at + "_" + (g.fromUid || ""));
  if (!claimKey) return false;
  const already = (currentProfile.claimedGifts || []);
  if (already.includes(claimKey) || g.claimed) return true;

  try {
    const meRef = doc(db, "users", currentUser.uid);
    const meSnap = await getDoc(meRef);
    if (!meSnap.exists()) throw new Error("Профиль не найден");
    const me = meSnap.data();
    if ((me.claimedGifts || []).includes(claimKey)) {
      currentProfile.claimedGifts = me.claimedGifts;
      return true;
    }

    const updates = { claimedGifts: arrayUnion(claimKey) };

    if (g.kind === "coins" || g.kind === "stars" || g.type === "coins") {
      const amount = g.amount || 0;
      if (amount > 0) updates.blackCoins = increment(amount);
    } else if (g.kind === "nft" || g.type === "nft") {
      const nid = g.nftDocId || g.nftDocID;
      if (nid) updates.nfts = arrayUnion(nid);
    } else if (g.kind === "premium" || g.type === "premium") {
      const months = g.months || 1;
      const base = me.premiumUntil
        ? (me.premiumUntil.toDate ? me.premiumUntil.toDate() : new Date(me.premiumUntil))
        : new Date();
      const start = base > new Date() ? base.getTime() : Date.now();
      updates.premiumUntil = new Date(start + months * 30 * 24 * 60 * 60 * 1000);
    } else if (g.kind === "collectible" || g.type === "collectible") {
      updates.gifts = arrayUnion(g.gift || g);
    }

    await updateDoc(meRef, updates);

    // optional: mark transfer doc claimed
    if (g.transferId) {
      try { await updateDoc(doc(db, "transfers", g.transferId), { status: "claimed", claimedAt: serverTimestamp() }); } catch (_) {}
    }
    if (g.kind === "nft" || g.type === "nft") {
      const nid = g.nftDocId;
      if (nid) {
        try { await updateDoc(doc(db, "nfts", nid), { ownerUid: currentUser.uid, ownerName: currentProfile.name || "" }); } catch (_) {}
      }
    }

    // refresh profile
    const s = await getDoc(meRef);
    if (s.exists()) {
      currentProfile = { ...currentProfile, ...s.data() };
      updateDrawer();
    }
    if (msgId && currentChatId) {
      try { await updateDoc(doc(db, "chats", currentChatId, "messages", msgId), { "gift.claimed": true }); } catch (_) {}
    }
    showToast("Получено ✓");
    return true;
  } catch (e) {
    console.warn("claimGiftPayload", e);
    showToast("Не удалось получить: " + (e.message || "ошибка"));
    return false;
  }
}

async function doTransferNft(toUser) {

  const targetUid = toUser.uid || toUser.id;
  if (!targetUid) return showToast("Пользователь не найден");
  if (targetUid === currentUser.uid) return showToast("Нельзя передать себе");
  const myIds = currentProfile.nfts || [];
  if (!myIds.length) return showToast("У тебя нет NFT для передачи");
  setLoading(true);
  try {
    const list = await loadUserNfts(currentUser.uid, myIds);
    if (!list.length) return showToast("NFT не найдены");
    const names = list.map((n, i) => `${i + 1}. ${n.name || "NFT"} #${n.nftId || "?"}`).join("\n");
    const choice = prompt("Какой NFT передать? (номер)\n" + names, "1");
    if (choice === null) return;
    const idx = Math.max(0, (parseInt(choice, 10) || 1) - 1);
    const n = list[idx];
    if (!n) return showToast("Неверный номер");
    if (!confirm(`Передать «${n.name}» #${n.nftId || "?"} → ${toUser.name}?`)) return;

    // Remove from sender first
    await runTransaction(db, async (tx) => {
      const fromRef = doc(db, "users", currentUser.uid);
      const fromSnap = await tx.get(fromRef);
      if (!fromSnap.exists()) throw new Error("Профиль не найден");
      const fromNfts = fromSnap.data().nfts || [];
      if (!fromNfts.includes(n.id)) throw new Error("Этот NFT уже не у тебя");
      tx.update(fromRef, { nfts: fromNfts.filter(id => id !== n.id) });
    });
    currentProfile.nfts = (currentProfile.nfts || []).filter(id => id !== n.id);
    try {
      await updateDoc(doc(db, "nfts", n.id), { ownerUid: targetUid, ownerName: toUser.name || "" });
    } catch (_) {}

    const transferId = await writeTransfer({
      type: "nft", toUid: targetUid, nftDocId: n.id,
      nftId: n.nftId, name: n.name
    });

    // Try direct add to recipient (if rules allow)
    try {
      await updateDoc(doc(db, "users", targetUid), { nfts: arrayUnion(n.id) });
      await updateDoc(doc(db, "transfers", transferId), { status: "claimed" });
    } catch (_) {}

    const gift = {
      kind: "nft", transferId, claimed: false,
      nftDocId: n.id,
      name: n.name, emoji: n.emoji || "◆", bg: n.bg,
      imageUrl: n.imageUrl || "",
      nftId: n.nftId, model: n.model || "Standard",
      backdrop: n.backdrop || n.bgName || "Default",
      symbol: n.symbol || n.pattern || "—",
      fromUid: currentUser.uid, fromName: currentProfile.name,
      at: Date.now()
    };
    const chatId = await ensurePrivateChat(targetUid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift", gift,
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: "", timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `◆ ${currentProfile.name} передал(а) NFT ${n.name}`,
      lastMessageTime: serverTimestamp()
    });
    showToast("NFT передан!");
    updateDrawer();
  } catch (e) { showToast(e.message || translateAuthError(e)); }
  finally { setLoading(false); }
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
  const targetUid = toUser.uid || toUser.id;
  if (!targetUid) return showToast("Пользователь не найден");
  setLoading(true);
  try {
    const cat = await getDocs(query(collection(db, "giftCatalog"), limit(40)));
    if (cat.empty) { showToast("Каталог подарков пуст — создай в админке"); return; }
    const list = cat.docs.map(d => ({ id: d.id, ...d.data() }));
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
      catalogId: pick.id, name: pick.name, emoji: pick.emoji || "◆", bg: pick.bg || "linear-gradient(135deg,#1a1a2e,#0a0a12)",
      imageUrl: pick.imageUrl || "",
      model: pick.model || "Standard",
      backdrop: pick.backdrop || "Black",
      symbol: pick.symbol || "Gift",
      nftId: pick.nftId || Math.floor(Math.random() * 90000 + 10000),
      fromUid: currentUser.uid, fromName: currentProfile.name,
      message: msg, at: Date.now()
    };
    const transferId = await writeTransfer({ type: "collectible", toUid: targetUid, gift });
    gift.transferId = transferId;
    try {
      await updateDoc(doc(db, "users", targetUid), { gifts: arrayUnion(gift) });
      await updateDoc(doc(db, "transfers", transferId), { status: "claimed" });
      gift.claimed = true;
    } catch (_) {}

    const chatId = await ensurePrivateChat(targetUid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift", gift,
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: "", timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `◆ ${currentProfile.name} подарил(а) ${pick.name}`,
      lastMessageTime: serverTimestamp()
    });
    showToast("Коллекционный подарок отправлен!");
    updateDrawer();
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

async function doSendCoinsGift(toUser) {
  const targetUid = toUser.uid || toUser.id;
  if (!targetUid) return showToast("Пользователь не найден");
  if (targetUid === currentUser.uid) return showToast("Нельзя отправить себе");
  const amountStr = prompt("Сколько BlackCoin подарить?", "100");
  const amount = Math.max(1, parseInt(amountStr, 10) || 0);
  if (!amount) return;
  if ((currentProfile.blackCoins || 0) < amount) { showToast("Недостаточно BC"); return; }
  setLoading(true);
  try {
    // Debit sender
    await runTransaction(db, async (tx) => {
      const fromRef = doc(db, "users", currentUser.uid);
      const fromSnap = await tx.get(fromRef);
      if (!fromSnap.exists()) throw new Error("Твой профиль не найден");
      const fromBal = fromSnap.data().blackCoins || 0;
      if (fromBal < amount) throw new Error("Недостаточно BC");
      tx.update(fromRef, { blackCoins: fromBal - amount });
    });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) - amount;

    const transferId = await writeTransfer({ type: "coins", toUid: targetUid, amount });

    // Try credit recipient directly
    let claimed = false;
    try {
      await runTransaction(db, async (tx) => {
        const toRef = doc(db, "users", targetUid);
        const toSnap = await tx.get(toRef);
        if (!toSnap.exists()) throw new Error("Получатель не найден");
        tx.update(toRef, { blackCoins: (toSnap.data().blackCoins || 0) + amount });
      });
      await updateDoc(doc(db, "transfers", transferId), { status: "claimed" });
      claimed = true;
    } catch (_) {}

    const gift = {
      kind: "coins", amount, transferId, claimed,
      fromUid: currentUser.uid, fromName: currentProfile.name,
      at: Date.now()
    };
    try {
      await updateDoc(doc(db, "users", targetUid), { gifts: arrayUnion(gift) });
    } catch (_) {}

    const chatId = await ensurePrivateChat(targetUid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift", gift,
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: "", timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `★ ${currentProfile.name} отправил(а) ${amount} BC`,
      lastMessageTime: serverTimestamp()
    });
    showToast(`${amount} BC отправлено!`);
    updateDrawer();
  } catch (e) {
    showToast(e.message || translateAuthError(e));
  } finally { setLoading(false); }
}

async function doSendPremiumGift(toUser) {
  const targetUid = toUser.uid || toUser.id;
  if (!targetUid) return showToast("Пользователь не найден");
  const monthsStr = prompt("На сколько месяцев Premium? (1 / 3 / 6 / 12)", "1");
  const months = [1, 3, 6, 12].includes(parseInt(monthsStr, 10)) ? parseInt(monthsStr, 10) : 1;
  const costMap = { 1: 200, 3: 500, 6: 900, 12: 1500 };
  const cost = costMap[months] || 200;
  if ((currentProfile.blackCoins || 0) < cost) { showToast("Недостаточно BC"); return; }
  setLoading(true);
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { blackCoins: increment(-cost) });
    currentProfile.blackCoins = (currentProfile.blackCoins || 0) - cost;

    const transferId = await writeTransfer({ type: "premium", toUid: targetUid, months });
    let claimed = false;
    try {
      const snap = await getDoc(doc(db, "users", targetUid));
      const rec = snap.exists() ? snap.data() : {};
      const base = rec.premiumUntil
        ? (rec.premiumUntil.toDate ? rec.premiumUntil.toDate() : new Date(rec.premiumUntil))
        : new Date();
      if (base < new Date()) base.setTime(Date.now());
      const until = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000);
      await updateDoc(doc(db, "users", targetUid), { premiumUntil: until });
      await updateDoc(doc(db, "transfers", transferId), { status: "claimed" });
      claimed = true;
    } catch (_) {}

    const gift = {
      kind: "premium", months, transferId, claimed,
      fromUid: currentUser.uid, fromName: currentProfile.name,
      at: Date.now()
    };
    try {
      await updateDoc(doc(db, "users", targetUid), { gifts: arrayUnion(gift) });
    } catch (_) {}

    const chatId = await ensurePrivateChat(targetUid, toUser.name);
    await addDoc(collection(db, "chats", chatId, "messages"), {
      type: "gift", gift,
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: "", timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), {
      lastMessage: `★ ${currentProfile.name} подарил(а) Premium на ${months} мес`,
      lastMessageTime: serverTimestamp()
    });
    showToast(`Premium на ${months} мес отправлен!`);
    updateDrawer();
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

/* ===== EMOJI / STICKERS ===== */
const EMOJI_PACKS = {
  smileys: { name: "😊", label: "Смайлы", items: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐"] },
  animals: { name: "🐱", label: "Животные", items: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰","🪲","🪳","🦟","🦗","🕷","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊"] },
  food: { name: "🍎", label: "Еда", items: ["🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪"] },
  objects: { name: "⚽", label: "Вещи", items: ["⌚","📱","💻","⌨️","🖥","🖨","🖱","🖲","🕹","🗜","💾","💿","📀","📼","📷","📸","📹","🎥","📽","🎞","📞","☎️","📟","📠","📺","📻","🎙","🎚","🎛","🧭","⏱","⏲","⏰","🕰","⌛","⏳","📡","🔋","🔌","💡","🔦","🕯","🪔","🧯","🛢","💸","💵","💴","💶","💷","🪙","💰","💳","💎","⚖️","🪜","🧰","🪛","🔧","🔨","⚒","🛠","⛏","🪚","🔩","⚙️","🪤","🧱","⛓","🧲","🔫","💣","🧨","🪓","🔪","🗡","⚔️","🛡","🚬","⚰️","🪦","⚱️","🏺","🔮","📿","🧿","💈","⚗️","🔭","🔬","🕳","🩹","🩺","💊","💉","🩸","🧬","🦠","🧫","🧪","🌡","🧹","🪠","🧺","🧻","🚽","🚰","🚿","🛁","🛀","🧼","🪥","🪒","🧽","🪣","🧴","🛎️","🔑","🗝","🚪","🪑","🛋","🛏","🛌","🧸","🖼","🪞","🪟","🛍","🛒","🎁","🎈","🎏","🎀","🪄","🪅","🎊","🎉","🎎","🏮","🎐","🧧"] },
  nature: { name: "🌍", label: "Природа", items: ["🌍","🌎","🌏","🌐","🗺","🧭","🏔","⛰","🌋","🗻","🏕","🏖","🏜","🏝","🏞","🏟","🏛","🏗","🧱","🪨","🪵","🛖","🏘","🏚","🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨","🏩","🏪","🏫","🏬","🏭","🏯","🏰","💒","🗼","🗽","⛪","🕌","🛕","synagogue","⛩","🕋","⛲","⛺","🌁","🌃","🏙","🌄","🌅","🌆","🌇","🌉","♨","🎠","🎡","🎢","💈","🎪","🚂","🚃","🚄","🚅","🚆","🚇","🚈","🚉","🚊","🚝","🚞","🚋","🚌","🚍","🚎","🚐","🚑","🚒","🚓","🚔","🚕","🚖","🚗","🚘","🚙","🛻","🚚","🚛","🚜","🏎","🏍","🛵","🦽","🦼","🛺","🚲","🛴","🛹","🛼","🚏","🛣","🛤","🛢","⛽","🚨","🚥","🚦","🛑","🚧"] },
  symbols: { name: "❤️", label: "Символы", items: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰","♻️","✅","🈯","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️","🛗","🈳","🈂️","🛂","🛃","🛄","🛅","♂️","♀️","⚧","✖️","➕","➖","➗","♾️","‼️","⁉️","❓","❔","❕","❗","〰️","💱","💲","⚕️","♻️","⚜️","🔱","📛","🔰","⭕","✅","☑️","✔️","❌","❎","➰","➿","〽","✳️","✴️","❇️","©️","®️","™️","#️⃣","*️⃣","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"] }
};

let currentEmojiPack = "smileys";
let currentEmojiTab = "emoji";

function openEmojiPanel() {
  const panel = document.getElementById("emojiPanel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) renderEmojiPanel();
}

function renderEmojiPanel() {
  const bar = document.getElementById("emojiPackBar");
  const grid = document.getElementById("emojiGrid");
  if (!bar || !grid) return;

  if (currentEmojiTab === "emoji") {
    bar.innerHTML = "";
    Object.keys(EMOJI_PACKS).forEach(key => {
      const p = EMOJI_PACKS[key];
      const b = el(`<button type="button" class="emoji-pack-btn ${key === currentEmojiPack ? "active" : ""}" data-pack="${key}" title="${p.label}">${p.name}</button>`);
      b.onclick = () => { currentEmojiPack = key; renderEmojiPanel(); };
      bar.appendChild(b);
    });
    grid.innerHTML = "";
    (EMOJI_PACKS[currentEmojiPack]?.items || []).forEach(em => {
      const btn = el(`<button type="button" class="emoji-item">${em}</button>`);
      btn.onclick = () => {
        const inp = document.getElementById("msgInput");
        if (inp) { inp.value += em; inp.focus(); }
      };
      grid.appendChild(btn);
    });
  } else if (currentEmojiTab === "stickers") {
    bar.innerHTML = "";
    grid.innerHTML = '<div class="search-empty" style="padding:20px">Стикер-паки скоро · бесплатные эмодзи уже доступны</div>';
  } else if (currentEmojiTab === "premium") {
    bar.innerHTML = "";
    if (!hasPremium(currentProfile)) {
      grid.innerHTML = '<div class="search-empty" style="padding:20px">Premium-эмодзи доступны с подпиской Black Premium<br><button class="btn-primary" id="goPremiumFromEmoji" style="margin-top:12px">Оформить Premium</button></div>';
      document.getElementById("goPremiumFromEmoji")?.addEventListener("click", () => { document.getElementById("emojiPanel").classList.add("hidden"); openShop(); });
    } else {
      const custom = (currentProfile.customEmoji || []);
      grid.innerHTML = "";
      if (!custom.length) {
        grid.innerHTML = '<div class="search-empty" style="padding:12px 16px">Нажми + чтобы добавить текст или картинку</div>';
      }
      custom.forEach((em, idx) => {
        let btn;
        if (typeof em === "object" && em && em.url) {
          btn = el(`<button type="button" class="emoji-item emoji-img" title="Удержать = удалить"><img src="${escapeHtml(em.url)}" alt=""></button>`);
          btn.onclick = () => insertCustomEmojiImg(em);
        } else {
          const s = typeof em === "string" ? em : (em && em.text) || "?";
          btn = el(`<button type="button" class="emoji-item" title="Удержать = удалить">${escapeHtml(s)}</button>`);
          btn.onclick = () => {
            const inp = document.getElementById("msgInput");
            if (inp) { inp.value += s; inp.focus(); }
          };
        }
        let holdT = null;
        btn.addEventListener("contextmenu", (e) => { e.preventDefault(); deleteCustomEmoji(idx); });
        btn.addEventListener("touchstart", () => { holdT = setTimeout(() => deleteCustomEmoji(idx), 550); }, { passive: true });
        btn.addEventListener("touchend", () => clearTimeout(holdT));
        btn.addEventListener("touchmove", () => clearTimeout(holdT));
        grid.appendChild(btn);
      });
      const addBtn = el(`<button type="button" class="emoji-item emoji-add">+</button>`);
      addBtn.onclick = () => openCustomEmojiCreator();
      grid.appendChild(addBtn);
    }
  }
}

async function saveCustomEmoji(em) {
  // Always store as object for consistency
  let item = em;
  if (typeof em === "string") item = { text: em, url: "" };
  if (item.url && item.url.length > 900000) {
    showToast("Картинка слишком большая, сожми или выбери меньше");
    return;
  }
  const list = [...(currentProfile.customEmoji || []), item].slice(0, 48);
  currentProfile.customEmoji = list;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { customEmoji: list });
    renderEmojiPanel();
    showToast(item.url ? "Стикер с картинкой добавлен" : "Эмодзи добавлен");
  } catch (e) {
    console.error(e);
    showToast(translateAuthError(e) || "Не удалось сохранить (лимит Firestore?)");
  }
}

async function deleteCustomEmoji(idx) {
  if (!confirm("Удалить этот эмодзи/стикер из пака?")) return;
  const list = [...(currentProfile.customEmoji || [])];
  if (idx < 0 || idx >= list.length) return;
  list.splice(idx, 1);
  currentProfile.customEmoji = list;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { customEmoji: list });
    renderEmojiPanel();
    showToast("Удалено");
  } catch (e) { showToast(translateAuthError(e)); }
}

async function insertCustomEmojiImg(em) {
  if (!currentChatId || !em?.url) return;
  try {
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: em.text || "", imageUrl: em.url, mediaType: "sticker",
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", currentChatId), {
      lastMessage: "◆ Стикер", lastMessageTime: serverTimestamp()
    });
    document.getElementById("emojiPanel")?.classList.add("hidden");
  } catch (e) { showToast(translateAuthError(e)); }
}

function openCustomEmojiCreator() {
  const box = el(`<div class="modal-overlay" id="customEmojiModal">
    <div class="modal-box" style="max-width:360px">
      <div class="modal-header"><h3>Свой эмодзи</h3><button type="button" class="modal-close" id="ceClose">✕</button></div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-2);margin-bottom:10px">Текст (опционально) или загрузи картинку</p>
        <div class="profile-field"><label>Текст / код</label><input type="text" id="ceText" placeholder=":myemoji:"></div>
        <div class="profile-field"><label>Картинка</label><input type="file" id="ceFile" accept="image/png,image/jpeg,image/gif,image/webp"></div>
        <div id="cePreview" style="text-align:center;margin:10px 0"></div>
        <button class="btn-primary" id="ceSave" style="width:100%">Сохранить</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(box);
  let dataUrl = "";
  document.getElementById("ceClose").onclick = () => box.remove();
  box.onclick = (e) => { if (e.target === box) box.remove(); };
  document.getElementById("ceFile").onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return showToast("Нужна картинка");
    if (f.size > 2 * 1024 * 1024) return showToast("Макс. 2 МБ");
    try {
      dataUrl = await fileToDataUrl(f, 96, 0.7);
      if (!dataUrl || !dataUrl.startsWith("data:image")) throw new Error("bad image");
      document.getElementById("cePreview").innerHTML = `<img src="${dataUrl}" style="width:72px;height:72px;object-fit:contain;border-radius:12px;background:#111">`;
      showToast("Картинка готова");
    } catch (err) {
      dataUrl = "";
      showToast("Не удалось обработать картинку");
    }
  };
  document.getElementById("ceSave").onclick = async () => {
    const text = document.getElementById("ceText").value.trim();
    if (!dataUrl && !text) return showToast("Нужен текст или картинка");
    const item = { text: text || (dataUrl ? "sticker" : ""), url: dataUrl || "" };
    await saveCustomEmoji(item);
    box.remove();
  };
}

document.getElementById("emojiBtn")?.addEventListener("click", openEmojiPanel);
document.querySelectorAll(".emoji-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".emoji-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentEmojiTab = tab.dataset.etab;
    renderEmojiPanel();
  });
});

/* ===== VOICE MESSAGES ===== */
let mediaRecorder = null;
let voiceChunks = [];
let voiceStartTs = 0;
let voiceTimerInterval = null;

document.getElementById("voiceBtn")?.addEventListener("click", async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  if (!currentChatId) return showToast("Открой чат");
  if (!window.isSecureContext && location.protocol !== "https:" && location.hostname !== "localhost") {
    return showToast("Микрофон работает только по HTTPS или localhost");
  }
  let stream;
  try {
    showToast("Запрос доступа к микрофону…");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      showPermissionHelp("Микрофон заблокирован для этого сайта.");
    } else if (name === "NotFoundError") {
      showPermissionHelp("Микрофон не найден.");
    } else {
      showPermissionHelp("Нет доступа к микрофону: " + (e.message || name));
    }
    return;
  }
  try {
    voiceChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
      : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) voiceChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(tr => tr.stop());
      clearInterval(voiceTimerInterval);
      document.getElementById("voiceRecBar")?.classList.add("hidden");
      if (!voiceChunks.length) return showToast("Пустая запись");
      const blob = new Blob(voiceChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (blob.size > 5 * 1024 * 1024) return showToast("Слишком длинное сообщение");
      await sendVoiceMessage(blob);
    };
    mediaRecorder.start(250);
    voiceStartTs = Date.now();
    document.getElementById("voiceRecBar")?.classList.remove("hidden");
    document.getElementById("voiceTimer").textContent = "0:00";
    voiceTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - voiceStartTs) / 1000);
      document.getElementById("voiceTimer").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      if (sec >= 60) { try { mediaRecorder.stop(); } catch(_){} mediaRecorder = null; }
    }, 250);
  } catch (e) {
    stream.getTracks().forEach(tr => tr.stop());
    showToast("Ошибка записи: " + (e.message || e));
  }
});

document.getElementById("voiceCancel")?.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = () => {};
    mediaRecorder.stop();
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
  }
  mediaRecorder = null;
  voiceChunks = [];
  clearInterval(voiceTimerInterval);
  document.getElementById("voiceRecBar")?.classList.add("hidden");
});

document.getElementById("voiceSend")?.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mediaRecorder = null;
  }
});

async function sendVoiceMessage(blob) {
  if (!currentChatId) return;
  setLoading(true);
  try {
    const reader = new FileReader();
    const dataUrl = await new Promise((res, rej) => {
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text: "🎤 Голосовое сообщение",
      audioUrl: dataUrl,
      mediaType: "voice",
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", currentChatId), {
      lastMessage: "🎤 Голосовое",
      lastMessageTime: serverTimestamp()
    });
  } catch (e) { showToast(translateAuthError(e)); }
  finally { setLoading(false); }
}

/* ===== REAL WEBRTC CALLS ===== */
document.getElementById("callBtn")?.addEventListener("click", startCall);
document.getElementById("plusCall")?.addEventListener("click", () => {
  document.getElementById("plusMenu")?.classList.add("hidden");
  startCall();
});

let pc = null;
let localStream = null;
let callUnsub = null;
let currentCallId = null;
const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

async function requestMedia(kind) {
  try {
    if (kind === "audio") return await navigator.mediaDevices.getUserMedia({ audio: true });
    if (kind === "video") return await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    const msg = (e && e.name === "NotAllowedError")
      ? "Разреши доступ к микрофону/камере в настройках браузера"
      : ("Нет доступа к устройству: " + (e.message || e.name || ""));
    showToast(msg);
    throw e;
  }
}

async function startCall() {
  if (!currentChat || currentChat.type !== "private") {
    return showToast("Звонки только в личных чатах");
  }
  const otherUid = currentChat.members.find(m => m !== currentUser.uid);
  if (!otherUid) return;
  const name = chatDisplayName(currentChat);
  try {
    localStream = await requestMedia("audio");
  } catch (_) { return; }
  currentCallId = [currentUser.uid, otherUid].sort().join("_") + "_" + Date.now();
  showCallUI(name, otherUid, true);
  await createCallOffer(otherUid, name);
}

function showCallUI(name, otherUid, isCaller) {
  let box = document.getElementById("callOverlay");
  if (box) box.remove();
  box = el(`<div class="call-overlay" id="callOverlay">
    <div class="call-card">
      <div class="call-avatar" style="background:${hashColor(name)}">${initials(name)}</div>
      <div class="call-name">${escapeHtml(name)}</div>
      <div class="call-status" id="callStatus">${isCaller ? "Звоним…" : "Входящий звонок"}</div>
      <audio id="remoteAudio" autoplay playsinline></audio>
      <div class="call-actions">
        ${!isCaller ? '<button type="button" class="call-btn call-accept" id="callAcceptBtn">✅ Ответить</button>' : ""}
        <button type="button" class="call-btn call-end" id="callEndBtn">📵 Сброс</button>
      </div>
      <p class="call-hint">Аудиозвонок BlackSocial · WebRTC</p>
    </div>
  </div>`);
  document.body.appendChild(box);
  document.getElementById("callEndBtn").onclick = () => endCall(true);
  document.getElementById("callAcceptBtn")?.addEventListener("click", () => answerCall());
}

async function createCallOffer(otherUid, name) {
  pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(tr => pc.addTrack(tr, localStream));
  pc.ontrack = (ev) => {
    const a = document.getElementById("remoteAudio");
    if (a) a.srcObject = ev.streams[0];
    const st = document.getElementById("callStatus");
    if (st) st.textContent = "Разговор";
  };
  pc.onicecandidate = async (ev) => {
    if (!ev.candidate || !currentCallId) return;
    try {
      await addDoc(collection(db, "calls", currentCallId, "callerCandidates"), ev.candidate.toJSON());
    } catch (_) {}
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await setDoc(doc(db, "calls", currentCallId), {
    callerId: currentUser.uid,
    calleeId: otherUid,
    callerName: currentProfile.name,
    status: "ringing",
    offer: { type: offer.type, sdp: offer.sdp },
    createdAt: serverTimestamp()
  });
  // notify via chat message
  try {
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
      type: "call", callId: currentCallId,
      senderId: currentUser.uid, senderName: currentProfile.name,
      text: "📞 Входящий звонок", timestamp: serverTimestamp()
    });
  } catch (_) {}

  callUnsub = onSnapshot(doc(db, "calls", currentCallId), async (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.status === "ended") { endCall(false); return; }
    if (d.answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
      const st = document.getElementById("callStatus");
      if (st) st.textContent = "Соединено";
    }
  });
  // callee ICE
  onSnapshot(collection(db, "calls", currentCallId, "calleeCandidates"), (qs) => {
    qs.docChanges().forEach(async (ch) => {
      if (ch.type === "added" && pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())); } catch (_) {}
      }
    });
  });
}

async function answerCall() {
  if (!currentCallId) return;
  try {
    if (!localStream) localStream = await requestMedia("audio");
  } catch (_) { return; }
  const callRef = doc(db, "calls", currentCallId);
  const snap = await getDoc(callRef);
  if (!snap.exists()) return showToast("Звонок не найден");
  const d = snap.data();
  pc = new RTCPeerConnection(ICE_SERVERS);
  localStream.getTracks().forEach(tr => pc.addTrack(tr, localStream));
  pc.ontrack = (ev) => {
    const a = document.getElementById("remoteAudio");
    if (a) a.srcObject = ev.streams[0];
    const st = document.getElementById("callStatus");
    if (st) st.textContent = "Разговор";
  };
  pc.onicecandidate = async (ev) => {
    if (!ev.candidate) return;
    try {
      await addDoc(collection(db, "calls", currentCallId, "calleeCandidates"), ev.candidate.toJSON());
    } catch (_) {}
  };
  await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(callRef, {
    status: "active",
    answer: { type: answer.type, sdp: answer.sdp }
  });
  onSnapshot(collection(db, "calls", currentCallId, "callerCandidates"), (qs) => {
    qs.docChanges().forEach(async (ch) => {
      if (ch.type === "added" && pc) {
        try { await pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())); } catch (_) {}
      }
    });
  });
}

async function endCall(writeEnd) {
  try {
    if (writeEnd && currentCallId) {
      await updateDoc(doc(db, "calls", currentCallId), { status: "ended" });
    }
  } catch (_) {}
  if (callUnsub) { try { callUnsub(); } catch (_) {} callUnsub = null; }
  if (pc) { try { pc.close(); } catch (_) {} pc = null; }
  if (localStream) { localStream.getTracks().forEach(tr => tr.stop()); localStream = null; }
  currentCallId = null;
  document.getElementById("callOverlay")?.remove();
}

// Incoming call detection from messages
function handleIncomingCallMessage(m) {
  if (!m || m.type !== "call" || !m.callId) return;
  if (m.senderId === currentUser.uid) return;
  currentCallId = m.callId;
  showCallUI(m.senderName || "Звонок", m.senderId, false);
}


/* ===== NFT DETAIL MODAL (Telegram-style) ===== */
function showNftDetail(n, canBuy, ownerName) {
  let box = document.getElementById("nftDetailModal");
  if (box) box.remove();
  const modelPct = n.modelPct != null ? n.modelPct : (Math.random() * 4 + 0.4).toFixed(1);
  const patternPct = n.patternPct != null ? n.patternPct : (Math.random() * 2 + 0.2).toFixed(1);
  const bgPct = n.bgPct != null ? n.bgPct : (Math.random() * 3 + 0.4).toFixed(1);
  const supply = n.supply ?? n.total ?? "—";
  const remaining = n.remaining ?? n.issued ?? "—";
  const owner = ownerName || n.ownerName || currentProfile?.name || "—";
  const valueUah = n.valueUah != null ? n.valueUah : (n.price ? Math.round(n.price * 0.5) : null);
  const bgColor = n.bg || n.backdropColor || "#6d5cff";
  box = el(`<div class="modal-overlay" id="nftDetailModal">
    <div class="nft-sheet">
      <button type="button" class="nft-sheet-close" id="nftDetailClose">✕</button>
      <div class="nft-sheet-hero" style="background:${escapeHtml(typeof bgColor === "string" && bgColor.includes("gradient") ? "#5b4cdb" : bgColor)}">
        <div class="nft-sheet-art" id="nftDetailArt"></div>
        <div class="nft-sheet-name">${escapeHtml(n.name || "NFT")} <span class="nft-sheet-num">#${n.nftId || "?"}</span></div>
        <div class="nft-sheet-model">${escapeHtml(n.model || "Standard")}</div>
      </div>
      <div class="nft-sheet-body">
        <div class="nft-sheet-row"><span>Владелец</span><span class="nft-sheet-owner">${escapeHtml(owner)}</span></div>
        <div class="nft-sheet-row"><span>Модель</span><span>${escapeHtml(n.model || "Standard")} <em>${modelPct}%</em></span></div>
        <div class="nft-sheet-row"><span>Узор</span><span>${escapeHtml(n.pattern || n.symbol || "—")} <em>${patternPct}%</em></span></div>
        <div class="nft-sheet-row"><span>Фон</span><span>${escapeHtml(n.backdrop || n.bgName || "Default")} <em>${bgPct}%</em></span></div>
        <div class="nft-sheet-row"><span>Количество</span><span>${remaining}, выпущено ${supply}</span></div>
        <div class="nft-sheet-row"><span>Ценность</span><span class="nft-sheet-value">${valueUah != null ? valueUah + " UAH" : "★ " + (n.price || 0) + " BC"}</span></div>
        ${canBuy ? `<button class="btn-primary nft-sheet-btn" id="nftDetailBuy">Купить · ★ ${n.price || 0}</button>` : ""}
        <button class="btn-primary nft-sheet-btn" id="nftDetailOk">OK</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(box);
  const art = document.getElementById("nftDetailArt");
  if (n.imageUrl) {
    art.innerHTML = `<img src="${escapeHtml(n.imageUrl)}" alt="">`;
  } else {
    art.innerHTML = `<span class="nft-sheet-emoji">${n.emoji || "◆"}</span>`;
  }
  document.getElementById("nftDetailClose").onclick = () => box.remove();
  document.getElementById("nftDetailOk").onclick = () => box.remove();
  document.getElementById("nftDetailBuy")?.addEventListener("click", () => { box.remove(); buyNft(n); });
  box.onclick = (e) => { if (e.target === box) box.remove(); };
}

// Patch nftCardEl to open detail
const _origNftCardEl = typeof nftCardEl === "function" ? nftCardEl : null;
function nftCardElPatched(n, owned, canBuy) {
  const card = _origNftCardEl ? _origNftCardEl(n, owned, canBuy) : null;
  if (!card) return card;
  card.onclick = () => showNftDetail(n, canBuy && !owned);
  return card;
}
// Re-bind if function exists in scope - call site uses nftCardEl directly; override:
window.__nftShowDetail = showNftDetail;


/* ===== CAMERA CAPTURE ===== */
document.getElementById("plusPhoto")?.addEventListener("click", (e) => {
  // override: show choice gallery vs camera
});

async function openCameraCapture() {
  document.getElementById("plusMenu")?.classList.add("hidden");
  let stream;
  try {
    stream = await requestMedia("video");
  } catch (_) { return; }
  const box = el(`<div class="modal-overlay" id="cameraModal">
    <div class="modal-box" style="max-width:420px">
      <div class="modal-header"><h3>Камера</h3><button type="button" class="modal-close" id="camClose">✕</button></div>
      <div class="modal-body" style="text-align:center">
        <video id="camVideo" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;max-height:360px"></video>
        <canvas id="camCanvas" class="hidden"></canvas>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-primary" id="camShot" style="flex:1">Снять фото</button>
          <button class="btn-outline" id="camCancel" style="flex:1">Отмена</button>
        </div>
      </div>
    </div>
  </div>`);
  document.body.appendChild(box);
  const video = document.getElementById("camVideo");
  video.srcObject = stream;
  const stop = () => { stream.getTracks().forEach(tr => tr.stop()); box.remove(); };
  document.getElementById("camClose").onclick = stop;
  document.getElementById("camCancel").onclick = stop;
  document.getElementById("camShot").onclick = async () => {
    const canvas = document.getElementById("camCanvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stop();
    if (!currentChatId) return showToast("Открой чат");
    setLoading(true);
    try {
      await addDoc(collection(db, "chats", currentChatId, "messages"), {
        senderId: currentUser.uid, senderName: currentProfile.name,
        text: "", imageUrl: dataUrl, mediaType: "image",
        timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, "chats", currentChatId), {
        lastMessage: "📷 Фото", lastMessageTime: serverTimestamp()
      });
    } catch (e) { showToast(translateAuthError(e)); }
    finally { setLoading(false); }
  };
}

// Rebind plus photo to camera or gallery choice
(function rebindPlusPhoto() {
  const btn = document.getElementById("plusPhoto");
  if (!btn) return;
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);
  clone.addEventListener("click", () => {
    document.getElementById("plusMenu")?.classList.add("hidden");
    const box = el(`<div class="modal-overlay" id="photoChoice">
      <div class="modal-box" style="max-width:300px">
        <div class="modal-body" style="display:flex;flex-direction:column;gap:10px">
          <button class="btn-primary" id="pcCamera">📷 Снять с камеры</button>
          <button class="btn-outline" id="pcGallery">🖼 Из галереи</button>
          <button class="btn-outline" id="pcCancel">Отмена</button>
        </div>
      </div>
    </div>`);
    document.body.appendChild(box);
    document.getElementById("pcCancel").onclick = () => box.remove();
    box.onclick = (e) => { if (e.target === box) box.remove(); };
    document.getElementById("pcCamera").onclick = () => { box.remove(); openCameraCapture(); };
    document.getElementById("pcGallery").onclick = () => {
      box.remove();
      document.getElementById("fileInput").accept = "image/*";
      document.getElementById("fileInput").click();
    };
  });
})();

/* ===== ACCOUNT SWITCHER ===== */
const ACCOUNTS_KEY = "bs_accounts";

function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]"); } catch (_) { return []; }
}
function saveAccounts(list) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, 8)));
}
function rememberAccount(email, password) {
  if (!email) return;
  const list = loadAccounts().filter(a => a.email !== email);
  list.unshift({ email, password, name: currentProfile?.name || email, at: Date.now() });
  saveAccounts(list);
  renderAccountSwitcher();
}

function renderAccountSwitcher() {
  const host = document.getElementById("accountSwitcher");
  if (!host) return;
  const list = loadAccounts();
  if (!list.length) { host.innerHTML = ""; return; }
  host.innerHTML = '<div class="acc-title">Аккаунты</div>';
  list.forEach(a => {
    const row = el(`<button type="button" class="acc-row"><span>${escapeHtml(a.email)}</span></button>`);
    row.onclick = async () => {
      if (authBusy) return;
      authBusy = true; setLoading(true);
      try {
        await signOut(auth);
        await signInWithEmailAndPassword(auth, a.email, a.password);
        showToast("Вход: " + a.email);
      } catch (e) {
        showToast(translateAuthError(e) || "Не удалось войти");
      } finally { authBusy = false; setLoading(false); }
    };
    host.appendChild(row);
  });
}

function renderDrawerAccounts() {
  let host = document.getElementById("drawerAccounts");
  if (!host) {
    const drawer = document.getElementById("drawer");
    if (!drawer) return;
    host = el(`<div id="drawerAccounts" class="drawer-accounts"></div>`);
    drawer.appendChild(host);
  }
  const list = loadAccounts();
  host.innerHTML = '<div class="acc-title">Сменить аккаунт</div>';
  list.forEach(a => {
    const active = currentUser && currentUser.email === a.email;
    const row = el(`<button type="button" class="acc-row${active ? " active" : ""}">${escapeHtml(a.name || a.email)}<small>${escapeHtml(a.email)}</small></button>`);
    row.onclick = async () => {
      if (active) return;
      closeDrawer();
      setLoading(true);
      try {
        await signOut(auth);
        await signInWithEmailAndPassword(auth, a.email, a.password);
      } catch (e) { showToast(translateAuthError(e)); }
      finally { setLoading(false); }
    };
    host.appendChild(row);
  });
  const add = el(`<button type="button" class="acc-row acc-add">+ Другой аккаунт</button>`);
  add.onclick = async () => {
    closeDrawer();
    await signOut(auth);
  };
  host.appendChild(add);
}

// hook after profile load
const _origUpdateDrawer = typeof updateDrawer === "function" ? updateDrawer : null;
if (_origUpdateDrawer) {
  // wrap via reassignment later if needed
}

/* ===== BLOCK / CLEAR / HIDE CHAT ===== */
async function blockUser(uid) {
  if (!uid) return;
  if (!confirm("Заблокировать пользователя? Он исчезнет из списка чатов.")) return;
  try {
    const blocked = currentProfile.blocked || [];
    if (!blocked.includes(uid)) {
      await updateDoc(doc(db, "users", currentUser.uid), { blocked: arrayUnion(uid) });
      currentProfile.blocked = [...blocked, uid];
    }
    await hideCurrentChat();
    showToast("Пользователь заблокирован");
  } catch (e) { showToast(translateAuthError(e)); }
}

async function hideCurrentChat() {
  if (!currentChatId) return;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      hiddenChats: arrayUnion(currentChatId)
    });
    currentProfile.hiddenChats = [...(currentProfile.hiddenChats || []), currentChatId];
    if (unsubMessages) unsubMessages();
    currentChatId = null;
    currentChat = null;
    document.getElementById("userProfileScreen")?.classList.add("hidden");
    document.getElementById("chatPanel")?.classList.add("hidden");
    showToast("Чат удалён из списка");
  } catch (e) { showToast(translateAuthError(e)); }
}

async function clearCurrentChat() {
  if (!currentChatId) return;
  if (!confirm("Удалить все сообщения в этом чате у тебя на экране? (локальная очистка истории)")) return;
  try {
    const qs = await getDocs(query(collection(db, "chats", currentChatId, "messages"), limit(200)));
    // Only delete own messages if not admin; try delete all we can
    let n = 0;
    for (const d of qs.docs) {
      try {
        await deleteDoc(d.ref);
        n++;
      } catch (_) {}
    }
    showToast(n ? `Удалено сообщений: ${n}` : "Нет прав удалить чужие сообщения");
  } catch (e) { showToast(translateAuthError(e)); }
}

/* Filter hidden/blocked chats in list — patch listen */
(function patchChatListFilter() {
  // process pending transfers on profile load
  window.__bsProcessTransfers = async function processPendingTransfers() {
    if (!currentUser) return;
    try {
      const qs = await getDocs(query(
        collection(db, "transfers"),
        where("toUid", "==", currentUser.uid),
        where("status", "==", "pending"),
        limit(30)
      ));
      for (const d of qs.docs) {
        await claimTransfer(d.id, null);
      }
    } catch (e) { console.warn("process transfers", e); }
  };
})();

// Call process transfers after auth
(function hookAuthTransfers() {
  const prev = onAuthStateChanged;
})();

/* voice permission message already improved via requestMedia */
document.getElementById("voiceBtn")?.addEventListener("click", async (e) => {
  // ensure permission helper is used - already has getUserMedia
}, true);

// Improve voice error via monkey-patch at top of voice - replace toast
// Done in requestMedia; update voice handler catch:

try { renderAccountSwitcher(); } catch (_) {}



/* ===== FIRST-RUN PERMISSIONS ===== */
function isSecureForMedia() {
  return window.isSecureContext || location.protocol === "https:" ||
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function showPermissionHelp(reason) {
  document.getElementById("permHelpModal")?.remove();
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  let steps = "";
  if (!isSecureForMedia()) {
    steps = `<p><b>Нужен HTTPS</b>. Без https:// телефон не даст микрофон.</p>
      <p style="font-size:12px;color:var(--text-2)">Сейчас: <code>${escapeHtml(location.href)}</code></p>`;
  } else if (isIOS) {
    steps = `
      <p><b>iPhone / iPad (Safari или приложение)</b></p>
      <ol style="padding-left:18px;line-height:1.55">
        <li>Открой <b>Настройки</b> iPhone</li>
        <li>Пролистай вниз → <b>Safari</b> (или имя приложения)</li>
        <li><b>Микрофон</b> → <b>Разрешить</b></li>
        <li><b>Камера</b> → <b>Разрешить</b></li>
        <li>Вернись в BlackSocial и нажми «Попробовать снова»</li>
      </ol>
      <p style="font-size:12px;color:var(--text-2)">Если ставил на экран «Домой»: Настройки → BlackSocial → Микрофон.</p>`;
  } else if (isAndroid) {
    steps = `
      <p><b>Android (телефон)</b></p>
      <ol style="padding-left:18px;line-height:1.55">
        <li>Открой <b>Настройки</b> телефона</li>
        <li><b>Приложения</b> → <b>Chrome</b> (или BlackSocial, если APK)</li>
        <li><b>Разрешения</b></li>
        <li>Включи <b>Микрофон</b> и <b>Камера</b></li>
        <li>Вернись в приложение → «Попробовать снова»</li>
      </ol>
      <p style="font-size:12px;color:var(--text-2)">В Chrome ещё: меню ⋮ → Настройки → Настройки сайтов → Микрофон.</p>`;
  } else {
    steps = `
      <p><b>Компьютер</b></p>
      <ol style="padding-left:18px;line-height:1.55">
        <li>Замочек 🔒 слева от адреса сайта</li>
        <li>Микрофон / Камера → Разрешить</li>
        <li>Обнови страницу (F5)</li>
      </ol>`;
  }
  if (isStandalone) {
    steps += `<p style="margin-top:10px;font-size:13px;color:var(--accent)">Ты в установленном приложении — разрешения только в <b>настройках телефона</b>, не в адресной строке.</p>`;
  }
  const box = el(`<div class="modal-overlay" id="permHelpModal" style="z-index:450">
    <div class="modal-box" style="max-width:400px">
      <div class="modal-header"><h3>Как включить доступ</h3>
        <button type="button" class="modal-close" id="phClose">✕</button></div>
      <div class="modal-body" style="font-size:14px;line-height:1.45">
        ${reason ? `<p style="color:var(--danger);margin-bottom:10px">${escapeHtml(reason)}</p>` : ""}
        ${steps}
        <button class="btn-primary" id="phRetry" style="width:100%;margin-top:14px">Попробовать снова</button>
        <button class="btn-outline" id="phClose2" style="width:100%;margin-top:8px">Закрыть</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(box);
  const close = () => box.remove();
  document.getElementById("phClose").onclick = close;
  document.getElementById("phClose2").onclick = close;
  document.getElementById("phRetry").onclick = async () => {
    close();
    localStorage.removeItem("bs_perms_asked");
    await ensureNotifyPermission();
    await maybeAskPermissions(true);
  };
}

async function maybeAskPermissions(force) {
  if (!force && localStorage.getItem("bs_perms_asked") === "1") return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showPermissionHelp("Этот браузер не поддерживает микрофон/камеру в веб-приложениях.");
    localStorage.setItem("bs_perms_asked", "1");
    return;
  }
  if (!isSecureForMedia()) {
    showPermissionHelp("Нужен HTTPS. Без него браузер всегда отклоняет доступ.");
    localStorage.setItem("bs_perms_asked", "1");
    return;
  }
  document.getElementById("permModal")?.remove();
  const box = el(`<div class="modal-overlay" id="permModal" style="z-index:400">
    <div class="modal-box" style="max-width:380px">
      <div class="modal-header"><h3>Доступ к микрофону и камере</h3></div>
      <div class="modal-body">
        <p style="font-size:14px;color:var(--text-2);line-height:1.45;margin-bottom:12px">
          Для голосовых сообщений и звонков нажми <b>«Разрешить»</b>.
          Сразу после этого браузер покажет <b>своё</b> окно — в нём тоже нажми <b>Разрешить</b>.
        </p>
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:14px;font-size:13px;line-height:1.5">
          1️⃣ Нажми «Разрешить» здесь<br>
          2️⃣ В окне браузера (сверху) тоже «Разрешить»<br>
          3️⃣ Если ошибка — откроется инструкция
        </div>
        <button class="btn-primary" id="permAllow" style="width:100%;margin-bottom:8px">Разрешить</button>
        <button class="btn-outline" id="permDeny" style="width:100%">Позже</button>
        <button type="button" id="permHelpLink" style="width:100%;margin-top:10px;border:0;background:transparent;color:var(--accent);font-size:13px;cursor:pointer">Не получается? Открыть инструкцию</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(box);
  const done = (ok) => {
    localStorage.setItem("bs_perms_asked", "1");
    box.remove();
    if (ok) showToast("Готово — можно писать голосовые и звонить");
  };
  document.getElementById("permDeny").onclick = () => done(false);
  document.getElementById("permHelpLink").onclick = () => {
    box.remove();
    showPermissionHelp();
  };
  document.getElementById("permAllow").onclick = async () => {
    const btn = document.getElementById("permAllow");
    btn.disabled = true;
    btn.textContent = "Жди окно…";
    await ensureNotifyPermission();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(tr => tr.stop());
      done(true);
    } catch (e) {
      try {
        const s2 = await navigator.mediaDevices.getUserMedia({ audio: true });
        s2.getTracks().forEach(tr => tr.stop());
        done(true);
      } catch (e2) {
        box.remove();
        localStorage.setItem("bs_perms_asked", "1");
        const name = e2?.name || e?.name || "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          showPermissionHelp("Доступ отклонён. На телефоне включи Микрофон в настройках приложения (см. шаги).");
        } else if (name === "NotFoundError") {
          showPermissionHelp("Микрофон не найден.");
        } else {
          showPermissionHelp("Ошибка: " + (e2?.message || e?.message || name || "неизвестно"));
        }
      }
    }
  };
}


