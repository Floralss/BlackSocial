import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBGFONUBgybQr0KCn_Ao_ZT9HkWVSU4jEw",
  authDomain: "black-social-af844.firebaseapp.com",
  projectId: "black-social-af844",
  storageBucket: "black-social-af844.firebasestorage.app",
  messagingSenderId: "296441938682",
  appId: "1:296441938682:web:096a3e642bd00116f7bf43",
  measurementId: "G-2PX2QMR8HS"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "default");
const storage = getStorage(app);

let currentUser = null;
let currentProfile = null;
let currentChatId = null;
let currentChat = null;
let unsubMessages = null;
let unsubChats = null;
let allChats = [];
let pendingFiles = [];
let authBusy = false;

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_IMAGES = 5;

/* helpers */
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
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
function fmtDateSep(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Сегодня";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric", month: "long",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined
  });
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
function showToast(text, ms = 3000) {
  const existing = document.querySelector(".upload-toast");
  if (existing) existing.remove();
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
  } else if (ov) ov.remove();
}
function translateAuthError(err) {
  const code = err && err.code ? err.code : "";
  const map = {
    "auth/email-already-in-use": "Этот email уже зарегистрирован",
    "auth/invalid-email": "Некорректный email",
    "auth/weak-password": "Пароль слишком слабый (мин. 6)",
    "auth/user-not-found": "Пользователь не найден",
    "auth/wrong-password": "Неверный пароль",
    "auth/invalid-credential": "Неверный email или пароль",
    "auth/invalid-login-credentials": "Неверный email или пароль. Нет аккаунта? Регистрация",
    "auth/too-many-requests": "Слишком много попыток",
    "auth/network-request-failed": "Сеть / домен не в Authorized domains",
    "auth/operation-not-allowed": "Email/Password не включён",
    "permission-denied": "Нет доступа. Проверь Firestore Rules"
  };
  return map[code] || (err && err.message) || String(err);
}

function setAvatarEl(el, profile) {
  if (!el || !profile) return;
  el.innerHTML = "";
  el.style.background = hashColor(profile.name);
  if (profile.avatarUrl) {
    const img = document.createElement("img");
    img.src = profile.avatarUrl;
    img.alt = "";
    el.appendChild(img);
  } else {
    el.textContent = initials(profile.name);
  }
}

/* AUTH */
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    document.getElementById("loginForm").classList.toggle("hidden", target !== "login");
    document.getElementById("registerForm").classList.toggle("hidden", target !== "register");
  });
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (authBusy) return;
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errBox = document.getElementById("loginError");
  errBox.textContent = "";
  authBusy = true;
  setLoading(true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    errBox.textContent = translateAuthError(err);
  } finally {
    authBusy = false;
    setLoading(false);
  }
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
  if (!name) { errBox.textContent = "Введите имя"; return; }
  if (!username || username.length < 3) {
    errBox.textContent = "Юзернейм: латиница, мин. 3";
    return;
  }
  authBusy = true;
  setLoading(true);
  let createdUid = null;
  try {
    const existing = await getDocs(query(collection(db, "users"), where("username", "==", username), limit(1)));
    if (!existing.empty) { errBox.textContent = "Юзернейм занят"; return; }
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    createdUid = cred.user.uid;
    await setDoc(doc(db, "users", createdUid), {
      uid: createdUid, name, username, email, avatarUrl: "",
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    errBox.textContent = translateAuthError(err);
    if (createdUid) try { await signOut(auth); } catch (_) {}
  } finally {
    authBusy = false;
    setLoading(false);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    setLoading(true);
    try {
      currentUser = user;
      let snap = await getDoc(doc(db, "users", user.uid));
      currentProfile = snap.exists() ? snap.data() : null;
      if (!currentProfile) {
        const fallbackName = (user.email || "User").split("@")[0];
        const fallbackUser = ("u" + user.uid.slice(0, 8)).toLowerCase();
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid, name: fallbackName, username: fallbackUser,
          email: user.email || "", avatarUrl: "", createdAt: serverTimestamp()
        });
        snap = await getDoc(doc(db, "users", user.uid));
        currentProfile = snap.data();
      }
      document.getElementById("authScreen").classList.add("hidden");
      document.getElementById("app").classList.remove("hidden");
      updateDrawerProfile();
      subscribeChats();
    } catch (e) {
      console.error(e);
      showToast(translateAuthError(e));
      await signOut(auth);
    } finally {
      setLoading(false);
    }
  } else {
    currentUser = null;
    currentProfile = null;
    currentChatId = null;
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
    document.getElementById("app").classList.remove("chat-open");
    closeDrawer();
    if (unsubChats) unsubChats();
    if (unsubMessages) unsubMessages();
  }
});

