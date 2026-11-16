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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  try {
    await api('/api/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: input.value }) });
    location.replace('/');
  } catch (error) {
    message.textContent = error.message;
    saveButton.disabled = false;
  }
});

$('signOutButton').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.replace('/');
});

async function start() {
  let user;
  try {
    ({ user } = await api('/api/me'));
  } catch {
    // Only a signed-in person picks a nickname.
    location.replace('/');
    return;
  }
  // null means this account has none yet. A set nickname is final, and an absent one
  // means the database predates nicknames; either way there is nothing to do here.
  if (user.nickname !== null) {
    location.replace('/');
    return;
  }
  $('accountEmail').textContent = user.email;
  $('myPage').hidden = false;
  input.focus();
}

start();
