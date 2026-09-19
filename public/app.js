const $ = (selector) => document.querySelector(selector);
let entries = []; let active = null;
const api = async (path, options = {}) => { const response = await fetch(path, options); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '요청에 실패했습니다.'); return response.status === 204 ? null : response.json(); };
const escapeHtml = (value) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const today = () => new Date().toISOString().slice(0, 10);

function renderList() {
  $('#entry-list').innerHTML = entries.length ? entries.map((entry) => `<button class="entry ${entry.id === active?.id ? 'selected' : ''}" data-id="${entry.id}"><time>${entry.entry_date.replaceAll('-', '.')}</time><strong>${escapeHtml(entry.title || '제목 없는 기록')}</strong><span>${escapeHtml(entry.body.slice(0, 54))}</span></button>`).join('') : '<p class="no-entries">아직 기록이 없어요.<br>오늘의 한 줄부터 시작해 보세요.</p>';
  document.querySelectorAll('.entry').forEach((button) => button.onclick = () => openEntry(entries.find((entry) => entry.id === button.dataset.id)));
}
function openEntry(entry) {
  active = entry; renderList();
  const fragment = $('#editor-template').content.cloneNode(true); const form = fragment.querySelector('form');
  form.entryDate.value = entry.entry_date; form.title.value = entry.title; form.body.value = entry.body;
  form.querySelector('.delete').onclick = async () => { if (!confirm('이 기록을 삭제할까요?')) return; await api(`/api/entries/${entry.id}`, { method: 'DELETE' }); entries = entries.filter((item) => item.id !== entry.id); active = null; renderList(); $('#editor').className = 'card empty'; $('#editor').innerHTML = '<p>기록이 삭제되었습니다.<br>새로운 기록을 시작해 보세요.</p>'; };
  form.querySelector('input[type=file]').onchange = async (event) => { const file = event.target.files[0]; if (!file) return; const message = form.querySelector('.message'); message.textContent = '사진을 올리는 중…'; try { const data = new FormData(); data.append('image', file); data.append('entryId', entry.id); const result = await api('/api/images', { method: 'POST', body: data }); form.body.value += `${form.body.value ? '\n\n' : ''}![${file.name}](${result.image.url})`; message.textContent = '사진 링크를 본문에 추가했습니다. 저장해 주세요.'; } catch (error) { message.textContent = error.message; } };
  form.onsubmit = async (event) => { event.preventDefault(); const message = form.querySelector('.message'); const payload = { entryDate: form.entryDate.value, title: form.title.value, body: form.body.value }; try { await api(`/api/entries/${entry.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); Object.assign(entry, { entry_date: payload.entryDate, title: payload.title, body: payload.body }); entries.sort((a, b) => b.entry_date.localeCompare(a.entry_date)); renderList(); message.textContent = '저장했습니다.'; } catch (error) { message.textContent = error.message; } };
  $('#editor').className = 'card'; $('#editor').replaceChildren(fragment);
}
async function createEntry() { try { const result = await api('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryDate: today(), title: '', body: '' }) }); entries.unshift(result.entry); openEntry(result.entry); } catch (error) { alert(error.message); } }
async function start() { try { const { user } = await api('/api/me'); $('#account').innerHTML = `<span class="user">${escapeHtml(user.name)}</span><button class="logout">로그아웃</button>`; $('.logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); }; const data = await api('/api/entries'); entries = data.entries; $('#loading').hidden = true; $('#app').hidden = false; renderList(); $('#new-entry').onclick = createEntry; } catch { $('#loading').hidden = true; $('#login').hidden = false; } }
start();
