/* ============ BlackSocial — app.js ============ */

let currentUser = null;
let currentProfile = null;
let currentChatId = null;
let currentChat = null;
let unsubMessages = null;
let unsubChats = null;
let allChats = [];

/* ---------- helpers ---------- */
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function fmtDateSep(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function sameDay(a, b) {
  if (!a || !b) return false;
  const da = a.toDate ? a.toDate() : new Date(a);
  const db = b.toDate ? b.toDate() : new Date(b);
  return da.toDateString() === db.toDateString();
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* ---------- AUTH UI ---------- */
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('loginForm').classList.toggle('hidden', target !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', target !== 'register');
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    errBox.textContent = translateAuthError(err);
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const username = document.getElementById('regUsername').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errBox = document.getElementById('registerError');
  errBox.textContent = '';

  if (!username) {
    errBox.textContent = 'Юзернейм: только латиница, цифры и _';
    return;
  }
  if (username.length < 3) {
    errBox.textContent = 'Юзернейм слишком короткий (мин. 3)';
    return;
  }

  try {
    const existing = await db.collection('users').where('username', '==', username).get();
    if (!existing.empty) {
      errBox.textContent = 'Этот юзернейм уже занят';
      return;
    }

    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await db.collection('users').doc(cred.user.uid).set({
      uid: cred.user.uid,
      name,
      username,
      email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    errBox.textContent = translateAuthError(err);
  }
});

function translateAuthError(err) {
  const map = {
    'auth/email-already-in-use': 'Этот email уже зарегистрирован',
    'auth/invalid-email': 'Некорректный email',
    'auth/weak-password': 'Пароль слишком слабый (мин. 6 символов)',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль',
    'auth/invalid-credential': 'Неверный email или пароль',
    'auth/too-many-requests': 'Слишком много попыток. Подождите'
  };
  return map[err.code] || err.message;
}

/* ---------- AUTH STATE ---------- */
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    const doc = await db.collection('users').doc(user.uid).get();
    currentProfile = doc.data();
    if (!currentProfile) {
      await auth.signOut();
      return;
    }

    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    const av = document.getElementById('myAvatar');
    av.textContent = initials(currentProfile.name);
    av.style.background = hashColor(currentProfile.name);
    av.title = currentProfile.name + ' (@' + currentProfile.username + ') — нажмите, чтобы выйти';

    subscribeChats();
  } else {
    currentUser = null;
    currentProfile = null;
    currentChatId = null;
    currentChat = null;
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('app').classList.remove('chat-open');
    if (unsubChats) unsubChats();
    if (unsubMessages) unsubMessages();
  }
});

document.getElementById('myAvatar').addEventListener('click', () => {
  if (confirm('Выйти из аккаунта ' + (currentProfile?.name || '') + '?')) {
    auth.signOut();
  }
});

/* ---------- CHAT LIST ---------- */
function subscribeChats() {
  if (unsubChats) unsubChats();
  unsubChats = db.collection('chats')
    .where('members', 'array-contains', currentUser.uid)
    .onSnapshot(snap => {
      allChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      allChats.sort((a, b) => {
        const ta = a.lastMessageTime ? a.lastMessageTime.toMillis() : 0;
        const tb = b.lastMessageTime ? b.lastMessageTime.toMillis() : 0;
        return tb - ta;
      });
      renderChatList();
    }, err => console.error('chats listener error', err));
}

function renderChatList() {
  const listEl = document.getElementById('chatList');
  const filter = document.getElementById('searchInput').value.trim().toLowerCase();
  listEl.innerHTML = '';

  const filtered = allChats.filter(c => chatDisplayName(c).toLowerCase().includes(filter));

  if (filtered.length === 0) {
    listEl.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--text-2);font-size:14px;">Нет чатов</div>';
    return;
  }

  filtered.forEach(c => {
    const name = chatDisplayName(c);
    let icon = '';
    if (c.type === 'group') icon = '👥 ';
    else if (c.type === 'channel') icon = '📢 ';

    const item = el(`
      <div class="chat-item" data-id="${c.id}">
        <div class="chat-avatar" style="background:${hashColor(name)}">${initials(name)}</div>
        <div class="chat-meta">
          <div class="chat-top-row">
            <div class="chat-name">${escapeHtml(name)}</div>
            <div class="chat-time">${fmtTime(c.lastMessageTime)}</div>
          </div>
          <div class="chat-bottom-row">
            <div class="chat-preview"><span class="chat-type-icon">${icon}</span>${escapeHtml(c.lastMessage || 'Нет сообщений')}</div>
          </div>
        </div>
      </div>`);
    item.addEventListener('click', () => openChat(c.id));
    if (c.id === currentChatId) item.classList.add('active');
    listEl.appendChild(item);
  });
}