/* DRAWER */
function openDrawer() {
  document.getElementById("drawer").classList.add("open");
  document.getElementById("drawerOverlay").classList.add("open");
  updateDrawerProfile();
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawerOverlay").classList.remove("open");
}
function updateDrawerProfile() {
  if (!currentProfile) return;
  setAvatarEl(document.getElementById("drawerAvatar"), currentProfile);
  document.getElementById("drawerName").textContent = currentProfile.name;
  document.getElementById("drawerUsername").textContent = "@" + currentProfile.username;
}

document.getElementById("menuBtn").addEventListener("click", openDrawer);
document.getElementById("drawerOverlay").addEventListener("click", closeDrawer);

document.getElementById("menuProfile").addEventListener("click", () => {
  closeDrawer();
  openProfile();
});
document.getElementById("menuSettings").addEventListener("click", () => {
  closeDrawer();
  openProfile();
});
document.getElementById("menuNewChat").addEventListener("click", () => {
  closeDrawer();
  openModal("private");
});
document.getElementById("menuNewGroup").addEventListener("click", () => {
  closeDrawer();
  openModal("group");
});
document.getElementById("menuNewChannel").addEventListener("click", () => {
  closeDrawer();
  openModal("channel");
});
document.getElementById("menuLogout").addEventListener("click", async () => {
  closeDrawer();
  if (confirm("Выйти из аккаунта?")) await signOut(auth);
});

/* PROFILE EDIT */
function openProfile() {
  if (!currentProfile) return;
  document.getElementById("profileScreen").classList.remove("hidden");
  setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
  document.getElementById("editName").value = currentProfile.name || "";
  document.getElementById("editUsername").value = currentProfile.username || "";
  document.getElementById("editEmail").value = currentProfile.email || "";
}
function closeProfile() {
  document.getElementById("profileScreen").classList.add("hidden");
}
document.getElementById("closeProfile").addEventListener("click", closeProfile);

document.getElementById("changeAvatarBtn").addEventListener("click", () => {
  document.getElementById("avatarInput").click();
});
document.getElementById("avatarInput").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("Только изображения"); return; }
  if (file.size > MAX_IMAGE_SIZE) { showToast("Макс. 8 МБ"); return; }
  setLoading(true);
  try {
    const path = `avatars/${currentUser.uid}_${Date.now()}.jpg`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, { contentType: file.type });
    const url = await getDownloadURL(storageRef);
    await updateDoc(doc(db, "users", currentUser.uid), { avatarUrl: url });
    currentProfile.avatarUrl = url;
    setAvatarEl(document.getElementById("profileAvatarBig"), currentProfile);
    updateDrawerProfile();
    showToast("Аватар обновлён");
  } catch (err) {
    console.error(err);
    showToast("Ошибка аватара: " + translateAuthError(err));
  } finally {
    setLoading(false);
  }
});

document.getElementById("saveProfileBtn").addEventListener("click", async () => {
  const name = document.getElementById("editName").value.trim();
  let username = document.getElementById("editUsername").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!name) { showToast("Введите имя"); return; }
  if (!username || username.length < 3) { showToast("Юзернейм мин. 3 символа"); return; }
  setLoading(true);
  try {
    if (username !== currentProfile.username) {
      const existing = await getDocs(query(collection(db, "users"), where("username", "==", username), limit(1)));
      if (!existing.empty) { showToast("Юзернейм занят"); return; }
    }
    await updateDoc(doc(db, "users", currentUser.uid), { name, username });
    currentProfile.name = name;
    currentProfile.username = username;
    updateDrawerProfile();
    showToast("Сохранено");
  } catch (err) {
    showToast(translateAuthError(err));
  } finally {
    setLoading(false);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (confirm("Выйти?")) {
    closeProfile();
    await signOut(auth);
  }
});

/* CHATS */
function subscribeChats() {
  if (unsubChats) unsubChats();
  const q = query(collection(db, "chats"), where("members", "array-contains", currentUser.uid));
  unsubChats = onSnapshot(q, snap => {
    allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allChats.sort((a, b) => {
      const ta = a.lastMessageTime ? a.lastMessageTime.toMillis() : 0;
      const tb = b.lastMessageTime ? b.lastMessageTime.toMillis() : 0;
      return tb - ta;
    });
    renderChatList();
  }, err => showToast("Ошибка чатов: " + translateAuthError(err)));
}

