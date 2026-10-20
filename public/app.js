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
const today = () => new Date().toISOString().slice(0, 10);

const entryContainer = $('entryContainer');
const writeForm = $('writeForm');
const dateInput = $('entryDate');
const titleInput = $('entryTitle');
const textInput = $('entryText');
const saveButton = $('saveButton');
const cancelButton = $('cancelButton');
const photoButton = $('photoButton');
const photoInput = $('photoInput');
const photoStrip = $('photoStrip');
const formMessage = $('formMessage');

let entries = [];
// id of the entry being edited; null means new-entry mode
let editingId = null;

// Walk the body in order so a photo lands between the paragraphs it was written between,
// rather than every photo being collected at the end.
function appendBody(section, body) {
  let cursor = 0;
  for (const match of body.matchAll(IMAGE_MARKDOWN)) {
    appendText(section, body.slice(cursor, match.index));
    const image = document.createElement('img');
    image.classList.add('entry-image');
    image.src = match[2];
    image.alt = match[1];
    image.loading = 'lazy';
    section.appendChild(image);
    cursor = match.index + match[0].length;
  }
  appendText(section, body.slice(cursor));
}

function appendText(section, text) {
  // Blank lines around a photo are what separated it from the text, not content.
  const trimmed = text.replace(/^\n+|\n+$/g, '');
  if (!trimmed) return;
  const paragraph = document.createElement('p');
  paragraph.classList.add('entry-body');
  paragraph.textContent = trimmed;
  section.appendChild(paragraph);
}

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

    appendBody(section, entry.body);

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
  markEditingEntry();
}

function exitEditMode() {
  editingId = null;
  dateInput.value = today();
  titleInput.value = '';
  textInput.value = '';
  saveButton.textContent = '저장하기';
  cancelButton.hidden = true;
  formMessage.textContent = '';
  clearPhotoStrip();
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

// Photos are shrunk in the browser before upload: a phone picture is several thousand
// pixels wide, far more than the 550px column ever shows.
const MAX_WIDTH = 800;
async function shrink(file) {
  // An animated GIF would come back as a single frame, so leave it alone.
  if (file.type === 'image/gif') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // unreadable by the canvas path; let the server take the original
  }
  if (bitmap.width <= MAX_WIDTH) { bitmap.close?.(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = MAX_WIDTH;
  canvas.height = Math.round((bitmap.height * MAX_WIDTH) / bitmap.width);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

// Object URLs for the thumbnails, released when the form is reset.
let photoUrls = [];
function clearPhotoStrip() {
  for (const url of photoUrls) URL.revokeObjectURL(url);
  photoUrls = [];
  photoStrip.replaceChildren();
  photoStrip.hidden = true;
}

function addPhotoChip(file, markdown) {
  const url = URL.createObjectURL(file);
  photoUrls.push(url);
  const chip = document.createElement('div');
  chip.classList.add('photo-chip');
  const thumb = document.createElement('img');
  thumb.src = url;
  thumb.alt = file.name;
  chip.appendChild(thumb);
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.textContent = '넣기';
  insert.addEventListener('click', () => insertAtCursor(markdown));
  chip.appendChild(insert);
  photoStrip.appendChild(chip);
  photoStrip.hidden = false;
}

// Drop the text where the caret was left, not at the end.
function insertAtCursor(text) {
  const start = textInput.selectionStart ?? textInput.value.length;
  const end = textInput.selectionEnd ?? textInput.value.length;
  const before = textInput.value.slice(0, start);
  const after = textInput.value.slice(end);
  const padded = `${before && !before.endsWith('\n') ? '\n' : ''}${text}${after && !after.startsWith('\n') ? '\n' : ''}`;
  textInput.value = before + padded + after;
  const caret = start + padded.length;
  textInput.focus();
  textInput.setSelectionRange(caret, caret);
  formMessage.textContent = '본문에 넣었습니다. 저장해 주세요.';
}

photoButton.addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', async (event) => {
  const picked = event.target.files[0];
  event.target.value = '';
  if (!picked) return;
  formMessage.textContent = '사진을 올리는 중…';
  photoButton.disabled = true;
  try {
    const file = await shrink(picked);
    const data = new FormData();
    data.append('image', file);
    // While composing there is no entry yet; the server links the photo when it is saved.
    if (editingId) data.append('entryId', editingId);
    const result = await api('/api/images', { method: 'POST', body: data });
    addPhotoChip(file, `![${picked.name}](${result.image.url})`);
    formMessage.textContent = '넣기를 누르면 커서 위치에 들어갑니다.';
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    photoButton.disabled = false;
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
