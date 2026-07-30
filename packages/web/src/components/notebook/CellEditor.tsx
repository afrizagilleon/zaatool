import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';

export type CellEditorLanguage = 'javascript' | 'python' | 'markdown';

interface CellEditorProps {
  value: string;
  language: CellEditorLanguage;
  isDarkMode: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onRun: () => void;
  onRunAndAdvance: () => void;
  onSave: () => void;
  onBlur?: () => void;
}

/**
 * CodeMirror rather than Monaco.
 *
 * A notebook mounts one editor per cell and reorders them, and Monaco disposes
 * shared services when an instance unmounts — the next instance then fails with
 * "InstantiationService has been disposed". CodeMirror is built for many small
 * instances and survives mount/unmount, so reordering cells is safe by
 * construction rather than by workaround. Monaco still powers the canvas editor.
 *
 * It also grows with its content, which a plain textarea did not: writing a long
 * note used to mean scrolling inside a three-line box.
 */
export function CellEditor({
  value,
  language,
  isDarkMode,
  placeholder,
  autoFocus,
  onChange,
  onRun,
  onRunAndAdvance,
  onSave,
  onBlur,
}: CellEditorProps) {
  const extensions = useMemo(() => {
    const languageExtension =
      language === 'python' ? python() : language === 'markdown' ? markdown() : javascript();

    return [
      languageExtension,
      EditorView.lineWrapping,
      // Highest precedence so cell shortcuts win over CodeMirror's defaults.
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', preventDefault: true, run: () => (onRun(), true) },
          { key: 'Shift-Enter', preventDefault: true, run: () => (onRunAndAdvance(), true) },
          { key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) },
        ])
      ),
    ];
  }, [language, onRun, onRunAndAdvance, onSave]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      autoFocus={autoFocus}
      theme={isDarkMode ? oneDark : 'light'}
      extensions={extensions}
      placeholder={placeholder}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: language !== 'markdown',
        bracketMatching: language !== 'markdown',
        closeBrackets: language !== 'markdown',
        indentOnInput: language !== 'markdown',
      }}
      className="text-[12px]"
    />
  );
}
