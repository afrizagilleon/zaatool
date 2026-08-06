import { useEffect, useRef, useState } from 'react';
import { Microphone, Paperclip, Stop, X } from '@phosphor-icons/react';
import type { NotebookFile, NotebookParam } from '@zaa-tool/shared';
import { Button } from '../../ui/button';
import { useFileUpload } from '../../../hooks/useFileUpload';

/**
 * A file, chosen or recorded.
 *
 * The field's value is the descriptor the engine returns once the bytes are stored, kept
 * as JSON the way a multiple-choice field keeps its selection — so every input in this
 * form is still a string, and `toArgs` is still the only place that knows otherwise.
 *
 * The record button is not a second feature. It appears when the notebook said it accepts
 * audio, and it produces a file through exactly the same path a chosen one takes. An input
 * that declares `accept: "audio/*"` is a notebook asking for a voice note, and that is the
 * only way a page could know to offer one.
 */

/** Whether this input is asking for something you could speak into a microphone. */
function wantsAudio(input: NotebookParam): boolean {
  return (input.accept ?? '').toLowerCase().includes('audio');
}

/**
 * Why the microphone will not open, in the words that say what to do about it.
 *
 * `getUserMedia` needs a secure context. `https://` and `localhost` are secure;
 * `http://192.168.1.7:5173` is not, and the browser does not merely refuse — on most it
 * does not expose `navigator.mediaDevices` at all, so the call throws a `TypeError` about
 * a missing property and the old message called that "the microphone was not available".
 *
 * That was the sentence you would have hit on your phone, and it named neither the cause
 * nor the way round it. The way round it is real and costs nothing: a phone's file picker
 * offers its own recorder for `accept="audio/*"`, so **Choose a file** records too.
 */
function microphoneProblem(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.isSecureContext && navigator.mediaDevices) return null;

  return `Recording needs a secure connection, and this page is on ${window.location.origin}. Use “Choose a file” — your phone's picker can record — or open the app over HTTPS.`;
}

function readable(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileField({
  input,
  value,
  onChange,
  notebookId,
  shareToken,
}: {
  input: NotebookParam;
  value: string;
  onChange: (next: string) => void;
  notebookId: string;
  shareToken?: string;
}) {
  const { upload, isUploading, error } = useFileUpload(notebookId, shareToken);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const chosen: NotebookFile | null = (() => {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as NotebookFile;
      return parsed?.path ? parsed : null;
    } catch {
      return null;
    }
  })();

  // A recorder holds the microphone open. Leaving the page mid-recording must release it,
  // or the browser keeps showing the recording indicator over an app that has gone.
  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    };
  }, []);

  const keep = async (file: File) => {
    const stored = await upload(file);
    if (stored) onChange(JSON.stringify(stored));
  };

  const startRecording = async () => {
    setRecordError(null);

    // Asked before the call rather than after it fails, so the answer is the reason
    // instead of whatever exception a missing API happens to throw.
    const blocked = microphoneProblem();
    if (blocked) {
      setRecordError(blocked);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
        void keep(new File([blob], `${input.name}-${Date.now()}.${extension}`, { type: blob.type }));
        setRecording(false);
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      // Refusing the microphone is a normal answer, not a failure worth a stack trace —
      // but it is a different answer from having no microphone, and telling someone to
      // check their permissions when the device has no input is its own dead end.
      const denied = (err as Error)?.name === 'NotAllowedError';
      setRecordError(
        denied
          ? 'Recording was blocked. Allow the microphone for this site and try again.'
          : 'No microphone was available on this device.'
      );
      setRecording(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {chosen ? (
        <div className="flex items-center gap-2 border border-border px-2 py-1.5">
          <Paperclip size={13} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs">{chosen.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{readable(chosen.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={() => onChange('')}
            title="Remove"
          >
            <X size={11} />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 border border-border px-2 py-1.5 text-xs hover:bg-muted">
            <Paperclip size={13} />
            {isUploading ? 'Uploading…' : 'Choose a file'}
            <input
              type="file"
              accept={input.accept}
              className="hidden"
              disabled={isUploading || recording}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file twice still counts as a change.
                event.target.value = '';
                if (file) void keep(file);
              }}
            />
          </label>

          {wantsAudio(input) && (
            <Button
              type="button"
              variant={recording ? 'destructive' : 'outline'}
              size="sm"
              className="h-[30px] gap-1.5 text-xs"
              disabled={isUploading}
              onClick={() => {
                if (recording) recorderRef.current?.stop();
                else void startRecording();
              }}
            >
              {recording ? <Stop size={12} weight="fill" /> : <Microphone size={12} />}
              {recording ? 'Stop' : 'Record'}
            </Button>
          )}
        </div>
      )}

      {(error || recordError) && (
        <p className="text-[11px] text-status-error">{error ?? recordError}</p>
      )}
    </div>
  );
}
