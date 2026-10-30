import { useEffect, useRef, useState } from 'react';
import { Microphone, Stop } from '@phosphor-icons/react';
import { StatusMessage } from './StatusMessage';
import { supabase } from '../lib/supabase';

const MAX_RECORDING_MS = 2 * 60 * 1000;

function receiptMessage() {
  return navigator.onLine
    ? "We couldn't confirm whether Gurtu received the recording. No family memory was saved. Please try again or type instead."
    : 'You appear to be offline. The recording was not sent or saved. Please reconnect and try again or type instead.';
}

function recordingType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const preferred = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2'];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type));
}

function recordingFileName(type: string): string {
  return type.includes('mp4') ? 'family-memory.m4a' : 'family-memory.webm';
}

export function VoiceRecorder({ onTranscript }: { onTranscript: (transcript: string, requestId: string) => void }) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const durationTimerRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);

  function releaseAudio() {
    if (durationTimerRef.current !== null) window.clearTimeout(durationTimerRef.current);
    durationTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    chunksRef.current = [];
    recorderRef.current = null;
  }

  useEffect(() => releaseAudio, []);

  async function transcribe(blob: Blob) {
    if (!supabase) {
      setMessage({ text: 'Microphone transcription is unavailable until Gurtu is connected.', tone: 'error' });
      releaseAudio();
      return;
    }

    setTranscribing(true);
    setMessage(null);
    const form = new FormData();
    const requestId = crypto.randomUUID();
    form.append('file', blob, recordingFileName(blob.type));
    form.append('request_id', requestId);
    try {
      const { data, error } = await supabase.functions.invoke('transcribe-audio', { body: form });
      if (error || typeof data?.transcript !== 'string' || !data.transcript.trim()) {
        setMessage({ text: "Gurtu couldn't transcribe the recording. No family memory was saved. Please try again or type instead.", tone: 'error' });
        return;
      }
      onTranscript(data.transcript, data.request_id);
      setMessage({ text: 'Recording ready. Please check the words before saving.', tone: 'success' });
    } catch {
      setMessage({ text: receiptMessage(), tone: 'error' });
    } finally {
      form.delete('file');
      setTranscribing(false);
      releaseAudio();
    }
  }

  async function startRecording() {
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessage({ text: 'Microphone access is unavailable. You can type instead.', tone: 'error' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const type = recordingType();
      const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (audio.size === 0) {
          chunksRef.current = [];
          recorderRef.current = null;
          setMessage({ text: 'No recording was sent. Please try again or type instead.', tone: 'error' });
          return;
        }
        void transcribe(audio);
      }, { once: true });
      recorder.start(500);
      setRecording(true);
      durationTimerRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
        setRecording(false);
      }, MAX_RECORDING_MS);
    } catch {
      setMessage({ text: 'Microphone access is unavailable. You can type instead.', tone: 'error' });
      releaseAudio();
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    setRecording(false);
  }

  return (
    <div className="voice-capture">
      <button
        className={`record-button${recording ? ' is-recording' : ''}`}
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={transcribing}
        aria-label={recording ? 'Stop recording' : transcribing ? 'Transcribing recording' : 'Start speaking'}
      >
        {recording ? <Stop aria-hidden="true" weight="fill" /> : <Microphone aria-hidden="true" weight="regular" />}
      </button>
      <div className="voice-capture__copy" aria-live="polite">
        <strong>{recording ? 'Listening…' : transcribing ? 'Transcribing…' : 'Start speaking'}</strong>
        <span>{recording ? 'Tap Stop when you are finished.' : 'Speak naturally in Telugu or English.'}</span>
      </div>
      {message ? <StatusMessage tone={message.tone}>{message.text}</StatusMessage> : null}
    </div>
  );
}
