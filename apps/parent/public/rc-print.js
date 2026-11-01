/*
 * The report card page's Print / Save as PDF (1 Nov 2026): a button at the top (left out of the print)
 * and, with data-auto="1", the browser's print dialog once the card has loaded, where "Save as PDF"
 * makes the file without waiting for the PDF service. A file, not inline, so the page's CSP allows it.
 */
(function () {
  var me = document.currentScript;
  var label = (me && me.getAttribute('data-label')) || 'Print / Save as PDF';
  var auto = me && me.getAttribute('data-auto') === '1';
  var style = document.createElement('style');
  style.textContent =
    '.rc-print-bar{position:sticky;top:0;display:flex;justify-content:flex-end;padding:8px 12px;background:#F5F7FA;border-bottom:1px solid #CBD2D9;z-index:9}' +
    '.rc-print-bar button{font:600 14px/1.2 "Source Sans 3",Arial,sans-serif;padding:8px 16px;border:0;border-radius:6px;background:#00265D;color:#fff;cursor:pointer}' +
    '.rc-print-bar button:focus-visible{outline:2px solid #00A7C4;outline-offset:2px}' +
    '@media print{.rc-print-bar{display:none}}';
  document.head.appendChild(style);
  var bar = document.createElement('div');
  bar.className = 'rc-print-bar';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', function () {
    window.print();
  });
  bar.appendChild(btn);
  document.body.insertBefore(bar, document.body.firstChild);
  if (auto)
    window.addEventListener('load', function () {
      setTimeout(function () {
        window.print();
      }, 300);
    });
})();