function renderChatList() {
  const listEl = document.getElementById("chatList");
  const filter = document.getElementById("searchInput").value.trim().toLowerCase();
  listEl.innerHTML = "";
  const filtered = allChats.filter(c => chatDisplayName(c).toLowerCase().includes(filter));
  if (!filtered.length) {
    listEl.innerHTML = '<div class="search-empty">Нет чатов. Меню → Новый чат</div>';
    return;
  }
  filtered.forEach(c => {
    const name = chatDisplayName(c);
    const icon = c.type === "group" ? "👥 " : c.type === "channel" ? "📢 " : "";
    const preview = c.lastMessage || "Нет сообщений";
    const item = el(`
      <div class="chat-item" data-id="${c.id}">
        <div class="chat-avatar" style="background:${hashColor(name)}">${initials(name)}</div>
        <div class="chat-meta">
          <div class="chat-top-row">
            <div class="chat-name">${escapeHtml(name)}</div>
            <div class="chat-time">${fmtTime(c.lastMessageTime)}</div>
          </div>
          <div class="chat-bottom-row">
            <div class="chat-preview"><span class="chat-type-icon">${icon}</span>${escapeHtml(preview)}</div>
          </div>
        </div>
      </div>`);
    item.addEventListener("click", () => openChat(c.id));
    if (c.id === currentChatId) item.classList.add("active");
    listEl.appendChild(item);
  });
}
document.getElementById("searchInput").addEventListener("input", renderChatList);

function chatDisplayName(chat) {
  if (chat.type === "private") {
    const otherUid = chat.members.find(m => m !== currentUser.uid);
    return (chat.memberNames && chat.memberNames[otherUid]) || "Пользователь";
  }
  return chat.name || "Без названия";
}

function openChat(chatId) {
  currentChatId = chatId;
  currentChat = allChats.find(c => c.id === chatId);
  if (!currentChat) return;
  pendingFiles = [];
  renderPreviewBar();
  closeProfile();

  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("chatView").classList.remove("hidden");
  document.getElementById("app").classList.add("chat-open");
  renderChatList();

  const name = chatDisplayName(currentChat);
  const hAv = document.getElementById("chatHeaderAvatar");
  hAv.style.background = hashColor(name);
  hAv.textContent = initials(name);
  document.getElementById("chatHeaderName").textContent = name;

  let sub = "личный чат";
  if (currentChat.type === "group") sub = `Группа · ${currentChat.members.length}`;
  else if (currentChat.type === "channel") sub = `Канал · ${currentChat.members.length}`;
  document.getElementById("chatHeaderSub").textContent = sub;

  const isChannel = currentChat.type === "channel";
  const isAdmin = !isChannel || (currentChat.admins || []).includes(currentUser.uid);
  document.getElementById("composer").classList.toggle("hidden", !isAdmin);
  document.getElementById("composerLocked").classList.toggle("hidden", isAdmin);

  if (unsubMessages) unsubMessages();
  const msgsEl = document.getElementById("messages");
  msgsEl.innerHTML = "";
  const mq = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubMessages = onSnapshot(mq, snap => {
    msgsEl.innerHTML = "";
    let lastTs = null;
    snap.forEach(docSnap => {
      const m = docSnap.data();
      if (!sameDay(lastTs, m.timestamp)) {
        msgsEl.appendChild(el(`<div class="date-sep">${fmtDateSep(m.timestamp)}</div>`));
      }
      lastTs = m.timestamp;
      const own = m.senderId === currentUser.uid;
      const showSender = !own && currentChat.type !== "private";
      const hasImage = !!m.imageUrl;
      const hasText = !!(m.text && m.text.trim());
      let bubbleInner = "";
      if (hasImage) bubbleInner += `<img class="msg-img" src="${escapeHtml(m.imageUrl)}" alt="" loading="lazy">`;
      if (hasText) bubbleInner += `<div class="msg-text">${escapeHtml(m.text)}</div>`;
      if (!hasImage && !hasText) bubbleInner = '<div class="msg-text">(пусто)</div>';
      const row = el(`
        <div class="msg-row ${own ? "own" : "other"}">
          ${showSender ? `<div class="msg-sender">${escapeHtml(m.senderName)}</div>` : ""}
          <div class="msg-bubble ${hasImage ? "has-image" : ""}">${bubbleInner}</div>
          <div class="msg-meta"><span class="msg-time">${fmtTime(m.timestamp)}</span></div>
        </div>`);
      if (hasImage) row.querySelector(".msg-img").addEventListener("click", () => openLightbox(m.imageUrl));
      msgsEl.appendChild(row);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }, err => showToast(translateAuthError(err)));
}

document.getElementById("backBtn").addEventListener("click", () => {
  currentChatId = null;
  currentChat = null;
  pendingFiles = [];
  renderPreviewBar();
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
document.getElementById("lightboxClose").addEventListener("click", () => {
  document.getElementById("lightbox").classList.add("hidden");
  document.getElementById("lightboxImg").src = "";
});
document.getElementById("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") {
    document.getElementById("lightbox").classList.add("hidden");
    document.getElementById("lightboxImg").src = "";
  }
});

/* SEND */
document.getElementById("attachBtn").addEventListener("click", () => document.getElementById("fileInput").click());
document.getElementById("fileInput").addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  for (const f of files) {
    if (!f.type.startsWith("image/")) { showToast("Только изображения"); continue; }
    if (f.size > MAX_IMAGE_SIZE) { showToast("Макс. 8 МБ"); continue; }
    if (pendingFiles.length >= MAX_IMAGES) { showToast("Макс. 5 фото"); break; }
    pendingFiles.push(f);
  }
  renderPreviewBar();
});
function renderPreviewBar() {
  const bar = document.getElementById("previewBar");
  bar.innerHTML = "";
  if (!pendingFiles.length) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  pendingFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const item = el(`<div class="preview-item"><img src="${url}" alt=""><button type="button" class="preview-rm">✕</button></div>`);
    item.querySelector(".preview-rm").addEventListener("click", () => {
      pendingFiles.splice(idx, 1);
      renderPreviewBar();
    });
    bar.appendChild(item);
  });
}