document.getElementById('searchInput').addEventListener('input', renderChatList);

function chatDisplayName(chat) {
  if (chat.type === 'private') {
    const otherUid = chat.members.find(m => m !== currentUser.uid);
    return (chat.memberNames && chat.memberNames[otherUid]) || 'Пользователь';
  }
  return chat.name || 'Без названия';
}

/* ---------- OPEN CHAT ---------- */
function openChat(chatId) {
  currentChatId = chatId;
  currentChat = allChats.find(c => c.id === chatId);
  if (!currentChat) return;

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('chatView').classList.remove('hidden');
  document.getElementById('app').classList.add('chat-open');
  renderChatList();

  const name = chatDisplayName(currentChat);
  const hAv = document.getElementById('chatHeaderAvatar');
  hAv.textContent = initials(name);
  hAv.style.background = hashColor(name);
  document.getElementById('chatHeaderName').textContent = name;

  let sub = '';
  if (currentChat.type === 'group') {
    sub = `Группа · ${currentChat.members.length} участн.`;
  } else if (currentChat.type === 'channel') {
    sub = `Канал · ${currentChat.members.length} подписчиков`;
  } else {
    sub = 'личный чат';
  }
  document.getElementById('chatHeaderSub').textContent = sub;

  const isChannel = currentChat.type === 'channel';
  const isAdmin = !isChannel || (currentChat.admins || []).includes(currentUser.uid);
  document.getElementById('composer').classList.toggle('hidden', !isAdmin);
  document.getElementById('composerLocked').classList.toggle('hidden', isAdmin);

  if (unsubMessages) unsubMessages();
  const msgsEl = document.getElementById('messages');
  msgsEl.innerHTML = '';

  unsubMessages = db.collection('chats').doc(chatId).collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      msgsEl.innerHTML = '';
      let lastTs = null;

      snap.forEach(doc => {
        const m = doc.data();
        if (!sameDay(lastTs, m.timestamp)) {
          const sep = el(`<div class="date-sep">${fmtDateSep(m.timestamp)}</div>`);
          msgsEl.appendChild(sep);
        }
        lastTs = m.timestamp;

        const own = m.senderId === currentUser.uid;
        const showSender = !own && currentChat.type !== 'private';

        const row = el(`
          <div class="msg-row ${own ? 'own' : 'other'}">
            ${showSender ? `<div class="msg-sender">${escapeHtml(m.senderName)}</div>` : ''}
            <div class="msg-bubble">${escapeHtml(m.text)}</div>
            <div class="msg-meta"><span class="msg-time">${fmtTime(m.timestamp)}</span></div>
          </div>`);
        msgsEl.appendChild(row);
      });

      msgsEl.scrollTop = msgsEl.scrollHeight;
    }, err => console.error('messages listener error', err));
}

document.getElementById('backBtn').addEventListener('click', () => {
  currentChatId = null;
  currentChat = null;
  document.getElementById('chatView').classList.add('hidden');
  document.getElementById('emptyState').classList.remove('hidden');
  document.getElementById('app').classList.remove('chat-open');
  if (unsubMessages) {
    unsubMessages();
    unsubMessages = null;
  }
  renderChatList();
});

/* ---------- SEND MESSAGE ---------- */
async function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !currentChatId) return;

  input.value = '';
  input.focus();

  try {
    const chatRef = db.collection('chats').doc(currentChatId);
    await chatRef.collection('messages').add({
      senderId: currentUser.uid,
      senderName: currentProfile.name,
      text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    await chatRef.update({
      lastMessage: text.length > 80 ? text.slice(0, 80) + '…' : text,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('send error', err);
    alert('Не удалось отправить сообщение');
  }
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* ---------- NEW CHAT MODAL ---------- */
const modal = document.getElementById('newChatModal');

document.querySelector('.rail-btn[data-view="new"]').addEventListener('click', () => {
  modal.classList.remove('hidden');
  // reset to private tab
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.modal-tab[data-mtab="private"]').classList.add('active');
  document.querySelectorAll('.modal-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById('pane-private').classList.remove('hidden');
});

document.getElementById('closeModal').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.add('hidden');
});

document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.modal-pane').forEach(p => p.classList.add('hidden'));
    document.getElementById('pane-' + tab.dataset.mtab).classList.remove('hidden');
  });
});

/* --- private chat: search users --- */
let userSearchTimeout;

