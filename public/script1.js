const socket = io();

let currentRoom = null;
let mySocketId = null;
let isLeader = false;
let myNickname = null;

const loginDiv = document.getElementById('login');
const chatDiv = document.getElementById('chat');
const joinBtn = document.getElementById('join-btn');
const loginError = document.getElementById('login-error');
const onlineUsersSpan = document.getElementById('online-users');
const messagesDiv = document.getElementById('messages');
const sendBtn = document.getElementById('send-btn');
const msgInput = document.getElementById('message-input');
const leaderInfoSpan = document.getElementById('leader-info');

const changePasswordBtn = document.getElementById('change-password-btn');
const newPasswordInput = document.getElementById('new-password');
const confirmChangePasswordBtn = document.getElementById('confirm-change-password');

const changeNicknameBtn = document.getElementById('change-nickname-btn');
const nicknameInput = document.getElementById('nickname-input');
const nicknameConfirmBtn = document.getElementById('nickname-confirm-btn');

joinBtn.onclick = () => {
  const room = document.getElementById('room-name').value.trim();
  const password = document.getElementById('room-password').value.trim();
  const nickname = document.getElementById('nickname').value.trim();
  if (!room || !password || !nickname) {
    loginError.textContent = 'Please fill all fields';
    return;
  }
  socket.emit('joinRoom', {room, password, nickname}, (res) => {
    if (!res.ok) {
      loginError.textContent = res.error;
    } else {
      loginDiv.style.display = 'none';
      chatDiv.style.display = 'block';
      currentRoom = room;
      myNickname = nickname;
      isLeader = res.isLeader;
      mySocketId = socket.id;
      leaderInfoSpan.textContent = isLeader ? 'You are Leader' : 'Leader: Waiting...';
      changePasswordBtn.style.display = isLeader ? 'inline-block' : 'none';
      renderMessages(res.messages || []);
      loginError.textContent = '';
    }
  });
};

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (text === '') return;
  socket.emit('newMessage', {room: currentRoom, text});
  msgInput.value = '';
};

changePasswordBtn.onclick = () => {
  newPasswordInput.style.display = 'inline-block';
  confirmChangePasswordBtn.style.display = 'inline-block';
};

confirmChangePasswordBtn.onclick = () => {
  const newPass = newPasswordInput.value.trim();
  if (!newPass) return alert('Enter new password');
  socket.emit('changePassword', {room: currentRoom, newPassword: newPass});
  newPasswordInput.style.display = 'none';
  confirmChangePasswordBtn.style.display = 'none';
  newPasswordInput.value = '';
  alert('Password changed');
};

changeNicknameBtn.onclick = () => {
  nicknameInput.style.display = 'inline-block';
  nicknameConfirmBtn.style.display = 'inline-block';
  nicknameInput.value = myNickname;
};

nicknameConfirmBtn.onclick = () => {
  const newNick = nicknameInput.value.trim();
  if (!newNick) return alert('Enter new nickname');
  socket.emit('changeNickname', {room: currentRoom, newNick});
  myNickname = newNick;
  nicknameInput.style.display = 'none';
  nicknameConfirmBtn.style.display = 'none';
};

// メッセージを描画
function renderMessages(messages) {
  messagesDiv.innerHTML = '';
  messages.forEach(addMessage);
  scrollMessagesToBottom();
}

// メッセージ1つ追加
function addMessage(msg) {
  const div = document.createElement('div');
  div.className = 'message';
  div.id = msg.id;

  const content = document.createElement('span');
  content.textContent = `[${new Date(msg.ts).toLocaleTimeString()}] ${msg.nickname}: ${msg.text}`;
  div.appendChild(content);

  const readCountSpan = document.createElement('span');
  readCountSpan.className = 'read-count';
  readCountSpan.textContent = `Read: ${msg.readBy.length}`;
  div.appendChild(readCountSpan);

  // 自分のメッセージなら削除ボタン表示
  if (msg.userId === mySocketId) {
    const delBtn = document.createElement('span');
    delBtn.textContent = '×';
    delBtn.className = 'delete-btn';
    delBtn.title = 'Delete message';
    delBtn.onclick = () => {
      socket.emit('deleteMessage', {room: currentRoom, messageId: msg.id});
    };
    div.appendChild(delBtn);
  }

  messagesDiv.appendChild(div);
}

// メッセージ削除処理
socket.on('deleteMessage', ({messageId}) => {
  const elem = document.getElementById(messageId);
  if (elem) elem.remove();
});

// 新着メッセージ
socket.on('newMessage', msg => {
  addMessage(msg);
  scrollMessagesToBottom();
});

// ニックネーム変更反映
socket.on('updateNickname', ({userId, newNick}) => {
  // メッセージの中でnicknameを変更する
  const msgs = messagesDiv.querySelectorAll('.message');
  msgs.forEach(m => {
    if (m.id) {
      // ここは単純に再取得しませんが必要なら拡張可
      // 省略のためこのままに
    }
  });
  if (userId === mySocketId) {
    myNickname = newNick;
  }
});

// 既読情報更新
socket.on('updateRead', ({messageId, readCount}) => {
  const elem = document.getElementById(messageId);
  if (elem) {
    const readCountSpan = elem.querySelector('.read-count');
    if (readCountSpan) readCountSpan.textContent = `Read: ${readCount}`;
  }
});

// オンラインユーザー更新
socket.on('onlineUsers', (users) => {
  onlineUsersSpan.textContent = users.join(', ');
});

// リーダー情報更新
socket.on('leader', (leaderId) => {
  isLeader = (leaderId === mySocketId);
  leaderInfoSpan.textContent = isLeader ? 'You are Leader' : 'Leader: ' + leaderId;
  changePasswordBtn.style.display = isLeader ? 'inline-block' : 'none';
});

// 既読通知を送る (Intersection Observerでメッセージが見えたとき)
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const messageId = entry.target.id;
      socket.emit('messageRead', {room: currentRoom, messageId});
    }
  });
}, {root: messagesDiv, threshold: 1.0});

const scrollMessagesToBottom = () => {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// メッセージ表示時にobserve登録
function observeNewMessage(msgId) {
  const el = document.getElementById(msgId);
  if (el) {
    observer.observe(el);
  }
}

// メッセージ追加後にobserve
const originalAddMessage = addMessage;
addMessage = (msg) => {
  originalAddMessage(msg);
  observeNewMessage(msg.id);
};
