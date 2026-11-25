// Wireframe helper (not app code). Reads ?theme=light|dark and ?open=<state>
// from the URL, applies them, and draws the small "wireframe" bar that switches
// between them. Pages mark state-specific elements with data-show="state ...".
(function () {
  const q = new URLSearchParams(location.search);
  const theme = q.get('theme') === 'dark' ? 'dark' : 'light';
  const open = q.get('open') || document.documentElement.dataset.defaultOpen || '';
  const bare = q.has('bare'); // inside a phone frame, or for screenshots: no wireframe bar
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.dataset.open = open;

  const apply = () => {
    document.querySelectorAll('[data-show]').forEach((el) => {
      el.hidden = !el.dataset.show.split(' ').includes(open);
    });
    document.querySelectorAll('[data-pressed-when]').forEach((el) => {
      const on = el.dataset.pressedWhen.split(' ').includes(open);
      el.setAttribute('aria-expanded', on ? 'true' : 'false');
      el.classList.toggle('is-open', on);
    });
    // Phone frames on the mobile page pass the theme on.
    document.querySelectorAll('iframe[data-src]').forEach((f) => {
      f.src = `${f.dataset.src}${f.dataset.src.includes('?') ? '&' : '?'}theme=${theme}&bare`;
    });
    if (bare) return;
    const states = (document.documentElement.dataset.states || '').split(',').filter(Boolean);
    const link = (o, t, label, on) => `<a href="?open=${o}&theme=${t}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
    const bar = document.createElement('nav');
    bar.className = 'wf-bar';
    bar.setAttribute('aria-label', 'Wireframe controls');
    bar.innerHTML =
      `<a href="index.html" class="wf-bar__home">Wireframes</a>` +
      `<span class="wf-bar__group">${states.map((s) => { const [id, label] = s.split(':'); return link(id, theme, label, id === open); }).join('')}</span>` +
      `<span class="wf-bar__group">${link(open, 'light', 'Light', theme === 'light')}${link(open, 'dark', 'Dark', theme === 'dark')}</span>`;
    document.body.appendChild(bar);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
