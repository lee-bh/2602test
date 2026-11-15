const $ = (id) => document.getElementById(id);
const api = async (path, options = {}) => {
  const response = await fetch(path, options);
  if (!response.ok) {
    const error = new Error((await response.json().catch(() => ({}))).error || '요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
};

const form = $('nicknameForm');
const input = $('nicknameInput');
const saveButton = $('nicknameSave');
const message = $('nicknameMessage');
// Sent here straight after the first sign-in: saving takes them on to the feed.
const setup = new URLSearchParams(location.search).has('setup');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  try {
    const { nickname } = await api('/api/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: input.value }) });
    input.value = nickname;
    if (setup) { location.replace('/'); return; }
    message.textContent = '닉네임을 바꿨습니다.';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

$('homeButton').addEventListener('click', () => { location.href = '/'; });
$('signOutButton').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.replace('/');
});

async function start() {
  let user;
  try {
    ({ user } = await api('/api/me'));
  } catch {
    // Only a signed-in person has a page here.
    location.replace('/');
    return;
  }
  if (!('nickname' in user)) {
    // The database has not been given nicknames yet; nothing here can be saved.
    input.disabled = saveButton.disabled = true;
    message.textContent = '닉네임 기능을 준비하고 있습니다.';
  }
  input.value = user.nickname || '';
  $('accountEmail').textContent = user.email;
  $('setupNotice').hidden = user.nickname !== null;
  // Until a nickname exists there is nothing to go back to.
  $('homeButton').hidden = user.nickname === null;
  $('myPage').hidden = false;
  input.focus();
}

start();