async function uploadImage(file, chatId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `chats/${chatId}/${currentUser.uid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return await getDownloadURL(storageRef);
}

async function sendMessage() {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  const files = [...pendingFiles];
  if ((!text && !files.length) || !currentChatId) return;
  input.value = "";
  pendingFiles = [];
  renderPreviewBar();
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;
  try {
    const chatRef = doc(db, "chats", currentChatId);
    if (files.length) showToast("Загрузка…");
    for (let i = 0; i < files.length; i++) {
      const imageUrl = await uploadImage(files[i], currentChatId);
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
    if (lastPreview && lastPreview.length > 80) lastPreview = lastPreview.slice(0, 80) + "…";
    await updateDoc(chatRef, {
      lastMessage: lastPreview || "📷 Фото",
      lastMessageTime: serverTimestamp()
    });
  } catch (err) {
    showToast("Ошибка: " + translateAuthError(err));
  } finally {
    sendBtn.disabled = false;
  }
}
document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("msgInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

/* MODAL */
const modal = document.getElementById("newChatModal");
function openModal(tab) {
  modal.classList.remove("hidden");
  document.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`.modal-tab[data-mtab="${tab}"]`).classList.add("active");
  document.querySelectorAll(".modal-pane").forEach(p => p.classList.add("hidden"));
  document.getElementById("pane-" + tab).classList.remove("hidden");
}
document.getElementById("closeModal").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
document.querySelectorAll(".modal-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".modal-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".modal-pane").forEach(p => p.classList.add("hidden"));
    document.getElementById("pane-" + tab.dataset.mtab).classList.remove("hidden");
  });
});

let userSearchTimeout;
document.getElementById("userSearch").addEventListener("input", (e) => {
  clearTimeout(userSearchTimeout);
  const val = e.target.value.trim().toLowerCase().replace(/^@/, "");
  userSearchTimeout = setTimeout(() => searchUsers(val, "userSearchResults", async (user) => {
    modal.classList.add("hidden");
    document.getElementById("userSearch").value = "";
    document.getElementById("userSearchResults").innerHTML = "";
    await startPrivateChat(user);
  }), 250);
});

async function searchUsers(term, resultsElId, onPick) {
  const resultsEl = document.getElementById(resultsElId);
  resultsEl.innerHTML = "";
  if (!term) {
    resultsEl.innerHTML = '<div class="search-empty">Введите юзернейм</div>';
    return;
  }
  resultsEl.innerHTML = '<div class="search-empty">Поиск…</div>';
  try {
    const q = query(
      collection(db, "users"),
      where("username", ">=", term),
      where("username", "<=", term + "\uf8ff"),
      limit(15)
    );
    const snap = await getDocs(q);
    resultsEl.innerHTML = "";
    let count = 0;
    snap.forEach(docSnap => {
      const u = docSnap.data();
      if (u.uid === currentUser.uid) return;
      count++;
      const item = el(`
        <div class="search-result-item">
          <div class="sr-avatar" style="background:${hashColor(u.name)}">${initials(u.name)}</div>
          <div>
            <div class="sr-name">${escapeHtml(u.name)}</div>
            <div class="sr-username">@${escapeHtml(u.username)}</div>
          </div>
        </div>`);
      item.addEventListener("click", () => onPick(u));
      resultsEl.appendChild(item);
    });
    if (!count) resultsEl.innerHTML = '<div class="search-empty">Никого не найдено</div>';
  } catch (err) {
    resultsEl.innerHTML = `<div class="search-empty" style="color:var(--danger)">${escapeHtml(translateAuthError(err))}</div>`;
  }
}

async function startPrivateChat(otherUser) {
  const uid1 = currentUser.uid, uid2 = otherUser.uid;
  const chatId = [uid1, uid2].sort().join("_");
  const chatRef = doc(db, "chats", chatId);
  try {
    const existing = await getDoc(chatRef);
    if (!existing.exists()) {
      await setDoc(chatRef, {
        type: "private",
        members: [uid1, uid2],
        memberNames: { [uid1]: currentProfile.name, [uid2]: otherUser.name },
        lastMessage: "",
        lastMessageTime: serverTimestamp()
      });
    }
    openChat(chatId);
  } catch (err) {
    showToast(translateAuthError(err));
  }
}

let groupSelectedUsers = {};
document.getElementById("groupUserSearch").addEventListener("input", (e) => {
  clearTimeout(userSearchTimeout);
  const val = e.target.value.trim().toLowerCase().replace(/^@/, "");
  userSearchTimeout = setTimeout(() => searchUsers(val, "groupSearchResults", (user) => {
    groupSelectedUsers[user.uid] = user;
    renderGroupChips();
    document.getElementById("groupUserSearch").value = "";
    document.getElementById("groupSearchResults").innerHTML = "";
  }), 250);
});
function renderGroupChips() {
  const chipsEl = document.getElementById("groupSelected");
  chipsEl.innerHTML = "";
  Object.values(groupSelectedUsers).forEach(u => {
    const chip = el(`<div class="chip">${escapeHtml(u.name)} <button type="button">✕</button></div>`);
    chip.querySelector("button").addEventListener("click", () => {
      delete groupSelectedUsers[u.uid];
      renderGroupChips();
    });
    chipsEl.appendChild(chip);
  });
}
document.getElementById("createGroupBtn").addEventListener("click", async () => {
  const name = document.getElementById("groupName").value.trim();
  if (!name) { showToast("Название группы"); return; }
  const memberIds = [currentUser.uid, ...Object.keys(groupSelectedUsers)];
  if (memberIds.length < 2) { showToast("Добавьте участника"); return; }
  setLoading(true);
  try {
    const refDoc = await addDoc(collection(db, "chats"), {
      type: "group", name, members: memberIds, admins: [currentUser.uid],
      lastMessage: `${currentProfile.name} создал(а) группу`,
      lastMessageTime: serverTimestamp()
    });
    document.getElementById("groupName").value = "";
    groupSelectedUsers = {};
    renderGroupChips();
    modal.classList.add("hidden");
    openChat(refDoc.id);
  } catch (err) {
    showToast(translateAuthError(err));
  } finally { setLoading(false); }
});

document.getElementById("createChannelBtn").addEventListener("click", async () => {
  const name = document.getElementById("channelName").value.trim();
  const desc = document.getElementById("channelDesc").value.trim();
  if (!name) { showToast("Название канала"); return; }
  setLoading(true);
  try {
    const refDoc = await addDoc(collection(db, "chats"), {
      type: "channel", name, description: desc,
      members: [currentUser.uid], admins: [currentUser.uid],
      lastMessage: `Канал «${name}» создан`,
      lastMessageTime: serverTimestamp()
    });
    document.getElementById("channelName").value = "";
    document.getElementById("channelDesc").value = "";
    modal.classList.add("hidden");
    openChat(refDoc.id);
  } catch (err) {
    showToast(translateAuthError(err));
  } finally { setLoading(false); }
});
