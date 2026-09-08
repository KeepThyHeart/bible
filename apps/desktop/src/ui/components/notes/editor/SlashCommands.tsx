import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
  useRef,
} from 'react';
import { Extension, Editor, Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { useI18n } from '../../../contexts/useI18n';

// -- Command definitions -----------------------------------------------

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  /** Run when the user selects this command */
  command: (props: { editor: Editor; range: Range }) => void;
  /** Optional group label for visual separation */
  group?: string;
}

/**
 * Build the list of available slash commands.
 * `onInsertPassageBlock` and `onInsertPassageVerses` are callbacks provided by
 * the parent component so the slash menu can trigger the passage dialog.
 */
export function getSlashCommands(
  callbacks: {
    onInsertPassageBlock?: () => void;
    onInsertPassageVerses?: () => void;
    onInsertImage?: () => void;
  },
  t: (key: string) => string,
): SlashCommandItem[] {
  return [
    // -- Scripture -- (shown first for Bible-centric workflow)
    {
      title: t('slashCommands.passageBlock.title'),
      description: t('slashCommands.passageBlock.description'),
      icon: '📖',
      group: t('slashCommands.group.scripture'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        callbacks.onInsertPassageBlock?.();
      },
    },
    {
      title: t('slashCommands.passageVerses.title'),
      description: t('slashCommands.passageVerses.description'),
      icon: '📝',
      group: t('slashCommands.group.scripture'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        callbacks.onInsertPassageVerses?.();
      },
    },

    // -- Text --
    {
      title: t('slashCommands.heading1.title'),
      description: t('slashCommands.heading1.description'),
      icon: 'H1',
      group: t('slashCommands.group.text'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
      },
    },
    {
      title: t('slashCommands.heading2.title'),
      description: t('slashCommands.heading2.description'),
      icon: 'H2',
      group: t('slashCommands.group.text'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
      },
    },
    {
      title: t('slashCommands.heading3.title'),
      description: t('slashCommands.heading3.description'),
      icon: 'H3',
      group: t('slashCommands.group.text'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
      },
    },

    // -- Lists --
    {
      title: t('slashCommands.bulletList.title'),
      description: t('slashCommands.bulletList.description'),
      icon: '•',
      group: t('slashCommands.group.lists'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: t('slashCommands.numberedList.title'),
      description: t('slashCommands.numberedList.description'),
      icon: '1.',
      group: t('slashCommands.group.lists'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: t('slashCommands.taskList.title'),
      description: t('slashCommands.taskList.description'),
      icon: '☑',
      group: t('slashCommands.group.lists'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },

    // -- Blocks --
    {
      title: t('slashCommands.blockquote.title'),
      description: t('slashCommands.blockquote.description'),
      icon: '"',
      group: t('slashCommands.group.blocks'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: t('slashCommands.horizontalRule.title'),
      description: t('slashCommands.horizontalRule.description'),
      icon: '—',
      group: t('slashCommands.group.blocks'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
      },
    },
    {
      title: t('slashCommands.table.title'),
      description: t('slashCommands.table.description'),
      icon: '⊞',
      group: t('slashCommands.group.blocks'),
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      },
    },

    // -- Insert --
    {
      title: t('slashCommands.image.title'),
      description: t('slashCommands.image.description'),
      icon: '🖼',
      group: t('slashCommands.group.insert'),
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        callbacks.onInsertImage?.();
      },
    },
  ];
}

// -- React popup component ---------------------------------------------

interface CommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface CommandListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(({ items, command }, ref) => {
  const { t } = useI18n();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset selection when items change
  useEffect(() => setSelectedIndex(0), [items]);

  // Scroll selected item into view
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const selected = container.querySelector('[data-selected="true"]') as HTMLElement | null;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="slash-command-popup">
        <div className="px-3 py-2 text-xs text-text-muted">{t('ui.slashCommands.noMatches')}</div>
      </div>
    );
  }

  // Group items
  let lastGroup = '';

  return (
    <div className="slash-command-popup" ref={scrollRef}>
      {items.map((item, index) => {
        const showGroup = item.group && item.group !== lastGroup;
        if (item.group) lastGroup = item.group;

        return (
          <React.Fragment key={item.title}>
            {showGroup && (
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                {item.group}
              </div>
            )}
            <button
              className={`slash-command-item ${index === selectedIndex ? 'is-selected' : ''}`}
              data-selected={index === selectedIndex}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="slash-command-icon">{item.icon}</span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-text-muted">{item.description}</span>
              </div>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
});

CommandList.displayName = 'CommandList';

// -- TipTap Extension --------------------------------------------------

/**
 * Creates the SlashCommands extension.  Accepts callback references so the
 * slash menu can trigger the Insert Passage dialog in both modes.
 */
export function createSlashCommandsExtension(
  callbacks: {
    onInsertPassageBlock?: () => void;
    onInsertPassageVerses?: () => void;
    onInsertImage?: () => void;
  },
  t: (key: string) => string,
) {
  return Extension.create({
    name: 'slashCommands',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          allowSpaces: false,
          startOfLine: true,

          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor;
            range: Range;
            props: SlashCommandItem;
          }) => {
            props.command({ editor, range });
          },

          items: ({ query }: { query: string }) => {
            const commands = getSlashCommands(callbacks, t);
            if (!query) return commands;
            const lower = query.toLowerCase();
            return commands.filter(
              (cmd) =>
                cmd.title.toLowerCase().includes(lower) ||
                cmd.description.toLowerCase().includes(lower),
            );
          },

          render: () => {
            let component: ReactRenderer<CommandListRef> | null = null;
            let popup: TippyInstance[] | null = null;

            return {
              onStart: (props: SuggestionProps) => {
                component = new ReactRenderer(CommandList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) return;

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },

              onUpdate(props: SuggestionProps) {
                component?.updateProps(props);
                if (props.clientRect && popup?.[0]) {
                  popup[0].setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect,
                  });
                }
              },

              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },

              onExit() {
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },
        } as any,
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}
