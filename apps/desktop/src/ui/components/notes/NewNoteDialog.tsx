import React, { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

function buildTemplates(t: (key: string) => string): NoteTemplate[] {
  const verseStudy =
    '<h2>' + t('newNoteDialog.tplVerseStudy.heading') + '</h2>' +
    '<p><strong>' + t('newNoteDialog.tplVerseStudy.passageLabel') + '</strong> </p>' +
    '<h3>' + t('newNoteDialog.tplVerseStudy.observations') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplVerseStudy.interpretation') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplVerseStudy.application') + '</h3><p></p>';

  const expository =
    '<h1>' + t('newNoteDialog.tplExpository.title') + '</h1>' +
    '<p><strong>' + t('newNoteDialog.tplExpository.textLabel') + '</strong> </p>' +
    '<p><strong>' + t('newNoteDialog.tplExpository.themeLabel') + '</strong> </p>' +
    '<hr><h2>' + t('newNoteDialog.tplExpository.introduction') + '</h2><p></p>' +
    '<h2>' + t('newNoteDialog.tplExpository.firstPoint') + '</h2><p></p>' +
    '<h2>' + t('newNoteDialog.tplExpository.secondPoint') + '</h2><p></p>' +
    '<h2>' + t('newNoteDialog.tplExpository.thirdPoint') + '</h2><p></p>' +
    '<h2>' + t('newNoteDialog.tplExpository.conclusion') + '</h2><p></p>';

  const topical =
    '<h1>' + t('newNoteDialog.tplTopical.topicLabel') + '</h1>' +
    '<h3>' + t('newNoteDialog.tplTopical.keyVerses') + '</h3><ul><li></li></ul>' +
    '<h3>' + t('newNoteDialog.tplTopical.oldTestament') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplTopical.newTestament') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplTopical.summary') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplTopical.personalReflection') + '</h3><p></p>';

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const h2Open = '<h2' + '>';
  const devotional =
    h2Open + dateStr + '</h2>' +
    '<p><strong>' + t('newNoteDialog.tplDevotional.readingLabel') + '</strong> </p>' +
    '<h3>' + t('newNoteDialog.tplDevotional.whatDoesItSay') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplDevotional.whatDoesItMean') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplDevotional.howApply') + '</h3><p></p>' +
    '<h3>' + t('newNoteDialog.tplDevotional.prayer') + '</h3><p></p>';

  return [
    {
      id: 'blank',
      name: t('newNoteDialog.tplBlank.name'),
      description: t('newNoteDialog.tplBlank.description'),
      content: '',
    },
    {
      id: 'verse-study',
      name: t('newNoteDialog.tplVerseStudy.name'),
      description: t('newNoteDialog.tplVerseStudy.description'),
      content: verseStudy,
    },
    {
      id: 'expository',
      name: t('newNoteDialog.tplExpository.name'),
      description: t('newNoteDialog.tplExpository.description'),
      content: expository,
    },
    {
      id: 'topical',
      name: t('newNoteDialog.tplTopical.name'),
      description: t('newNoteDialog.tplTopical.description'),
      content: topical,
    },
    {
      id: 'devotional',
      name: t('newNoteDialog.tplDevotional.name'),
      description: t('newNoteDialog.tplDevotional.description'),
      content: devotional,
    },
  ];
}

interface NewNoteDialogProps {
  isOpen: boolean;
  onConfirm: (title: string, templateContent: string) => void;
  onCancel: () => void;
}

const NewNoteDialog: React.FC<NewNoteDialogProps> = ({ isOpen, onConfirm, onCancel }) => {
  const { t } = useI18n();
  // Contains Tab within the dialog while it is open, and restores focus after.
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);
  const [title, setTitle] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank');

  const templates = useMemo(() => buildTemplates(t), [t]);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setSelectedTemplate('blank');
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (!title.trim()) return;
    const template = templates.find(tpl => tpl.id === selectedTemplate) || templates[0];
    onConfirm(title.trim(), template.content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-background-overlay z-40" aria-hidden="true" onClick={onCancel} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-lg">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-note-dialog-title"
          className="bg-surface rounded-lg shadow-xl max-w-md w-full"
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancel();
            }
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-xl py-lg border-b border-border">
            <h2 id="new-note-dialog-title" className="text-lg font-bold text-text-heading">{t('newNoteDialog.headerTitle')}</h2>
            <button
              type="button"
              onClick={onCancel}
              className="p-1 hover:bg-background-active rounded transition-colors"
              aria-label={t('newNoteDialog.closeTitle')}
            >
              <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-xl py-lg">
            <label htmlFor="new-note-title" className="block text-sm font-semibold text-text-heading mb-xs">{t('newNoteDialog.titleLabel')}</label>
            <input
              id="new-note-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('newNoteDialog.titlePlaceholder')}
              className="w-full px-sm py-sm text-sm border border-border rounded focus:border-accent focus:ring-2 focus:ring-accent/30"
              autoFocus
            />

            <div id="new-note-template-label" className="block text-sm font-semibold text-text-heading mt-4 mb-xs">{t('newNoteDialog.templateLabel')}</div>
            <div className="space-y-1 max-h-48 overflow-y-auto" role="radiogroup" aria-labelledby="new-note-template-label">
              {templates.map(tpl => (
                <label
                  key={tpl.id}
                  className={`flex items-start gap-2 p-2 rounded cursor-pointer transition-colors ${
                    selectedTemplate === tpl.id ? 'bg-accent-light border border-accent-soft' : 'hover:bg-background-hover border border-transparent'
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={tpl.id}
                    checked={selectedTemplate === tpl.id}
                    onChange={() => setSelectedTemplate(tpl.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-text-heading">{tpl.name}</div>
                    <div className="text-xs text-text-secondary">{tpl.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-sm px-xl py-lg border-t border-border bg-background-warm">
            <button
              type="button"
              onClick={onCancel}
              className="px-lg py-sm text-sm border border-border rounded hover:bg-background-hover transition-colors"
            >
              {t('newNoteDialog.cancelButton')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!title.trim()}
              className="px-lg py-sm text-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('newNoteDialog.createButton')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default NewNoteDialog;
