// ── Quarter Utilities ───────────────────────────────────────
function getCurrentQuarter() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function parseQuarter(qStr) {
  const [year, qPart] = qStr.split('-Q');
  return { year: parseInt(year), quarter: parseInt(qPart) };
}

function prevQuarter(qStr) {
  const { year, quarter } = parseQuarter(qStr);
  if (quarter === 1) return `${year - 1}-Q4`;
  return `${year}-Q${quarter - 1}`;
}

function nextQuarter(qStr) {
  const { year, quarter } = parseQuarter(qStr);
  if (quarter === 4) return `${year + 1}-Q1`;
  return `${year}-Q${quarter + 1}`;
}

// ── Data Layer ──────────────────────────────────────────────
const LEGACY_STORAGE_KEY = 'research-queue-data';

function storageKey(quarter) {
  return `research-queue-${quarter}`;
}

function loadFromStorage(quarter) {
  try {
    const raw = localStorage.getItem(storageKey(quarter));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(quarter, data) {
  localStorage.setItem(storageKey(quarter), JSON.stringify(data));
}

async function loadFromFile(quarter) {
  try {
    const res = await fetch(`data/${quarter}/queue.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    return json.topics || [];
  } catch {
    return null;
  }
}

async function loadIndex() {
  try {
    const res = await fetch('data/index.json', { cache: 'no-cache' });
    if (!res.ok) return { quarters: [getCurrentQuarter()] };
    return await res.json();
  } catch {
    return { quarters: [getCurrentQuarter()] };
  }
}

function saveData(topicsData) {
  saveToStorage(activeQuarter, topicsData);
  updateSyncIndicator(true);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createTopic(title, description = '') {
  return {
    id: generateId(),
    title,
    description,
    status: 'queued',
    notes: '',
    children: [],
    createdAt: Date.now(),
  };
}

// ── State ──────────────────────────────────────────────────
let activeQuarter = getCurrentQuarter();
let availableQuarters = [getCurrentQuarter()];
let topics = [];
let selectedId = null;
let currentFilter = 'all';
let expandedNodes = new Set(JSON.parse(localStorage.getItem('research-expanded') || '[]'));
let hasUnsavedChanges = false;

function saveExpanded() {
  localStorage.setItem('research-expanded', JSON.stringify([...expandedNodes]));
}

// ── Topic CRUD helpers ─────────────────────────────────────
function findTopic(id, list = topics) {
  for (const t of list) {
    if (t.id === id) return t;
    const found = findTopic(id, t.children);
    if (found) return found;
  }
  return null;
}

function findParent(id, list = topics, parent = null) {
  for (const t of list) {
    if (t.id === id) return parent;
    const found = findParent(id, t.children, t);
    if (found !== undefined) return found;
  }
  return undefined;
}

function deleteTopic(id, list = topics) {
  const idx = list.findIndex(t => t.id === id);
  if (idx !== -1) {
    list.splice(idx, 1);
    return true;
  }
  for (const t of list) {
    if (deleteTopic(id, t.children)) return true;
  }
  return false;
}

function getAncestors(id) {
  const path = [];
  let current = id;
  while (current) {
    const parent = findParent(current);
    if (parent) {
      path.unshift(parent);
      current = parent.id;
    } else {
      break;
    }
  }
  return path;
}

function flattenAll(list = topics) {
  const result = [];
  for (const t of list) {
    result.push(t);
    result.push(...flattenAll(t.children));
  }
  return result;
}

function getPath(id) {
  const ancestors = getAncestors(id);
  const topic = findTopic(id);
  return [...ancestors, topic].map(t => t.title).join(' / ');
}

// ── Sync Indicator ─────────────────────────────────────────
function updateSyncIndicator(dirty) {
  hasUnsavedChanges = dirty;
  const indicator = document.getElementById('sync-indicator');
  if (!indicator) return;
  if (dirty) {
    indicator.textContent = 'Unsaved';
    indicator.className = 'sync-indicator dirty';
  } else {
    indicator.textContent = 'Synced';
    indicator.className = 'sync-indicator synced';
  }
}

// ── Quarter Selector ───────────────────────────────────────
function renderQuarterSelector() {
  const selector = document.getElementById('quarter-selector');
  if (!selector) return;

  const prev = selector.querySelector('.quarter-prev');
  const label = selector.querySelector('.quarter-label');
  const next = selector.querySelector('.quarter-next');

  label.textContent = activeQuarter;

  const isCurrentQ = activeQuarter === getCurrentQuarter();
  next.disabled = isCurrentQ;
}

async function switchQuarter(quarter) {
  activeQuarter = quarter;
  selectedId = null;

  let data = loadFromStorage(quarter);
  if (!data) {
    data = await loadFromFile(quarter);
    if (data) saveToStorage(quarter, data);
  }
  topics = data || [];

  renderQuarterSelector();
  showQueueView();
  renderTree();
  updateSyncIndicator(false);
}

// ── Rendering: Tree ────────────────────────────────────────
const treeContainer = document.getElementById('tree-container');

function renderTree() {
  treeContainer.innerHTML = '';
  if (topics.length === 0) {
    treeContainer.innerHTML = '<div class="queue-empty" style="padding:24px"><p style="font-size:16px">No topics yet</p><p>Click "+ New" to add a topic</p></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const topic of topics) {
    fragment.appendChild(renderTreeNode(topic, 0));
  }
  treeContainer.appendChild(fragment);
}

function renderTreeNode(topic, depth) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-node-row' + (selectedId === topic.id ? ' selected' : '');
  row.style.paddingLeft = (12 + depth * 16) + 'px';

  const hasChildren = topic.children.length > 0;
  const isExpanded = expandedNodes.has(topic.id);

  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle' + (isExpanded ? ' expanded' : '') + (!hasChildren ? ' hidden' : '');
  toggle.textContent = '\u25B6';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isExpanded) {
      expandedNodes.delete(topic.id);
    } else {
      expandedNodes.add(topic.id);
    }
    saveExpanded();
    renderTree();
  });

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = hasChildren ? (isExpanded ? '\uD83D\uDCC2' : '\uD83D\uDCC1') : '\uD83D\uDCCB';

  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = topic.title;

  const status = document.createElement('span');
  status.className = 'tree-status ' + topic.status;

  row.append(toggle, icon, label, status);

  row.addEventListener('click', () => {
    selectedId = topic.id;
    showDetailView(topic.id);
    renderTree();
  });

  node.appendChild(row);

  if (hasChildren && isExpanded) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    for (const child of topic.children) {
      childrenContainer.appendChild(renderTreeNode(child, depth + 1));
    }
    node.appendChild(childrenContainer);
  }

  return node;
}

// ── Rendering: Queue ───────────────────────────────────────
const queueList = document.getElementById('queue-list');

function renderQueue() {
  const all = flattenAll();
  const filtered = currentFilter === 'all' ? all : all.filter(t => t.status === currentFilter);

  if (filtered.length === 0) {
    queueList.innerHTML = `<div class="queue-empty"><p>\uD83D\uDCED</p><p>${currentFilter === 'all' ? 'No topics yet. Add one from the sidebar.' : 'No ' + currentFilter.replace('_', ' ') + ' topics.'}</p></div>`;
    return;
  }

  queueList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const topic of filtered) {
    const item = document.createElement('div');
    item.className = 'queue-item';

    const statusDot = document.createElement('div');
    statusDot.className = 'queue-item-status ' + topic.status;

    const info = document.createElement('div');
    info.className = 'queue-item-info';

    const title = document.createElement('div');
    title.className = 'queue-item-title';
    title.textContent = topic.title;

    const path = document.createElement('div');
    path.className = 'queue-item-path';
    path.textContent = getPath(topic.id);

    info.append(title, path);

    item.append(statusDot, info);

    if (topic.children.length > 0) {
      const count = document.createElement('span');
      count.className = 'queue-item-children-count';
      count.textContent = topic.children.length + ' sub';
      item.appendChild(count);
    }

    item.addEventListener('click', () => {
      selectedId = topic.id;
      showDetailView(topic.id);
      renderTree();
    });

    fragment.appendChild(item);
  }
  queueList.appendChild(fragment);
}

// ── Rendering: Detail View ─────────────────────────────────
const queueView = document.getElementById('queue-view');
const detailView = document.getElementById('detail-view');
const detailTitle = document.getElementById('detail-title');
const detailStatus = document.getElementById('detail-status');
const detailDesc = document.getElementById('detail-desc');
const detailNotes = document.getElementById('detail-notes');
const breadcrumb = document.getElementById('breadcrumb');
const childrenList = document.getElementById('children-list');

function showQueueView() {
  selectedId = null;
  queueView.classList.add('active');
  detailView.classList.remove('active');
  renderQueue();
  renderTree();
}

function showDetailView(id) {
  const topic = findTopic(id);
  if (!topic) return showQueueView();

  selectedId = id;
  queueView.classList.remove('active');
  detailView.classList.add('active');

  detailTitle.textContent = topic.title;
  detailStatus.value = topic.status;
  detailDesc.value = topic.description;
  detailNotes.value = topic.notes;

  // Breadcrumb
  const ancestors = getAncestors(id);
  breadcrumb.innerHTML = '';
  for (let i = 0; i < ancestors.length; i++) {
    const span = document.createElement('span');
    span.textContent = ancestors[i].title;
    span.style.cursor = 'pointer';
    span.addEventListener('click', () => {
      selectedId = ancestors[i].id;
      showDetailView(ancestors[i].id);
      renderTree();
    });
    breadcrumb.appendChild(span);

    const sep = document.createElement('span');
    sep.className = 'separator';
    sep.textContent = '/';
    breadcrumb.appendChild(sep);
  }
  const current = document.createElement('span');
  current.className = 'current';
  current.textContent = topic.title;
  breadcrumb.appendChild(current);

  // Children
  renderChildren(topic);
}

function renderChildren(topic) {
  childrenList.innerHTML = '';
  if (topic.children.length === 0) {
    childrenList.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:12px 0;">No sub-topics yet.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const child of topic.children) {
    const item = document.createElement('div');
    item.className = 'child-item';

    const statusDot = document.createElement('div');
    statusDot.className = 'child-item-status ' + child.status;

    const title = document.createElement('span');
    title.className = 'child-item-title';
    title.textContent = child.title;

    item.append(statusDot, title);

    if (child.children.length > 0) {
      const count = document.createElement('span');
      count.className = 'child-item-count';
      count.textContent = child.children.length + ' sub';
      item.appendChild(count);
    }

    const arrow = document.createElement('span');
    arrow.className = 'child-item-arrow';
    arrow.textContent = '\u203A';
    item.appendChild(arrow);

    item.addEventListener('click', () => {
      selectedId = child.id;
      expandedNodes.add(topic.id);
      saveExpanded();
      showDetailView(child.id);
      renderTree();
    });

    fragment.appendChild(item);
  }
  childrenList.appendChild(fragment);
}

// ── Detail auto-save ───────────────────────────────────────
let saveTimeout = null;

function autoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!selectedId) return;
    const topic = findTopic(selectedId);
    if (!topic) return;
    const newTitle = detailTitle.textContent.trim();
    if (newTitle) topic.title = newTitle;
    topic.description = detailDesc.value;
    topic.notes = detailNotes.value;
    saveData(topics);
    renderTree();
  }, 300);
}

detailTitle.addEventListener('input', autoSave);
detailDesc.addEventListener('input', autoSave);
detailNotes.addEventListener('input', autoSave);

detailStatus.addEventListener('change', () => {
  if (!selectedId) return;
  const topic = findTopic(selectedId);
  if (!topic) return;
  topic.status = detailStatus.value;
  saveData(topics);
  renderTree();
});

// ── Modal ──────────────────────────────────────────────────
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalInput = document.getElementById('modal-input');
const modalDescInput = document.getElementById('modal-desc-input');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

let modalCallback = null;

function openModal(title, callback) {
  modalTitle.textContent = title;
  modalInput.value = '';
  modalDescInput.value = '';
  modalCallback = callback;
  modalOverlay.classList.remove('hidden');
  setTimeout(() => modalInput.focus(), 50);
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  modalCallback = null;
}

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

modalConfirm.addEventListener('click', () => {
  const title = modalInput.value.trim();
  if (!title) return;
  if (modalCallback) modalCallback(title, modalDescInput.value.trim());
  closeModal();
});

modalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    modalConfirm.click();
  }
  if (e.key === 'Escape') closeModal();
});

modalDescInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ── Actions ────────────────────────────────────────────────
// Add root topic
document.getElementById('btn-add-root').addEventListener('click', () => {
  openModal('New Topic', (title, desc) => {
    const topic = createTopic(title, desc);
    topics.push(topic);
    saveData(topics);
    renderTree();
    renderQueue();
  });
});

// Add child topic
document.getElementById('btn-add-child').addEventListener('click', () => {
  if (!selectedId) return;
  openModal('New Sub-topic', (title, desc) => {
    const parent = findTopic(selectedId);
    if (!parent) return;
    const child = createTopic(title, desc);
    parent.children.push(child);
    expandedNodes.add(parent.id);
    saveExpanded();
    saveData(topics);
    renderChildren(parent);
    renderTree();
  });
});

// Back button
document.getElementById('btn-back').addEventListener('click', () => {
  if (!selectedId) return showQueueView();
  const parent = findParent(selectedId);
  if (parent) {
    selectedId = parent.id;
    showDetailView(parent.id);
    renderTree();
  } else {
    showQueueView();
  }
});

// Delete topic
document.getElementById('btn-delete-topic').addEventListener('click', () => {
  if (!selectedId) return;
  const topic = findTopic(selectedId);
  if (!topic) return;

  const childCount = flattenAll(topic.children).length;
  const msg = childCount > 0
    ? `Delete "${topic.title}" and its ${childCount} sub-topic(s)?`
    : `Delete "${topic.title}"?`;

  if (!confirm(msg)) return;

  const parent = findParent(selectedId);
  deleteTopic(selectedId);
  saveData(topics);

  if (parent) {
    selectedId = parent.id;
    showDetailView(parent.id);
  } else {
    showQueueView();
  }
  renderTree();
});

// Queue filters
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderQueue();
  });
});

// ── Export / Import (Quarterly JSON) ───────────────────────
function buildQuarterlyJSON(quarter, topicsData) {
  return {
    quarter: quarter,
    updatedAt: new Date().toISOString(),
    topicCount: topicsData.length,
    subTopicCount: flattenAll(topicsData).length - topicsData.length,
    topics: topicsData,
  };
}

document.getElementById('btn-export').addEventListener('click', () => {
  const payload = buildQuarterlyJSON(activeQuarter, topics);
  const data = JSON.stringify(payload, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `queue.json`;
  a.click();
  URL.revokeObjectURL(url);
  updateSyncIndicator(false);
});

const importFileInput = document.getElementById('import-file');
document.getElementById('btn-import').addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      // Support both quarterly format { quarter, topics: [...] } and legacy array format
      let importedTopics;
      let importedQuarter = activeQuarter;

      if (Array.isArray(imported)) {
        importedTopics = imported;
      } else if (imported.topics && Array.isArray(imported.topics)) {
        importedTopics = imported.topics;
        if (imported.quarter) importedQuarter = imported.quarter;
      } else {
        throw new Error('Invalid format');
      }

      const count = flattenAll(importedTopics).length;
      if (!confirm(`Import ${importedTopics.length} topic(s) (${count} total with sub-topics) into ${importedQuarter}?`)) return;

      if (importedQuarter !== activeQuarter) {
        activeQuarter = importedQuarter;
        renderQuarterSelector();
      }

      topics = importedTopics;
      saveData(topics);
      showQueueView();
      renderTree();
    } catch {
      alert('Failed to import: invalid JSON file.');
    }
  };
  reader.readAsText(file);
  importFileInput.value = '';
});

// ── Quarter Navigation ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const prevBtn = document.querySelector('.quarter-prev');
  const nextBtn = document.querySelector('.quarter-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      switchQuarter(prevQuarter(activeQuarter));
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      switchQuarter(nextQuarter(activeQuarter));
    });
  }
});

// ── Keyboard shortcuts ─────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Escape closes detail view
  if (e.key === 'Escape' && detailView.classList.contains('active')) {
    if (document.activeElement === detailTitle ||
        document.activeElement === detailDesc ||
        document.activeElement === detailNotes) {
      document.activeElement.blur();
      return;
    }
    document.getElementById('btn-back').click();
  }
});

// ── Init ───────────────────────────────────────────────────
async function init() {
  // Load index to know available quarters
  const index = await loadIndex();
  availableQuarters = index.quarters || [getCurrentQuarter()];

  // Try loading from localStorage first (has latest edits), then from file
  let data = loadFromStorage(activeQuarter);
  if (!data) {
    data = await loadFromFile(activeQuarter);
    if (data) saveToStorage(activeQuarter, data);
  }

  // Migrate legacy data if nothing found
  if (!data) {
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        data = JSON.parse(legacy);
        saveToStorage(activeQuarter, data);
      }
    } catch { /* ignore */ }
  }

  topics = data || [];

  renderQuarterSelector();
  renderTree();
  renderQueue();
  updateSyncIndicator(false);
}

init();