document.getElementById('userSearch').addEventListener('input', (e) => {
  clearTimeout(userSearchTimeout);
  const val = e.target.value.trim().toLowerCase();
  userSearchTimeout = setTimeout(() => searchUsers(val, 'userSearchResults', async (user) => {
    modal.classList.add('hidden');
    document.getElementById('userSearch').value = '';
    document.getElementById('userSearchResults').innerHTML = '';
    await startPrivateChat(user);
  }), 280);
});

async function searchUsers(term, resultsElId, onPick) {
  const resultsEl = document.getElementById(resultsElId);
  resultsEl.innerHTML = '';
  if (!term || term.length < 1) return;

  try {
    const snap = await db.collection('users')
      .where('username', '>=', term)
      .where('username', '<=', term + '\uf8ff')
      .limit(12)
      .get();

    if (snap.empty) {
      resultsEl.innerHTML = '<div style="padding:12px;color:var(--text-2);font-size:13px;text-align:center;">Никого не найдено</div>';
      return;
    }

    snap.forEach(doc => {
      const u = doc.data();
      if (u.uid === currentUser.uid) return;
      const item = el(`
        <div class="search-result-item">
          <div class="sr-avatar" style="background:${hashColor(u.name)}">${initials(u.name)}</div>
          <div>
            <div class="sr-name">${escapeHtml(u.name)}</div>
            <div class="sr-username">@${escapeHtml(u.username)}</div>
          </div>
        </div>`);
      item.addEventListener('click', () => onPick(u));
      resultsEl.appendChild(item);
    });
  } catch (err) {
    console.error('search error', err);
    resultsEl.innerHTML = '<div style="padding:12px;color:var(--danger);font-size:13px;">Ошибка поиска</div>';
  }
}

async function startPrivateChat(otherUser) {
  const uid1 = currentUser.uid;
  const uid2 = otherUser.uid;
  const chatId = [uid1, uid2].sort().join('_');
  const chatRef = db.collection('chats').doc(chatId);
  const doc = await chatRef.get();

  if (!doc.exists) {
    await chatRef.set({
      type: 'private',
      members: [uid1, uid2],
      memberNames: {
        [uid1]: currentProfile.name,
        [uid2]: otherUser.name
      },
      lastMessage: '',
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  openChat(chatId);
}

/* --- group chat --- */
let groupSelectedUsers = {};

document.getElementById('groupUserSearch').addEventListener('input', (e) => {
  clearTimeout(userSearchTimeout);
  const val = e.target.value.trim().toLowerCase();
  userSearchTimeout = setTimeout(() => searchUsers(val, 'groupSearchResults', (user) => {
    groupSelectedUsers[user.uid] = user;
    renderGroupChips();
    document.getElementById('groupUserSearch').value = '';
    document.getElementById('groupSearchResults').innerHTML = '';
  }), 280);
});

function renderGroupChips() {
  const chipsEl = document.getElementById('groupSelected');
  chipsEl.innerHTML = '';
  Object.values(groupSelectedUsers).forEach(u => {
    const chip = el(`<div class="chip">${escapeHtml(u.name)} <button type="button">✕</button></div>`);
    chip.querySelector('button').addEventListener('click', () => {
      delete groupSelectedUsers[u.uid];
      renderGroupChips();
    });
    chipsEl.appendChild(chip);
  });
}

document.getElementById('createGroupBtn').addEventListener('click', async () => {
  const name = document.getElementById('groupName').value.trim();
  if (!name) {
    alert('Введите название группы');
    return;
  }
  const memberIds = [currentUser.uid, ...Object.keys(groupSelectedUsers)];
  if (memberIds.length < 2) {
    alert('Добавьте хотя бы одного участника');
    return;
  }

  try {
    const ref = await db.collection('chats').add({
      type: 'group',
      name,
      members: memberIds,
      admins: [currentUser.uid],
      lastMessage: `${currentProfile.name} создал(а) группу`,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('groupName').value = '';
    groupSelectedUsers = {};
    renderGroupChips();
    modal.classList.add('hidden');
    openChat(ref.id);
  } catch (err) {
    console.error(err);
    alert('Ошибка создания группы');
  }
});

/* --- channel --- */
document.getElementById('createChannelBtn').addEventListener('click', async () => {
  const name = document.getElementById('channelName').value.trim();
  const desc = document.getElementById('channelDesc').value.trim();
  if (!name) {
    alert('Введите название канала');
    return;
  }

  try {
    const ref = await db.collection('chats').add({
      type: 'channel',
      name,
      description: desc,
      members: [currentUser.uid],
      admins: [currentUser.uid],
      lastMessage: `Канал «${name}» создан`,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('channelName').value = '';
    document.getElementById('channelDesc').value = '';
    modal.classList.add('hidden');
    openChat(ref.id);
  } catch (err) {
    console.error(err);
    alert('Ошибка создания канала');
  }
});
