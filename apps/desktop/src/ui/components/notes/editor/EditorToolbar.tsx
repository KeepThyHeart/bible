import React from 'react';
import { Editor } from '@tiptap/react';
import { useI18n } from '../../../contexts/useI18n';
import ToolbarMenu from './ToolbarMenu';

/**
 * The four ways a finished note leaves the app. They are the host's, not the
 * editor's - a bare `NoteEditor` has no file to print - so the toolbar renders
 * the menu only when it is handed the whole set.
 */
export interface NoteExportActions {
  onPrint: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onExportMarkdown: () => void;
}

interface EditorToolbarProps {
  editor: Editor | null;
  onInsertPassage?: () => void;
  onInsertImage?: () => void;
  /**
   * Print / PDF / Word / Markdown. Until this existed the four lived only in
   * the editor's collapsed sidebar, which is why nobody found them: the user
   * looking for "print this" looks at the toolbar.
   */
  exportActions?: NoteExportActions;
}

const fontFamilies = [
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Merriweather', value: 'Merriweather, serif' },
  { label: 'Crimson Text', value: '"Crimson Text", serif' },
  { label: 'Libre Baskerville', value: '"Libre Baskerville", serif' },
];

const fontSizes = ['10px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px'];

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editor,
  onInsertPassage,
  onInsertImage,
  exportActions,
}) => {
  const { t } = useI18n();
  if (!editor) return null;

  // The swatch shows the exact colour the mark applies, so the fill comes from
  // `color` rather than a Tailwind palette class (which would be frozen to the
  // light theme and is banned for UI chrome).
  const highlightColors = [
    { name: 'yellow', label: t('editorToolbar.highlightColor.yellow'), color: '#fef08a' },
    { name: 'green', label: t('editorToolbar.highlightColor.green'), color: '#bbf7d0' },
    { name: 'blue', label: t('editorToolbar.highlightColor.blue'), color: '#bfdbfe' },
    { name: 'pink', label: t('editorToolbar.highlightColor.pink'), color: '#fbcfe8' },
    { name: 'orange', label: t('editorToolbar.highlightColor.orange'), color: '#fed7aa' },
  ];

  const [showHighlightPicker, setShowHighlightPicker] = React.useState(false);
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [showTableMenu, setShowTableMenu] = React.useState(false);
  const [showListMenu, setShowListMenu] = React.useState(false);
  const [showExportMenu, setShowExportMenu] = React.useState(false);

  const listStyles = [
    { label: t('editorToolbar.listStyle.decimal'), style: 'decimal' },
    { label: t('editorToolbar.listStyle.lowerAlpha'), style: 'lower-alpha' },
    { label: t('editorToolbar.listStyle.upperAlpha'), style: 'upper-alpha' },
    { label: t('editorToolbar.listStyle.lowerRoman'), style: 'lower-roman' },
    { label: t('editorToolbar.listStyle.upperRoman'), style: 'upper-roman' },
  ];

  const textColors = [
    { name: 'default', label: t('editorToolbar.textColor.default'), color: '' },
    { name: 'red', label: t('editorToolbar.textColor.red'), color: '#dc2626' },
    { name: 'blue', label: t('editorToolbar.textColor.blue'), color: '#2563eb' },
    { name: 'green', label: t('editorToolbar.textColor.green'), color: '#16a34a' },
    { name: 'purple', label: t('editorToolbar.textColor.purple'), color: '#9333ea' },
    { name: 'orange', label: t('editorToolbar.textColor.orange'), color: '#ea580c' },
    { name: 'gray', label: t('editorToolbar.textColor.gray'), color: '#6b7280' },
  ];

  const btnClass = (isActive: boolean, isDisabled?: boolean) =>
    `p-1.5 rounded hover:bg-background-active transition-colors ${
      isActive ? 'bg-background-active' : ''
    }${isDisabled ? ' opacity-40 cursor-not-allowed' : ''}`;

  // Get current font family from editor state
  const currentFontFamily = editor.getAttributes('textStyle').fontFamily || '';
  const currentFontSize = editor.getAttributes('textStyle').fontSize || '';

  // Character count from the extension storage
  const charCount = editor.storage.characterCount;
  const words = charCount?.words() ?? 0;
  const characters = charCount?.characters() ?? 0;

  return (
    <div className="flex flex-col border-b border-border bg-surface-secondary">
      <div className="flex items-center gap-1 px-2 py-1 flex-wrap">
        {/* Undo */}
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className={btnClass(false, !editor.can().undo())}
          title={t('editorToolbar.undoTitle')}
          aria-label={t('editorToolbar.undoTitle')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
          </svg>
        </button>

        {/* Redo */}
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className={btnClass(false, !editor.can().redo())}
          title={t('editorToolbar.redoTitle')}
          aria-label={t('editorToolbar.redoTitle')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
          </svg>
        </button>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Font Family */}
        <select
          value={currentFontFamily}
          onChange={(e) => {
            if (e.target.value) {
              editor.chain().focus().setFontFamily(e.target.value).run();
            } else {
              editor.chain().focus().unsetFontFamily().run();
            }
          }}
          className="h-7 text-xs border border-border-secondary rounded bg-surface px-1 max-w-[110px]"
          title={t('editorToolbar.fontFamilyTitle')}
          aria-label={t('editorToolbar.fontFamilyTitle')}
        >
          <option value="">{t('editorToolbar.defaultFont')}</option>
          {fontFamilies.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Font Size */}
        <select
          value={currentFontSize}
          onChange={(e) => {
            if (e.target.value) {
              editor.chain().focus().setFontSize(e.target.value).run();
            } else {
              editor.chain().focus().unsetFontSize().run();
            }
          }}
          className="h-7 text-xs border border-border-secondary rounded bg-surface px-1 w-[60px]"
          title={t('editorToolbar.fontSizeTitle')}
          aria-label={t('editorToolbar.fontSizeTitle')}
        >
          <option value="">{t('editorToolbar.defaultSize')}</option>
          {fontSizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Headings */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={btnClass(editor.isActive('heading', { level: 1 }))}
          title={t('editorToolbar.heading1Title')}
          aria-label={t('editorToolbar.heading1Title')}
          aria-pressed={editor.isActive('heading', { level: 1 })}
        >
          <span className="text-xs font-bold w-4 h-4 flex items-center justify-center" aria-hidden="true">H1</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btnClass(editor.isActive('heading', { level: 2 }))}
          title={t('editorToolbar.heading2Title')}
          aria-label={t('editorToolbar.heading2Title')}
          aria-pressed={editor.isActive('heading', { level: 2 })}
        >
          <span className="text-xs font-bold w-4 h-4 flex items-center justify-center" aria-hidden="true">H2</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={btnClass(editor.isActive('heading', { level: 3 }))}
          title={t('editorToolbar.heading3Title')}
          aria-label={t('editorToolbar.heading3Title')}
          aria-pressed={editor.isActive('heading', { level: 3 })}
        >
          <span className="text-xs font-bold w-4 h-4 flex items-center justify-center" aria-hidden="true">H3</span>
        </button>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Bold */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btnClass(editor.isActive('bold'))}
          title={t('editorToolbar.boldTitle')}
          aria-label={t('editorToolbar.boldTitle')}
          aria-pressed={editor.isActive('bold')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
          </svg>
        </button>

        {/* Italic */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btnClass(editor.isActive('italic'))}
          title={t('editorToolbar.italicTitle')}
          aria-label={t('editorToolbar.italicTitle')}
          aria-pressed={editor.isActive('italic')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
          </svg>
        </button>

        {/* Underline */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={btnClass(editor.isActive('underline'))}
          title={t('editorToolbar.underlineTitle')}
          aria-label={t('editorToolbar.underlineTitle')}
          aria-pressed={editor.isActive('underline')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
          </svg>
        </button>

        {/* Strikethrough */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={btnClass(editor.isActive('strike'))}
          title={t('editorToolbar.strikethroughTitle')}
          aria-label={t('editorToolbar.strikethroughTitle')}
          aria-pressed={editor.isActive('strike')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/>
          </svg>
        </button>

        {/* Subscript */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          className={btnClass(editor.isActive('subscript'))}
          title={t('editorToolbar.subscriptTitle')}
          aria-label={t('editorToolbar.subscriptTitle')}
          aria-pressed={editor.isActive('subscript')}
        >
          <span className="text-xs w-4 h-4 flex items-center justify-center" aria-hidden="true">X<sub className="text-[8px]">2</sub></span>
        </button>

        {/* Superscript */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          className={btnClass(editor.isActive('superscript'))}
          title={t('editorToolbar.superscriptTitle')}
          aria-label={t('editorToolbar.superscriptTitle')}
          aria-pressed={editor.isActive('superscript')}
        >
          <span className="text-xs w-4 h-4 flex items-center justify-center" aria-hidden="true">X<sup className="text-[8px]">2</sup></span>
        </button>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Text Alignment */}
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={btnClass(editor.isActive({ textAlign: 'left' }))}
          title={t('editorToolbar.alignLeftTitle')}
          aria-label={t('editorToolbar.alignLeftTitle')}
          aria-pressed={editor.isActive({ textAlign: 'left' })}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={btnClass(editor.isActive({ textAlign: 'center' }))}
          title={t('editorToolbar.alignCenterTitle')}
          aria-label={t('editorToolbar.alignCenterTitle')}
          aria-pressed={editor.isActive({ textAlign: 'center' })}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={btnClass(editor.isActive({ textAlign: 'right' }))}
          title={t('editorToolbar.alignRightTitle')}
          aria-label={t('editorToolbar.alignRightTitle')}
          aria-pressed={editor.isActive({ textAlign: 'right' })}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z"/>
          </svg>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          className={btnClass(editor.isActive({ textAlign: 'justify' }))}
          title={t('editorToolbar.justifyTitle')}
          aria-label={t('editorToolbar.justifyTitle')}
          aria-pressed={editor.isActive({ textAlign: 'justify' })}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z"/>
          </svg>
        </button>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Highlight with color picker */}
        <ToolbarMenu
          open={showHighlightPicker}
          onMouseLeave={() => setShowHighlightPicker(false)}
          label={t('editorToolbar.highlightMenuLabel')}
          panelClassName="p-2 flex gap-1"
          trigger={
            <button
              type="button"
              onClick={() => setShowHighlightPicker(!showHighlightPicker)}
              className={`p-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-1 ${
                editor.isActive('highlight') ? 'bg-background-active' : ''
              }`}
              title={t('editorToolbar.highlightTitle')}
              aria-label={t('editorToolbar.highlightTitle')}
              aria-haspopup="menu"
              aria-expanded={showHighlightPicker}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M15.75 2a1 1 0 0 1 .707.293l5.25 5.25a1 1 0 0 1 0 1.414l-9.5 9.5a1 1 0 0 1-.707.293H6.25a1 1 0 0 1-1-1v-5.25a1 1 0 0 1 .293-.707l9.5-9.5A1 1 0 0 1 15.75 2zm-.5 2.914L7.25 12.914V16.5h3.586l8-8L15.25 4.914zM2 20a1 1 0 0 1 1-1h18a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1z"/>
              </svg>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
          }
        >
          {highlightColors.map((c) => (
            <button
              key={c.name}
              type="button"
              role="menuitem"
              onClick={() => {
                editor.chain().focus().toggleHighlight({ color: c.color }).run();
                setShowHighlightPicker(false);
              }}
              className="w-6 h-6 rounded border border-border-secondary hover:scale-110 transition-transform"
              style={{ backgroundColor: c.color }}
              title={c.label}
              aria-label={c.label}
            />
          ))}
          {editor.isActive('highlight') && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                editor.chain().focus().unsetHighlight().run();
                setShowHighlightPicker(false);
              }}
              className="w-6 h-6 rounded border border-border-secondary bg-surface hover:bg-background-hover flex items-center justify-center text-xs"
              title={t('editorToolbar.removeHighlightTitle')}
              aria-label={t('editorToolbar.removeHighlightTitle')}
            >
              <span aria-hidden="true">{'\u2715'}</span>
            </button>
          )}
        </ToolbarMenu>

        {/* Text Color */}
        <ToolbarMenu
          open={showColorPicker}
          onMouseLeave={() => setShowColorPicker(false)}
          label={t('editorToolbar.textColorMenuLabel')}
          panelClassName="p-2 flex gap-1"
          trigger={
            <button
              type="button"
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-0.5"
              title={t('editorToolbar.textColorTitle')}
              aria-label={t('editorToolbar.textColorTitle')}
              aria-haspopup="menu"
              aria-expanded={showColorPicker}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M11 2L5.5 16h2.25l1.12-3h6.25l1.12 3h2.25L13 2h-2zm-1.38 9L12 4.67 14.38 11H9.62z"/>
                <rect x="3" y="18" width="18" height="3" rx="1" fill={editor.getAttributes('textStyle').color || 'currentColor'} />
              </svg>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
          }
        >
          {textColors.map((c) => (
            <button
              key={c.name}
              type="button"
              role="menuitem"
              onClick={() => {
                if (c.color) {
                  editor.chain().focus().setColor(c.color).run();
                } else {
                  editor.chain().focus().unsetColor().run();
                }
                setShowColorPicker(false);
              }}
              className={`w-6 h-6 rounded border border-border-secondary hover:scale-110 transition-transform flex items-center justify-center ${
                c.color ? '' : 'bg-surface'
              }`}
              style={c.color ? { backgroundColor: c.color } : undefined}
              title={c.label}
              aria-label={c.label}
            >
              {!c.color && <span className="text-xs" aria-hidden="true">A</span>}
            </button>
          ))}
        </ToolbarMenu>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Blockquote */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={btnClass(editor.isActive('blockquote'))}
          title={t('editorToolbar.blockquoteTitle')}
          aria-label={t('editorToolbar.blockquoteTitle')}
          aria-pressed={editor.isActive('blockquote')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
          </svg>
        </button>

        {/* Bullet List */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btnClass(editor.isActive('bulletList'))}
          title={t('editorToolbar.bulletListTitle')}
          aria-label={t('editorToolbar.bulletListTitle')}
          aria-pressed={editor.isActive('bulletList')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
          </svg>
        </button>

        {/* Numbered List with style picker */}
        <ToolbarMenu
          open={showListMenu}
          onMouseLeave={() => setShowListMenu(false)}
          label={t('editorToolbar.listStyleMenuLabel')}
          panelClassName="py-1 min-w-[120px]"
          trigger={
            <>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={`p-1.5 rounded hover:bg-background-active transition-colors ${
                  editor.isActive('orderedList') ? 'bg-background-active' : ''
                }`}
                title={t('editorToolbar.numberedListTitle')}
                aria-label={t('editorToolbar.numberedListTitle')}
                aria-pressed={editor.isActive('orderedList')}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
                </svg>
              </button>
              {editor.isActive('orderedList') && (
                <button
                  type="button"
                  onClick={() => setShowListMenu(!showListMenu)}
                  className="absolute -end-2.5 top-0.5 w-3 h-3 rounded-full bg-control hover:bg-control-hover flex items-center justify-center"
                  title={t('editorToolbar.listStyleTitle')}
                  aria-label={t('editorToolbar.listStyleTitle')}
                  aria-haspopup="menu"
                  aria-expanded={showListMenu}
                >
                  <svg className="w-2 h-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </button>
              )}
            </>
          }
        >
          {listStyles.map((ls) => (
            <button
              key={ls.style}
              type="button"
              role="menuitem"
              onClick={() => {
                // Apply list style via DOM attribute on the ol element
                const { view } = editor;
                const { $from } = view.state.selection;
                // Walk up to find the ordered list node
                for (let d = $from.depth; d > 0; d--) {
                  const node = $from.node(d);
                  if (node.type.name === 'orderedList') {
                    const pos = $from.before(d);
                    const dom = view.nodeDOM(pos) as HTMLElement | null;
                    if (dom && dom.tagName === 'OL') {
                      dom.setAttribute('data-list-style', ls.style);
                      dom.style.listStyleType = ls.style;
                    }
                    break;
                  }
                }
                setShowListMenu(false);
                editor.commands.focus();
              }}
              className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
            >
              {ls.label}
            </button>
          ))}
        </ToolbarMenu>

        <div className="w-px h-5 bg-border-secondary mx-1" />

        {/* Horizontal Rule */}
        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className={btnClass(false)}
          title={t('editorToolbar.horizontalRuleTitle')}
          aria-label={t('editorToolbar.horizontalRuleTitle')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M4 11h16v2H4z"/>
          </svg>
        </button>

        {/* Task List */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={btnClass(editor.isActive('taskList'))}
          title={t('editorToolbar.taskListTitle')}
          aria-label={t('editorToolbar.taskListTitle')}
          aria-pressed={editor.isActive('taskList')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M22 5.18L10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18zm-2.21 5.04c.13.57.21 1.17.21 1.78 0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8c1.58 0 3.04.46 4.28 1.25l1.44-1.44A9.9 9.9 0 0012 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10c0-1.19-.22-2.33-.6-3.39l-1.61 1.61z"/>
          </svg>
        </button>

        {/* Table */}
        <ToolbarMenu
          open={showTableMenu}
          onMouseLeave={() => setShowTableMenu(false)}
          label={t('editorToolbar.tableMenuLabel')}
          panelClassName="py-1 min-w-[140px]"
          trigger={
            <button
              type="button"
              onClick={() => setShowTableMenu(!showTableMenu)}
              className={`p-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-0.5 ${
                editor.isActive('table') ? 'bg-background-active' : ''
              }`}
              title={t('editorToolbar.tableTitle')}
              aria-label={t('editorToolbar.tableTitle')}
              aria-haspopup="menu"
              aria-expanded={showTableMenu}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z"/>
              </svg>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
          }
        >
          {!editor.isActive('table') ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                setShowTableMenu(false);
              }}
              className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
            >
              {t('editorToolbar.insertTable')}
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => { editor.chain().focus().addColumnAfter().run(); setShowTableMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
              >
                {t('editorToolbar.addColumn')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { editor.chain().focus().addRowAfter().run(); setShowTableMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
              >
                {t('editorToolbar.addRow')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { editor.chain().focus().deleteColumn().run(); setShowTableMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
              >
                {t('editorToolbar.deleteColumn')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { editor.chain().focus().deleteRow().run(); setShowTableMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
              >
                {t('editorToolbar.deleteRow')}
              </button>
              <div className="border-t border-border my-1" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { editor.chain().focus().deleteTable().run(); setShowTableMenu(false); }}
                className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover text-danger"
              >
                {t('editorToolbar.deleteTable')}
              </button>
            </>
          )}
        </ToolbarMenu>

        {/* Image - a stock editor action like the table beside it, not a
            Bible-specific one, so it belongs in the formatting row rather
            than on the insert row with "+ Bible Passage". */}
        <button
          type="button"
          onClick={onInsertImage}
          className="p-1.5 rounded hover:bg-background-active transition-colors"
          title={t('editorToolbar.insertImageTitle')}
          aria-label={t('editorToolbar.insertImageTitle')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
          </svg>
        </button>

        {/* Word/Character Count - end-aligned */}
        <div className="ms-auto text-[10px] text-text-muted flex items-center gap-2 pe-1">
          <span>{t('editorToolbar.wordCount', { count: words })}</span>
          <span>{t('editorToolbar.charCount', { count: characters })}</span>
        </div>
      </div>

      {/* Insert row - content actions, not formatting.
          A bare icon at the tail of the formatting row would be
          indistinguishable from the toggles around it - wrong for the single
          most useful thing a Bible note editor can do. Inserting content is a
          different kind of action from restyling text that is already there,
          so it gets its own row with a visible text label instead of a glyph
          nobody recognises.

          Print/export sits here too, for the mirror-image reason: it acts on
          the whole document rather than on a run of text, and among nine
          formatting toggles it would read as one of them. Stock editor
          actions - image, table - stay in the formatting row above, where a
          user who knows any other editor already expects to find them. */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-border-secondary">
        <button
          type="button"
          onClick={onInsertPassage}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border border-border-secondary text-text-primary hover:bg-background-hover transition-colors"
          title={t('editorToolbar.insertPassageTitle')}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
          </svg>
          {t('editorToolbar.insertPassageLabel')}
        </button>

        {/* Print / Export - one menu, not four buttons, because a toolbar row
            of nine formatting toggles cannot absorb four more without becoming
            unreadable. It sits on the *insert* row, beside "+ Bible Passage":
            printing a note is a thing you do to the document, not a way to
            restyle a run of text, and the user reported it read as a
            formatting control while it sat among the toggles. */}
        {exportActions && (
          <ToolbarMenu
            open={showExportMenu}
            onMouseLeave={() => setShowExportMenu(false)}
            label={t('editorToolbar.exportMenuLabel')}
            panelClassName="py-1 min-w-[160px]"
            trigger={
              <button
                type="button"
                data-testid="editor-export-menu"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1.5 rounded hover:bg-background-active transition-colors flex items-center gap-0.5"
                title={t('editorToolbar.exportMenuTitle')}
                aria-label={t('editorToolbar.exportMenuTitle')}
                aria-haspopup="menu"
                aria-expanded={showExportMenu}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>
                </svg>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M7 10l5 5 5-5z"/>
                </svg>
              </button>
            }
          >
            {[
              { key: 'print', label: t('userNotesPane.printLabel'), run: exportActions.onPrint },
              {
                key: 'pdf',
                label: t('userNotesPane.exportPdfLabel'),
                run: exportActions.onExportPdf,
              },
              { key: 'docx', label: t('userNotesPane.exportDocxLabel'), run: exportActions.onExportDocx },
              {
                key: 'markdown',
                label: t('userNotesPane.exportMarkdownLabel'),
                run: exportActions.onExportMarkdown,
              },
            ].map(item => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-testid={`editor-export-${item.key}`}
                onClick={() => { setShowExportMenu(false); item.run(); }}
                className="w-full px-3 py-1.5 text-xs text-start hover:bg-background-hover"
              >
                {item.label}
              </button>
            ))}
          </ToolbarMenu>
        )}
      </div>
    </div>
  );
};

export default EditorToolbar;
