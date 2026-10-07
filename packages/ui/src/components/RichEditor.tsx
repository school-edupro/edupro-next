'use client';
import { useEffect, useRef, useState } from 'react';

type Cmd = [label: string, title: string, run: () => void];

/**
 * The note of a file: a small formatted-text editor (paragraph or heading, bold, italic, link, quote,
 * table, lists, indent, undo). What is written goes out as HTML in a hidden field; the server cleans it.
 */
export function RichEditor({
  name,
  label,
  initial = '',
  placeholder,
}: {
  name: string;
  label: string;
  initial?: string;
  placeholder?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(initial);
  useEffect(() => {
    if (box.current && box.current.innerHTML !== initial) box.current.innerHTML = initial;
    // the starting text is set once; later typing is the editor's own
  }, []);
  const sync = () => setHtml(box.current?.innerHTML ?? '');
  const exec = (command: string, value?: string) => {
    box.current?.focus();
    document.execCommand(command, false, value);
    sync();
  };
  const table = (rows: number, cols: number) =>
    exec(
      'insertHTML',
      `<table><tbody>${`<tr>${'<td>&nbsp;</td>'.repeat(cols)}</tr>`.repeat(rows)}</tbody></table><p><br></p>`,
    );
  const link = () => {
    const url = window.prompt('Link address (https://…)');
    if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) exec('createLink', url.trim());
  };
  const tools: Cmd[] = [
    ['↶', 'Undo', () => exec('undo')],
    ['↷', 'Redo', () => exec('redo')],
    ['B', 'Bold', () => exec('bold')],
    ['I', 'Italic', () => exec('italic')],
    ['Link', 'Link', link],
    ['“ ”', 'Quote', () => exec('formatBlock', 'blockquote')],
    ['Table', 'Table of 3 columns and 3 rows', () => table(3, 3)],
    ['• List', 'Bulleted list', () => exec('insertUnorderedList')],
    ['1. List', 'Numbered list', () => exec('insertOrderedList')],
    ['⇤', 'Less indent', () => exec('outdent')],
    ['⇥', 'More indent', () => exec('indent')],
  ];
  return (
    <div className="ep-field">
      <span className="ep-field__label" id={`${name}-label`}>
        {label}
      </span>
      <div className="ep-rte">
        <div className="ep-rte__bar" role="toolbar" aria-label={`${label}: formatting`}>
          <select
            className="ep-select"
            aria-label="Paragraph style"
            defaultValue="p"
            onChange={(e) => exec('formatBlock', e.target.value)}
          >
            <option value="p">Paragraph</option>
            <option value="h2">Heading</option>
            <option value="h3">Sub-heading</option>
          </select>
          {tools.map(([text, title, run]) => (
            <button
              key={title}
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              title={title}
              aria-label={title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
            >
              {text}
            </button>
          ))}
        </div>
        <div
          ref={box}
          className="ep-rte__body ep-prose"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-labelledby={`${name}-label`}
          data-placeholder={placeholder}
          onInput={sync}
          onBlur={sync}
        />
      </div>
      <input type="hidden" name={name} value={html} />
    </div>
  );
}
