// PCB-Control: own tooltips for elements with a "title" attribute.
//
// On macOS 26 the native tooltips of Electron 44 don't appear at all, so the help texts
// (e.g. the question marks in the heightmap settings) are invisible. This script draws the
// tooltip itself. It only runs on macOS; Windows and Linux keep their native tooltips.
//
// While the mouse is over an element, its "title" attribute (and the <title> child that
// FontAwesome adds to its SVG icons) is taken away so that no second, native tooltip
// appears where native tooltips still work (macOS 15). Both are put back on mouse out.
// Nothing here sends anything to the machine.

(function() {
  if (!/Mac/.test(navigator.platform)) {
    return;
  }

  const SHOW_DELAY_MS = 500;
  const OFFSET_PX = 16;

  const style = document.createElement('style');
  style.textContent = `
    #pcbTooltip {
      position: fixed;
      z-index: 100000;
      max-width: 340px;
      padding: 5px 8px;
      background: #333;
      color: #fff;
      font-size: 12px;
      line-height: 1.4;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      white-space: pre-line;
      pointer-events: none;
      display: none;
    }`;
  document.head.appendChild(style);

  let tip = null;
  let current = null; // element whose title we took away
  let savedTitle = '';
  let savedTitleChild = null; // <title> element of an SVG icon
  let showTimer = null;
  let mouseX = 0;
  let mouseY = 0;

  function getTip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'pcbTooltip';
      document.body.appendChild(tip);
    }
    return tip;
  }

  function position() {
    const t = getTip();
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    let x = mouseX + OFFSET_PX;
    let y = mouseY + OFFSET_PX;
    if (x + w > window.innerWidth - 4) x = Math.max(4, window.innerWidth - w - 4);
    if (y + h > window.innerHeight - 4) y = Math.max(4, mouseY - h - 8);
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }

  function restore() {
    clearTimeout(showTimer);
    showTimer = null;
    if (tip) tip.style.display = 'none';
    if (current) {
      // keep a title that other code may have set in the meantime
      if (!current.hasAttribute('title')) current.setAttribute('title', savedTitle);
      if (savedTitleChild && !savedTitleChild.parentNode) current.insertBefore(savedTitleChild, current.firstChild);
    }
    current = null;
    savedTitle = '';
    savedTitleChild = null;
  }

  function take(el) {
    current = el;
    savedTitle = el.getAttribute('title');
    el.removeAttribute('title');
    if (el instanceof SVGElement) {
      const child = el.querySelector(':scope > title');
      if (child) {
        savedTitleChild = child;
        child.remove();
      }
    }
    showTimer = setTimeout(() => {
      const t = getTip();
      t.textContent = savedTitle;
      t.style.display = 'block';
      position();
    }, SHOW_DELAY_MS);
  }

  document.addEventListener('mouseover', (e) => {
    if (current && current.contains(e.target)) return; // still inside the current element
    const el = e.target instanceof Element ? e.target.closest('[title]') : null;
    restore();
    if (el && el.getAttribute('title')) take(el);
  }, true);

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (tip && tip.style.display === 'block') position();
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (current && !current.contains(e.relatedTarget)) restore();
  }, true);

  // hide while clicking, scrolling or typing, like native tooltips
  ['mousedown', 'wheel', 'keydown'].forEach((type) => {
    document.addEventListener(type, () => {
      clearTimeout(showTimer);
      if (tip) tip.style.display = 'none';
    }, true);
  });
  window.addEventListener('blur', restore);
})();
