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
// Uploads live in the body as ![name](/api/images/<id>); the list shows them as pictures
// and keeps the markdown itself out of the text.
const IMAGE_MARKDOWN = /!\[([^\]]*)\]\((\/api\/images\/[\w-]+)\)/g;
const stripImages = (body) => body.replace(IMAGE_MARKDOWN, '').replace(/\n{3,}/g, '\n\n').trim();
const today = () => new Date().toISOString().slice(0, 10);

const entryContainer = $('entryContainer');
const writeForm = $('writeForm');
const dateInput = $('entryDate');
const titleInput = $('entryTitle');
const textInput = $('entryText');
const saveButton = $('saveButton');
const cancelButton = $('cancelButton');
const photoButton = $('photoButton');
const photoInput = photoButton.querySelector('input');
const formMessage = $('formMessage');

let entries = [];
// id of the entry being edited; null means new-entry mode
let editingId = null;

function renderEntries() {
  entryContainer.innerHTML = '';
  for (const entry of entries) {
    const section = document.createElement('section');
    section.classList.add('entry');
    section.dataset.id = entry.id;

    const date = document.createElement('p');
    date.textContent = entry.entry_date.replaceAll('-', '. ');
    section.appendChild(date);

    const title = document.createElement('h2');
    // textContent so < and > typed into an entry are not read as tags
    title.textContent = entry.title || '';
    section.appendChild(title);

    const body = document.createElement('p');
    body.classList.add('entry-body');
    body.textContent = stripImages(entry.body);
    section.appendChild(body);

    const images = [...entry.body.matchAll(IMAGE_MARKDOWN)];
    if (images.length) {
      const box = document.createElement('div');
      box.classList.add('entry-images');
      for (const [, alt, url] of images) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = alt;
        image.loading = 'lazy';
        box.appendChild(image);
      }
      section.appendChild(box);
    }

    const remove = document.createElement('button');
    remove.classList.add('delete-button');
    remove.textContent = '지우기';
    section.appendChild(remove);

    const edit = document.createElement('button');
    edit.classList.add('edit-button');
    edit.textContent = '수정하기';
    section.appendChild(edit);

    entryContainer.appendChild(section);
  }
  markEditingEntry();
}

function markEditingEntry() {
  entryContainer.querySelectorAll('.entry').forEach((section) => {
    section.classList.toggle('is-editing', section.dataset.id === editingId);
  });
}

function enterEditMode(entryId) {
  editingId = entryId;
  saveButton.textContent = '수정하기';
  cancelButton.hidden = false;
  // Uploads attach to an entry that already exists, so photos wait until after the first save.
  photoButton.hidden = false;
  markEditingEntry();
}

function exitEditMode() {
  editingId = null;
  dateInput.value = today();
  titleInput.value = '';
  textInput.value = '';
  saveButton.textContent = '저장하기';
  cancelButton.hidden = true;
  photoButton.hidden = true;
  formMessage.textContent = '';
  markEditingEntry();
}

// The list is redrawn on every change, so listen once on the container
// instead of binding a listener per button.
entryContainer.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const section = button.closest('.entry');
  if (!section) return;
  if (button.classList.contains('delete-button')) deleteEntry(section.dataset.id);
  else if (button.classList.contains('edit-button')) editEntry(section.dataset.id);
});

saveButton.addEventListener('click', onSave);
cancelButton.addEventListener('click', exitEditMode);

function editEntry(entryId) {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return;
  dateInput.value = entry.entry_date;
  titleInput.value = entry.title;
  // the raw body, image markdown included, so saving does not drop the photos
  textInput.value = entry.body;
  enterEditMode(entryId);
  titleInput.focus();
}

async function onSave() {
  const payload = { entryDate: dateInput.value, title: titleInput.value.trim(), body: textInput.value };
  if (!payload.entryDate) { formMessage.textContent = '날짜를 넣어주세요.'; return; }
  if (!payload.title && !payload.body.trim()) return;
  // lock the button so one entry cannot be posted twice
  saveButton.disabled = true;
  formMessage.textContent = '';
  try {
    if (editingId) await api(`/api/entries/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    else await api('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    exitEditMode();
    await loadEntries();
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteEntry(entryId) {
  if (!window.confirm('이 기록을 지울까요?')) return;
  try {
    await api(`/api/entries/${entryId}`, { method: 'DELETE' });
  } catch (error) {
    formMessage.textContent = error.message;
    return;
  }
  if (editingId === entryId) exitEditMode();
  await loadEntries();
}

photoInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || !editingId) return;
  formMessage.textContent = '사진을 올리는 중…';
  try {
    const data = new FormData();
    data.append('image', file);
    data.append('entryId', editingId);
    const result = await api('/api/images', { method: 'POST', body: data });
    textInput.value += `${textInput.value ? '\n\n' : ''}![${file.name}](${result.image.url})`;
    formMessage.textContent = '사진을 넣었습니다. 저장해 주세요.';
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    event.target.value = '';
  }
});

$('signInButton').addEventListener('click', () => { location.href = '/auth/google'; });
$('signOutButton').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

function showNotice(text) {
  const notice = document.createElement('p');
  notice.classList.add('notice');
  notice.textContent = text;
  entryContainer.replaceChildren(notice);
}

async function loadEntries() {
  entries = (await api('/api/entries')).entries;
  renderEntries();
}

async function start() {
  try {
    await api('/api/me');
  } catch (error) {
    $('signInButton').hidden = false;
    const reason = error.status === 401 ? null : error.message;
    showNotice(reason || new URLSearchParams(location.search).get('login_error') || '나만 볼 수 있는 일기장입니다. 구글로그인을 눌러 시작하세요.');
    if (location.search) history.replaceState(null, '', location.pathname);
    return;
  }
  $('signOutButton').hidden = false;
  writeForm.hidden = false;
  exitEditMode();
  try {
    await loadEntries();
  } catch (error) {
    showNotice(error.message);
  }
}

start();
