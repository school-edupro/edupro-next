'use client';
import { Image } from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';

/** Colours for text in emails (content, not app styling): the school palette and plain colours. */
const COLOURS = [
  { label: 'Default', value: '' },
  { label: 'Navy', value: '#00265d' },
  { label: 'Teal', value: '#007a99' },
  { label: 'Green', value: '#1f7a3a' },
  { label: 'Red', value: '#b42318' },
  { label: 'Orange', value: '#b54708' },
  { label: 'Grey', value: '#52606d' },
];

export interface EditorVariable {
  key: string;
  label: string;
}

function Toolbar({
  editor,
  variables,
  onSource,
}: {
  editor: Editor;
  variables: EditorVariable[];
  onSource: () => void;
}) {
  const btn = (label: string, active: boolean, run: () => void, text?: string) => (
    <button
      type="button"
      className="ep-he__btn"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {text ?? label}
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className="ep-he__toolbar" role="toolbar" aria-label="Formatting">
      {btn('Bold', editor.isActive('bold'), () => chain().toggleBold().run(), 'B')}
      {btn('Italic', editor.isActive('italic'), () => chain().toggleItalic().run(), 'I')}
      {btn('Underline', editor.isActive('underline'), () => chain().toggleUnderline().run(), 'U')}
      {btn('Strikethrough', editor.isActive('strike'), () => chain().toggleStrike().run(), 'S')}
      <span className="ep-he__sep" aria-hidden="true" />
      {btn(
        'Heading',
        editor.isActive('heading', { level: 2 }),
        () => chain().toggleHeading({ level: 2 }).run(),
        'H2',
      )}
      {btn(
        'Subheading',
        editor.isActive('heading', { level: 3 }),
        () => chain().toggleHeading({ level: 3 }).run(),
        'H3',
      )}
      {btn(
        'Bulleted list',
        editor.isActive('bulletList'),
        () => chain().toggleBulletList().run(),
        '• List',
      )}
      {btn(
        'Numbered list',
        editor.isActive('orderedList'),
        () => chain().toggleOrderedList().run(),
        '1. List',
      )}
      <span className="ep-he__sep" aria-hidden="true" />
      {btn(
        'Align left',
        editor.isActive({ textAlign: 'left' }),
        () => chain().setTextAlign('left').run(),
        'Left',
      )}
      {btn(
        'Align centre',
        editor.isActive({ textAlign: 'center' }),
        () => chain().setTextAlign('center').run(),
        'Centre',
      )}
      {btn(
        'Align right',
        editor.isActive({ textAlign: 'right' }),
        () => chain().setTextAlign('right').run(),
        'Right',
      )}
      <span className="ep-he__sep" aria-hidden="true" />
      {btn('Link', editor.isActive('link'), () => {
        const prev = (editor.getAttributes('link').href as string | undefined) ?? 'https://';
        const url = window.prompt('Link address', prev);
        if (url === null) return;
        if (!url || url === 'https://') chain().unsetLink().run();
        else chain().extendMarkRange('link').setLink({ href: url }).run();
      })}
      {btn(
        'Image from a web address',
        false,
        () => {
          const url = window.prompt('Image address (https://...)', 'https://');
          if (url && /^https:\/\//.test(url)) chain().setImage({ src: url }).run();
        },
        'Image',
      )}
      {btn(
        'Button link',
        false,
        () => {
          const url = window.prompt('Button link (https://...)', 'https://');
          if (!url || !/^https?:\/\//.test(url)) return;
          const label = window.prompt('Button text', 'Open') ?? 'Open';
          chain()
            .insertContent(
              `<p><a href="${url.replace(/"/g, '%22')}" style="display:inline-block;padding:10px 18px;background:#00265d;color:#ffffff;border-radius:6px;text-decoration:none">${label.replace(/</g, '&lt;')}</a></p>`,
            )
            .run();
        },
        'Button',
      )}
      {btn(
        'Insert table',
        false,
        () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        'Table',
      )}
      {editor.isActive('table') ? (
        <>
          {btn('Add row', false, () => chain().addRowAfter().run(), '+Row')}
          {btn('Add column', false, () => chain().addColumnAfter().run(), '+Col')}
          {btn('Delete table', false, () => chain().deleteTable().run(), '−Table')}
        </>
      ) : null}
      <label className="ep-he__select">
        <span className="ep-sr-only">Text colour</span>
        <select
          aria-label="Text colour"
          value={(editor.getAttributes('textStyle').color as string | undefined) ?? ''}
          onChange={(e) =>
            e.target.value ? chain().setColor(e.target.value).run() : chain().unsetColor().run()
          }
        >
          {COLOURS.map((c) => (
            <option key={c.label} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {variables.length ? (
        <label className="ep-he__select">
          <span className="ep-sr-only">Insert a variable</span>
          <select
            aria-label="Insert a variable"
            value=""
            onChange={(e) => {
              if (e.target.value) chain().insertContent(`{{${e.target.value}}}`).run();
            }}
          >
            <option value="">Insert variable…</option>
            {variables.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label} — {`{{${v.key}}}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {btn('Edit the HTML source', false, onSource, 'HTML')}
    </div>
  );
}

/**
 * Word-like editor for email (communication v2): formatting, lists, alignment, links, images by web
 * address, button links, tables, colours, a variable picker that inserts {{variable}}, and an HTML
 * tab to paste or edit the source. The value is HTML; the API sanitises it again.
 */
export function HtmlEditor({
  id,
  name,
  label,
  value,
  onChange,
  variables = [],
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (html: string) => void;
  variables?: EditorVariable[];
}) {
  const [source, setSource] = useState(false);
  const [html, setHtml] = useState(value);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        id,
        class: 'ep-he__content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
    },
    onUpdate: ({ editor: e }) => {
      const out = e.getHTML();
      setHtml(out);
      onChange(out);
    },
  });
  // a template or draft loaded after mount
  useEffect(() => {
    if (editor && value !== html) {
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
      setHtml(value);
    }
  }, [value, editor]);

  return (
    <div className="ep-he">
      <span className="ep-field__label" id={`${id}-label`}>
        {label}
      </span>
      {editor && !source ? (
        <Toolbar editor={editor} variables={variables} onSource={() => setSource(true)} />
      ) : null}
      {source ? (
        <>
          <textarea
            className="ep-input ep-he__source"
            aria-label={`${label} (HTML source)`}
            rows={14}
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              onChange(e.target.value);
            }}
          />
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => {
              editor?.commands.setContent(html || '<p></p>', { emitUpdate: false });
              setSource(false);
            }}
          >
            Back to the editor
          </button>
        </>
      ) : (
        <EditorContent editor={editor} className="ep-he__frame" />
      )}
      {name ? <input type="hidden" name={name} value={html} /> : null}
    </div>
  );
}
