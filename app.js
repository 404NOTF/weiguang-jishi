'use strict';

const DB_NAME = 'weiguang-jishi';
const DB_VERSION = 1;
const STORE = 'memories';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  memories: [],
  editingId: null,
  selectedMood: { name: '小雀跃', emoji: '✨' },
  draftPhotos: [],
  query: '',
  tag: '',
  favoritesOnly: false,
  detailId: null
};

const els = {
  todayLabel: $('#todayLabel'), totalCount: $('#totalCount'), monthCount: $('#monthCount'), photoCount: $('#photoCount'),
  timeline: $('#timeline'), emptyState: $('#emptyState'), tagFilter: $('#tagFilter'), searchInput: $('#searchInput'),
  favoritesButton: $('#favoritesButton'), entryDialog: $('#entryDialog'), entryForm: $('#entryForm'), entryText: $('#entryText'),
  entryDate: $('#entryDate'), entryTime: $('#entryTime'), entryTags: $('#entryTags'), photoInput: $('#photoInput'),
  photoPreview: $('#photoPreview'), charCount: $('#charCount'), moodPicker: $('#moodPicker'), entryDialogTitle: $('#entryDialogTitle'),
  settingsDialog: $('#settingsDialog'), detailDialog: $('#detailDialog'), detailContent: $('#detailContent'),
  importInput: $('#importInput'), toast: $('#toast')
};

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbAction(mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const getAll = () => dbAction('readonly', store => store.getAll());
const putOne = memory => dbAction('readwrite', store => store.put(memory));
const removeOne = id => dbAction('readwrite', store => store.delete(id));
const clearStore = () => dbAction('readwrite', store => store.clear());

const pad = number => String(number).padStart(2, '0');
function localParts(date = new Date()) {
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}
function parseLocal(date, time = '12:00') { return new Date(`${date}T${time || '12:00'}:00`); }
function escapeHTML(value = '') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function uid() { return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`; }

function dayTitle(dateString) {
  const date = parseLocal(dateString);
  const today = localParts().date;
  const yesterday = localParts(new Date(Date.now() - 86400000)).date;
  if (dateString === today) return '今天';
  if (dateString === yesterday) return '昨天';
  const currentYear = new Date().getFullYear();
  return new Intl.DateTimeFormat('zh-CN', { year: date.getFullYear() === currentYear ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function fullDate(memory) {
  return new Intl.DateTimeFormat('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long', hour:'2-digit', minute:'2-digit', hour12:false }).format(parseLocal(memory.date, memory.time));
}

function sortMemories(list) {
  return [...list].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`) || b.updatedAt - a.updatedAt);
}

function filteredMemories() {
  const query = state.query.trim().toLowerCase();
  return sortMemories(state.memories).filter(memory => {
    const text = `${memory.text} ${(memory.tags || []).join(' ')} ${memory.mood?.name || ''}`.toLowerCase();
    return (!query || text.includes(query)) && (!state.tag || (memory.tags || []).includes(state.tag)) && (!state.favoritesOnly || memory.favorite);
  });
}

function render() {
  renderSummary();
  renderTags();
  renderTimeline();
}

