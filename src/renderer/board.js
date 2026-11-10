// Research board: turns panel lines (one JSON object per line) into floating
// panels wired to the centre "subject" panel.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');

  // One renderer per panel type. Add a new type here to teach the HUD a new panel.
  const RENDER = {
    subject: (p) => `<h2>${esc(p.title)}</h2>${p.subtitle ? `<div class="subtitle">${esc(p.subtitle)}</div>` : ''}`,
    note: (p) => `<h4>${esc(p.title || 'Note')}</h4><p>${esc(p.text)}</p>`,
    stat: (p) => `<h4>${esc(p.label || p.title)}</h4><div><span class="value">${esc(p.value)}</span><span class="unit">${esc(p.unit || '')}</span></div>`,
    list: (p) => `<h4>${esc(p.title || 'List')}</h4><ul>${(p.items || []).map((i) => `<li>${esc(typeof i === 'object' ? i.text || i.label : i)}</li>`).join('')}</ul>`,
    steps: (p) => `<h4>${esc(p.title || 'Steps')}</h4><ol>${(p.items || []).map((i) => `<li>${esc(typeof i === 'object' ? i.text || i.label : i)}</li>`).join('')}</ol>`,
    bars: (p) => `<h4>${esc(p.title || '')}</h4>${(p.items || []).map((b) => {
      const max = Number(b.max) || 100, v = Number(b.value) || 0, pct = Math.max(0, Math.min(100, (v / max) * 100));
      return `<div class="bar"><span>${esc(b.label)}</span><div class="track"><div class="fill" style="width:${pct}%"></div></div><span>${esc(b.value)}</span></div>`;
    }).join('')}`,
    table: (p) => `<h4>${esc(p.title || '')}</h4><table><thead><tr>${(p.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
      (p.rows || []).map((r) => `<tr>${(r || []).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    warn: (p) => `<h4>⚠ ${esc(p.title || 'Warning')}</h4><p>${esc(p.text)}</p>`,
    links: (p) => `<h4>${esc(p.title || 'Links')}</h4><ul>${(p.items || []).map((l) => `<li><a href="${esc(safeUrl(l.url))}" data-url="${esc(safeUrl(l.url))}">${esc(l.label || l.url)}</a></li>`).join('')}</ul>`,
  };

  const board = document.getElementById('board');
  const host = document.getElementById('board-panels');
  const wires = document.getElementById('wires');
  let nodes = [];

  function layout() {
    const w = board.clientWidth, h = board.clientHeight;
    const cx = w / 2, cy = h / 2;
    const others = nodes.filter((n) => !n.isSubject);
    const rx = Math.max(260, w / 2 - 190), ry = Math.max(170, h / 2 - 120);
    others.forEach((n, i) => {
      if (n.dragged) return;
      // spread panels around an ellipse, starting top-left, skipping straight up/down
      const a = -Math.PI * 0.82 + (i / Math.max(1, others.length)) * Math.PI * 2;
      n.x = cx + Math.cos(a) * rx;
      n.y = cy + Math.sin(a) * ry;
    });
    const subject = nodes.find((n) => n.isSubject);
    if (subject && !subject.dragged) { subject.x = cx; subject.y = cy; }
    nodes.forEach((n) => { n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px'; });
    drawWires();
  }

  function drawWires() {
    const subject = nodes.find((n) => n.isSubject);
    if (!subject) { wires.innerHTML = ''; return; }
    const br = board.getBoundingClientRect();
    const centre = (n) => { const r = n.el.getBoundingClientRect(); return [r.left - br.left + r.width / 2, r.top - br.top + r.height / 2]; };
    const [sx, sy] = centre(subject);
    wires.innerHTML = nodes.filter((n) => !n.isSubject).map((n) => {
      const [x, y] = centre(n);
      return `<line x1="${sx}" y1="${sy}" x2="${x}" y2="${y}"/><circle cx="${x}" cy="${y}" r="3"/>`;
    }).join('') + `<circle cx="${sx}" cy="${sy}" r="4"/>`;
  }

  function makeDraggable(n) {
    n.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a')) return;
      const startX = e.clientX, startY = e.clientY, ox = n.x, oy = n.y;
      n.el.setPointerCapture(e.pointerId);
      const move = (ev) => { n.dragged = true; n.x = ox + ev.clientX - startX; n.y = oy + ev.clientY - startY; n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px'; drawWires(); };
      const up = () => { n.el.removeEventListener('pointermove', move); n.el.removeEventListener('pointerup', up); };
      n.el.addEventListener('pointermove', move);
      n.el.addEventListener('pointerup', up);
    });
  }

  function show(panels) {
    host.innerHTML = '';
    nodes = [];
    let list = panels.filter((p) => p.type !== 'ack' && RENDER[p.type]);
    if (!list.some((p) => p.type === 'subject')) list.unshift({ type: 'subject', title: 'Results' });
    list = list.slice(0, 11);
    list.forEach((p, i) => {
      const el = document.createElement('div');
      const wide = p.type === 'table' && (p.columns || []).length > 3;
      el.className = `panel ${p.type}${wide ? ' wide' : ''}`;
      el.innerHTML = RENDER[p.type](p);
      el.style.animationDelay = `${i * 70}ms, ${(i * 0.7) % 5}s`;
      host.appendChild(el);
      const n = { el, isSubject: p.type === 'subject', x: 0, y: 0 };
      nodes.push(n);
      makeDraggable(n);
    });
    board.hidden = false;
    document.getElementById('home').style.visibility = 'hidden';
    requestAnimationFrame(layout);
  }

  function hide() {
    board.hidden = true;
    document.getElementById('home').style.visibility = '';
  }

  host.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) { e.preventDefault(); if (a.dataset.url !== '#') window.jarvis.openUrl(a.dataset.url); }
  });
  document.getElementById('board-close').addEventListener('click', hide);
  window.addEventListener('resize', () => { if (!board.hidden) layout(); });
  // keep the wires attached while panels float
  (function tick() { if (!board.hidden) drawWires(); requestAnimationFrame(tick); })();

  window.Board = { show, hide, isOpen: () => !board.hidden };
})();
