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
// An optional "title" after the address is the photo's copyright line:
// ![name](/api/images/<id> "© someone").
const IMAGE_MARKDOWN = /!\[([^\]]*)\]\((\/api\/images\/[\w-]+)(?:\s+"([^"\n]*)")?\)/g;
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
    image.src = match[2];
    image.alt = match[1];
    image.loading = 'lazy';
    const credit = match[3]?.trim();
    if (credit) {
      const figure = document.createElement('figure');
      figure.classList.add('entry-image');
      figure.appendChild(image);
      const caption = document.createElement('figcaption');
      caption.textContent = credit;
      figure.appendChild(caption);
      section.appendChild(figure);
    } else {
      image.classList.add('entry-image');
      section.appendChild(image);
    }
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

// Every entry starts open. The ones the reader folded are remembered across redraws, so
// saving or deleting one entry does not reopen them.
const closedIds = new Set();

// Each title folds and unfolds its entry in place.
function renderEntries() {
  entryContainer.innerHTML = '';
  for (const entry of entries) {
    const section = document.createElement('section');
    section.classList.add('entry');
    section.dataset.id = entry.id;

    const details = document.createElement('details');
    details.open = !closedIds.has(entry.id);
    details.addEventListener('toggle', () => {
      if (details.open) closedIds.delete(entry.id); else closedIds.add(entry.id);
    });

    const summary = document.createElement('summary');
    const title = document.createElement('h2');
    // textContent so < and > typed into an entry are not read as tags
    title.textContent = entry.title || '(제목 없음)';
    summary.appendChild(title);
    // Shown under the title while folded and after the body once opened; CSS hides
    // whichever copy does not apply.
    summary.appendChild(entryMeta(entry));
    details.appendChild(summary);

    const content = document.createElement('div');
    content.classList.add('entry-content');
    appendBody(content, entry.body);
    content.appendChild(entryMeta(entry));
    // The feed is public; only the author gets the controls.
    if (entry.mine) appendControls(content);
    details.appendChild(content);

    section.appendChild(details);
    entryContainer.appendChild(section);
  }
  if (!entries.length) showNotice('아직 올라온 기록이 없습니다.');
  markEditingEntry();
}

function entryMeta(entry) {
  const meta = document.createElement('p');
  meta.classList.add('entry-meta');
  meta.textContent = [entry.entry_date.replaceAll('-', '. '), entry.author].filter(Boolean).join(' · ');
  return meta;
}

function appendControls(section) {
  const remove = document.createElement('button');
  remove.classList.add('delete-button');
  remove.textContent = '지우기';
  section.appendChild(remove);

  const edit = document.createElement('button');
  edit.classList.add('edit-button');
  edit.textContent = '수정하기';
  section.appendChild(edit);
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

function addPhotoChip(file, name, url) {
  const preview = URL.createObjectURL(file);
  photoUrls.push(preview);
  const chip = document.createElement('div');
  chip.classList.add('photo-chip');
  const thumb = document.createElement('img');
  thumb.src = preview;
  thumb.alt = file.name;
  chip.appendChild(thumb);
  // Typed next to the photo and written into the markdown when it is placed.
  const credit = document.createElement('input');
  credit.type = 'text';
  credit.classList.add('photo-credit');
  credit.placeholder = '저작권 (선택)';
  credit.setAttribute('aria-label', '사진 저작권 표시');
  chip.appendChild(credit);
  const insert = document.createElement('button');
  insert.type = 'button';
  insert.textContent = '넣기';
  insert.addEventListener('click', () => insertAtCursor(imageMarkdown(name, url, credit.value)));
  chip.appendChild(insert);
  photoStrip.appendChild(chip);
  photoStrip.hidden = false;
}

// ] would end the name and " the credit early, so they are swapped for look-alikes.
function imageMarkdown(name, url, credit) {
  const alt = name.replace(/[\[\]\n]/g, ' ');
  const line = credit.replace(/\s+/g, ' ').replace(/"([^"]*)"/g, '\u201C$1\u201D').replaceAll('"', '\u201D').trim();
  return line ? `![${alt}](${url} "${line}")` : `![${alt}](${url})`;
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
    addPhotoChip(file, picked.name, result.image.url);
    formMessage.textContent = '저작권을 적고 넣기를 누르면 커서 위치에 들어갑니다.';
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    photoButton.disabled = false;
  }
});

$('signInButton').addEventListener('click', () => { location.href = '/auth/google'; });
$('myPageButton').addEventListener('click', () => { location.href = '/me'; });
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

// Sits above the feed, so a sign-in problem does not hide the entries.
const pageNotice = $('pageNotice');
function showPageNotice(text) {
  pageNotice.textContent = text;
  pageNotice.hidden = !text;
}

async function loadEntries() {
  entries = (await api('/api/entries')).entries;
  renderEntries();
}

async function start() {
  const loginError = new URLSearchParams(location.search).get('login_error');
  if (location.search) history.replaceState(null, '', location.pathname);
  let signedIn = true;
  try {
    const { user } = await api('/api/me');
    // A new account picks its nickname before anything else.
    if (!user.nickname) { location.replace('/me?setup=1'); return; }
  } catch (error) {
    signedIn = false;
    // 401 just means a visitor; anything else is worth showing.
    showPageNotice(loginError || (error.status === 401 ? '' : error.message));
  }
  $('signInButton').hidden = signedIn;
  $('signOutButton').hidden = !signedIn;
  $('myPageButton').hidden = !signedIn;
  writeForm.hidden = !signedIn;
  if (signedIn) exitEditMode();
  try {
    await loadEntries();
  } catch (error) {
    showNotice(error.message);
  }
}

start();