function renderSummary() {
  const now = new Date();
  els.totalCount.textContent = state.memories.length;
  els.monthCount.textContent = state.memories.filter(m => {
    const d = parseLocal(m.date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  els.photoCount.textContent = state.memories.reduce((sum, m) => sum + (m.photos?.length || 0), 0);
}

function renderTags() {
  const counts = new Map();
  state.memories.forEach(m => (m.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const tags = [...counts.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  els.tagFilter.innerHTML = tags.map(([tag, count]) => `<button class="tag-chip ${state.tag === tag ? 'active' : ''}" data-tag="${escapeHTML(tag)}">#${escapeHTML(tag)} · ${count}</button>`).join('');
}

function renderTimeline() {
  const list = filteredMemories();
  els.emptyState.hidden = list.length > 0;
  els.timeline.hidden = list.length === 0;
  if (!list.length) {
    $('#emptyState h3').textContent = state.memories.length ? '没有找到这束微光' : '第一束微光，在等你';
    $('#emptyState p').innerHTML = state.memories.length ? '换个关键词或筛选条件，<br>也许它正躲在别处。' : '今天发生的任何一点点开心，<br>都可以从这里开始收藏。';
    $('#emptyAddButton').hidden = state.memories.length > 0;
    return;
  }
  let currentDay = '';
  els.timeline.innerHTML = list.map(memory => {
    const label = memory.date !== currentDay ? `<div class="day-label">${escapeHTML(dayTitle(memory.date))}</div>` : '';
    currentDay = memory.date;
    const photo = memory.photos?.[0];
    const photoHTML = photo ? `<img class="card-photo" src="${photo.data}" alt="开心回忆照片">${memory.photos.length > 1 ? `<span class="photo-count">＋${memory.photos.length - 1}</span>` : ''}` : '';
    const tags = (memory.tags || []).slice(0, 2).map(tag => `<span class="mini-tag">#${escapeHTML(tag)}</span>`).join('');
    return `${label}<article class="memory-card ${photo ? 'has-photo' : ''}" data-id="${memory.id}">
      <div class="card-body">
        <div class="card-top"><span class="card-time">${escapeHTML(memory.time)} · ${memory.mood?.emoji || '✨'}</span><button class="favorite ${memory.favorite ? 'active' : ''}" data-favorite="${memory.id}" aria-label="${memory.favorite ? '取消珍藏' : '珍藏'}">☆</button></div>
        <p class="memory-text">${escapeHTML(memory.text)}</p>
        <div class="card-meta"><span class="mood">${memory.mood?.emoji || '✨'} ${escapeHTML(memory.mood?.name || '小雀跃')}</span>${tags}</div>
      </div>${photoHTML}
    </article>`;
  }).join('');
}

function openEntry(memory = null) {
  const now = localParts();
  state.editingId = memory?.id || null;
  state.draftPhotos = memory?.photos ? structuredClone(memory.photos) : [];
  state.selectedMood = memory?.mood || { name:'小雀跃', emoji:'✨' };
  els.entryDialogTitle.textContent = memory ? '编辑这束微光' : '收藏一束微光';
  els.entryText.value = memory?.text || '';
  els.entryDate.value = memory?.date || now.date;
  els.entryTime.value = memory?.time || now.time;
  els.entryTags.value = (memory?.tags || []).join(' ');
  els.charCount.textContent = els.entryText.value.length;
  els.photoInput.value = '';
  renderPhotoPreview();
  renderMood();
  els.entryDialog.showModal();
  setTimeout(() => els.entryText.focus(), 180);
}

function renderMood() {
  $$('button', els.moodPicker).forEach(button => button.classList.toggle('active', button.dataset.mood === state.selectedMood.name));
}

function renderPhotoPreview() {
  els.photoPreview.innerHTML = state.draftPhotos.map((photo, index) => `<div class="preview-item"><img src="${photo.data}" alt="待保存照片"><button type="button" data-remove-photo="${index}" aria-label="移除照片">×</button></div>`).join('');
}

async function fileToCompressedPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const dataURL = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataURL;
  });
  const max = 1800;
  const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const compressed = canvas.toDataURL('image/jpeg', .82);
  return { id: uid(), name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type:'image/jpeg', data: compressed, width:canvas.width, height:canvas.height };
}

async function saveEntry(event) {
  event.preventDefault();
  const text = els.entryText.value.trim();
  if (!text) return showToast('先写下一点开心吧');
  const existing = state.memories.find(m => m.id === state.editingId);
  const memory = {
    id: existing?.id || uid(),
    text,
    date: els.entryDate.value,
    time: els.entryTime.value,
    mood: state.selectedMood,
    tags: [...new Set(els.entryTags.value.trim().split(/[\s,，#]+/).map(x => x.trim()).filter(Boolean))],
    photos: state.draftPhotos,
    favorite: existing?.favorite || false,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  try {
    await putOne(memory);
    const index = state.memories.findIndex(m => m.id === memory.id);
    if (index >= 0) state.memories[index] = memory; else state.memories.push(memory);
    els.entryDialog.close();
    render();
    showToast(existing ? '已经替你改好啦' : '这束微光，收好啦 ✦');
  } catch (error) {
    console.error(error);
    showToast('保存失败，可能是设备空间不足');
  }
}

function openDetail(id) {
  const memory = state.memories.find(m => m.id === id);
  if (!memory) return;
  state.detailId = id;
  const photos = (memory.photos || []).map(photo => `<img src="${photo.data}" alt="开心回忆照片">`).join('');
  const tags = (memory.tags || []).map(tag => `<span>#${escapeHTML(tag)}</span>`).join('');
  els.detailContent.innerHTML = `<div class="detail-wrap">
    <div class="detail-actions"><button data-close-detail>← 返回</button><button class="delete-detail" data-delete-detail>删除</button><button class="edit-detail" data-edit-detail>编辑</button></div>
    <div class="detail-date">${escapeHTML(fullDate(memory))}</div>
    <div class="detail-text">${escapeHTML(memory.text)}</div>
    ${photos ? `<div class="detail-photos">${photos}</div>` : ''}
    <div class="detail-mood">${memory.mood?.emoji || '✨'} ${escapeHTML(memory.mood?.name || '小雀跃')}${memory.favorite ? ' · ★ 已珍藏' : ''}</div>
    ${tags ? `<div class="detail-tags">${tags}</div>` : ''}
  </div>`;
  els.detailDialog.showModal();
}

async function toggleFavorite(id) {
  const memory = state.memories.find(m => m.id === id);
  if (!memory) return;
  memory.favorite = !memory.favorite;
  memory.updatedAt = Date.now();
  await putOne(memory);
  render();
  showToast(memory.favorite ? '放进珍藏啦 ★' : '已取消珍藏');
}

async function deleteMemory(id) {
  const memory = state.memories.find(m => m.id === id);
  if (!memory || !confirm('要删除这束微光吗？删除后不能恢复。')) return;
  await removeOne(id);
  state.memories = state.memories.filter(m => m.id !== id);
  els.detailDialog.close();
  render();
  showToast('已经删除');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportBackup() {
  const backup = { app:'微光纪事', version:1, exportedAt:new Date().toISOString(), count:state.memories.length, memories:sortMemories(state.memories) };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type:'application/json;charset=utf-8' });
  downloadBlob(blob, `微光纪事-完整备份-${localParts().date}.json`);
  showToast(`已导出 ${state.memories.length} 条记录`);
}

function exportAlbum() {
  if (!state.memories.length) return showToast('还没有可以导出的记录');
  const list = sortMemories(state.memories);
  const cards = list.map(memory => {
    const photos = (memory.photos || []).map(photo => `<img src="${photo.data}" alt="记录照片">`).join('');
    const tags = (memory.tags || []).map(tag => `<span>#${escapeHTML(tag)}</span>`).join('');
    return `<article><time>${escapeHTML(fullDate(memory))}</time><p>${escapeHTML(memory.text).replace(/\n/g,'<br>')}</p>${photos ? `<div class="photos">${photos}</div>`:''}<footer>${memory.mood?.emoji || '✨'} ${escapeHTML(memory.mood?.name || '')} ${tags}</footer></article>`;
  }).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>我的微光回忆册</title><style>body{margin:0;background:#f7f4f1;color:#202035;font-family:system-ui,"PingFang SC",sans-serif}main{max-width:720px;margin:auto;padding:42px 18px}header{text-align:center;padding:30px 0 50px}h1{font:500 38px Georgia,"Songti SC",serif;margin:0 0 12px;color:#272b54}header p{color:#8b8594;font-size:13px}article{background:#fff;border-radius:20px;padding:22px;margin:0 0 16px;box-shadow:0 8px 30px #30264b10}time{font-size:11px;color:#9b95a3}article>p{font:400 17px/1.8 Georgia,"Songti SC",serif}.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.photos img{width:100%;border-radius:12px}.photos img:only-child{grid-column:1/-1;max-height:650px;object-fit:contain;background:#f5f2f2}footer{margin-top:14px;color:#82798e;font-size:11px}footer span{display:inline-block;background:#efebf7;padding:4px 7px;border-radius:20px;margin-left:5px}@media print{body{background:white}article{break-inside:avoid;box-shadow:none;border:1px solid #eee}}</style></head><body><main><header><h1>微光纪事</h1><p>${list.length} 件开心的小事 · 导出于 ${new Date().toLocaleString('zh-CN')}</p></header>${cards}</main></body></html>`;
  downloadBlob(new Blob([html], {type:'text/html;charset=utf-8'}), `微光纪事-回忆册-${localParts().date}.html`);
  showToast('回忆册已经做好啦');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== '微光纪事' || !Array.isArray(data.memories)) throw new Error('格式不正确');
    const replace = confirm(`备份中有 ${data.memories.length} 条记录。\n\n点“确定”：覆盖当前全部记录\n点“取消”：与当前记录合并`);
    if (replace) { await clearStore(); state.memories = []; }
    const current = new Map(state.memories.map(m => [m.id, m]));
    for (const memory of data.memories) {
      const copy = { ...memory, id: current.has(memory.id) && !replace ? uid() : memory.id };
      await putOne(copy); current.set(copy.id, copy);
    }
    state.memories = [...current.values()];
    render();
    els.settingsDialog.close();
    showToast(`成功恢复 ${data.memories.length} 条微光`);
  } catch (error) {
    console.error(error);
    showToast('导入失败：这不是有效的备份文件');
  } finally { els.importInput.value = ''; }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function bindEvents() {
  ['#newEntryButton','#emptyAddButton','#floatingAdd'].forEach(selector => $(selector).addEventListener('click', () => openEntry()));
  $('#cancelEntryButton').addEventListener('click', () => els.entryDialog.close());
  $('#settingsButton').addEventListener('click', () => els.settingsDialog.showModal());
  $('#closeSettings').addEventListener('click', () => els.settingsDialog.close());
  $('#brandButton').addEventListener('click', () => scrollTo({top:0,behavior:'smooth'}));
  els.entryForm.addEventListener('submit', saveEntry);
  els.entryText.addEventListener('input', () => els.charCount.textContent = els.entryText.value.length);
  els.moodPicker.addEventListener('click', event => {
    const button = event.target.closest('button[data-mood]'); if (!button) return;
    state.selectedMood = { name:button.dataset.mood, emoji:button.dataset.emoji }; renderMood();
  });
  els.photoInput.addEventListener('change', async () => {
    const files = [...els.photoInput.files].slice(0, 9 - state.draftPhotos.length);
    if (!files.length) return;
    showToast('正在收好照片…');
    try {
      for (const file of files) state.draftPhotos.push(await fileToCompressedPhoto(file));
      renderPhotoPreview(); showToast('照片已经放好啦');
    } catch (error) { console.error(error); showToast('有一张照片没有读成功'); }
    els.photoInput.value = '';
  });
  els.photoPreview.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-photo]'); if (!button) return;
    state.draftPhotos.splice(Number(button.dataset.removePhoto), 1); renderPhotoPreview();
  });
  els.searchInput.addEventListener('input', () => { state.query = els.searchInput.value; renderTimeline(); });
  els.favoritesButton.addEventListener('click', () => { state.favoritesOnly = !state.favoritesOnly; els.favoritesButton.setAttribute('aria-pressed', state.favoritesOnly); renderTimeline(); });
  els.tagFilter.addEventListener('click', event => { const button=event.target.closest('[data-tag]'); if(!button)return; state.tag = state.tag === button.dataset.tag ? '' : button.dataset.tag; renderTags(); renderTimeline(); });
  els.timeline.addEventListener('click', event => {
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favorite); return; }
    const card = event.target.closest('[data-id]'); if (card) openDetail(card.dataset.id);
  });
  $('#randomButton').addEventListener('click', () => {
    const list = filteredMemories().length ? filteredMemories() : state.memories;
    if (!list.length) return showToast('先收藏一束微光吧');
    openDetail(list[Math.floor(Math.random() * list.length)].id);
  });
  els.detailContent.addEventListener('click', event => {
    if (event.target.closest('[data-close-detail]')) els.detailDialog.close();
    if (event.target.closest('[data-delete-detail]')) deleteMemory(state.detailId);
    if (event.target.closest('[data-edit-detail]')) { const memory=state.memories.find(m=>m.id===state.detailId); els.detailDialog.close(); openEntry(memory); }
  });
  els.detailDialog.addEventListener('click', event => { if (event.target === els.detailDialog) els.detailDialog.close(); });
  $('#exportBackupButton').addEventListener('click', exportBackup);
  $('#exportAlbumButton').addEventListener('click', exportAlbum);
  els.importInput.addEventListener('change', () => els.importInput.files[0] && importBackup(els.importInput.files[0]));
  $('#clearAllButton').addEventListener('click', async () => {
    if (!state.memories.length) return showToast('现在还没有记录');
    if (!confirm('真的要清空全部记录吗？\n建议先导出完整备份。')) return;
    if (!confirm('最后确认一次：所有文字和照片都会被删除，且无法撤销。')) return;
    await clearStore(); state.memories=[]; els.settingsDialog.close(); render(); showToast('记录已全部清空');
  });
  addEventListener('scroll', () => $('#floatingAdd').style.display = scrollY > 330 ? 'block' : 'none', {passive:true});
}

async function init() {
  const now = new Date();
  els.todayLabel.textContent = new Intl.DateTimeFormat('zh-CN', { month:'long', day:'numeric', weekday:'long' }).format(now);
  bindEvents();
  try { db = await openDB(); state.memories = await getAll(); render(); }
  catch (error) { console.error(error); showToast('本地记录空间暂时打不开'); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(console.error);
}

init();
