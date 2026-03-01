// ===== Miri Syntax Highlighter =====

const MIRI_KEYWORDS = new Set([
  'fn', 'let', 'var', 'if', 'else', 'match', 'for', 'in', 'while',
  'use', 'struct', 'enum', 'return', 'break', 'continue', 'forever',
  'until', 'unless', 'do', 'const', 'gpu', 'async', 'await', 'spawn',
  'parallel', 'not', 'and', 'or', 'type', 'impl', 'trait', 'pub',
  'import', 'from', 'as', 'with', 'yield', 'where'
]);

const MIRI_TYPES = new Set([
  'int', 'float', 'bool', 'string', 'String', 'void',
  'i8', 'i16', 'i32', 'i64', 'i128',
  'u8', 'u16', 'u32', 'u64', 'u128',
  'f32', 'f64', 'List', 'Array', 'Map', 'Set', 'Option', 'Result'
]);

const MIRI_BOOLS = new Set(['true', 'false']);

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightMiri(code) {
  const tokenPattern = /\/\/[^\n]*|f"(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+\.?\d*\b|[a-zA-Z_]\w*/g;
  let result = '';
  let lastIndex = 0;

  for (const match of code.matchAll(tokenPattern)) {
    result += escapeHtml(code.slice(lastIndex, match.index));
    const token = match[0];

    if (token.startsWith('//')) {
      result += `<span class="hl-comment">${escapeHtml(token)}</span>`;
    } else if (token.startsWith('f"') || token.startsWith('"') || token.startsWith("'")) {
      result += `<span class="hl-string">${escapeHtml(token)}</span>`;
    } else if (/^\d/.test(token)) {
      result += `<span class="hl-number">${token}</span>`;
    } else if (MIRI_BOOLS.has(token)) {
      result += `<span class="hl-bool">${token}</span>`;
    } else if (MIRI_KEYWORDS.has(token)) {
      result += `<span class="hl-keyword">${token}</span>`;
    } else if (MIRI_TYPES.has(token)) {
      result += `<span class="hl-type">${token}</span>`;
    } else {
      result += escapeHtml(token);
    }

    lastIndex = match.index + token.length;
  }

  result += escapeHtml(code.slice(lastIndex));
  return result;
}

// ===== Apply Highlighting =====

function highlightAll() {
  document.querySelectorAll('code.language-miri').forEach(block => {
    block.innerHTML = highlightMiri(block.textContent);
  });
}

// ===== Accessible Tab Switching =====

function initTabs() {
  document.querySelectorAll('[role="tablist"]').forEach(tabBar => {
    const section = tabBar.closest('.code-section');
    const tabs = Array.from(tabBar.querySelectorAll('[role="tab"]'));
    const panels = section.querySelectorAll('[role="tabpanel"]');

    function activateTab(tab) {
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
      panels.forEach(p => p.classList.remove('active'));

      tab.setAttribute('aria-selected', 'true');
      const target = section.querySelector(`#${tab.dataset.target}`);
      if (target) target.classList.add('active');
      tab.focus();
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab));

      tab.addEventListener('keydown', e => {
        const idx = tabs.indexOf(tab);
        let next;
        if (e.key === 'ArrowRight') next = tabs[(idx + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(idx - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); activateTab(next); }
      });
    });

    // Set tabindex for keyboard navigation
    tabs.forEach((tab, i) => {
      tab.setAttribute('tabindex', i === 0 ? '0' : '-1');
    });
  });
}

// ===== Mobile Navigation =====

function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    links.classList.toggle('open');
  });
}

// ===== Docs Sidebar Active State =====

function initDocsSidebar() {
  const sidebar = document.querySelector('.docs-sidebar');
  if (!sidebar) return;

  const links = sidebar.querySelectorAll('a[href^="#"]');
  const sections = [];

  links.forEach(link => {
    const id = link.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) sections.push({ link, el });
  });

  function updateActive() {
    let current = sections[0];
    for (const s of sections) {
      if (s.el.getBoundingClientRect().top <= 120) {
        current = s;
      }
    }
    links.forEach(l => l.classList.remove('active'));
    if (current) current.link.classList.add('active');
  }

  window.addEventListener('scroll', updateActive, { passive: true });
  updateActive();
}

// ===== Init =====

document.addEventListener('DOMContentLoaded', () => {
  highlightAll();
  initTabs();
  initMobileNav();
  initDocsSidebar();
});
