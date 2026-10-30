import { useState, type ChangeEvent, type FormEvent } from 'react';
import { PageLayout } from '../../components/PageLayout';
import { VoiceRecorder } from '../../components/VoiceRecorder';
import { StatusMessage } from '../../components/StatusMessage';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/errors';

interface AnswerSource {
  id: string;
  original_text: string;
  created_at: string;
}

interface MemoryAnswer {
  answer: string;
  found: boolean;
  sources: AnswerSource[];
}

function formatSavedDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(timestamp));
}

export function AskPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateQuestion(event: ChangeEvent<HTMLTextAreaElement>) {
    setQuestion(event.target.value);
    setAnswer(null);
    setError(null);
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    if (!supabase) {
      setError('Gurtu is not connected yet. Your question was not sent or saved.');
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('ask-memory', {
        body: { question: question.trim() },
      });
      if (functionError || typeof data?.answer !== 'string') throw functionError ?? new Error('No answer was returned.');
      setAnswer({
        answer: data.answer,
        found: data.found === true,
        sources: Array.isArray(data.sources) ? data.sources as AnswerSource[] : [],
      });
    } catch (cause) {
      setError(friendlyError(cause, 'We could not search your saved memories. Your question was not saved. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout title="Ask your memory" backTo="/">
      <section className="page-section ask-section" aria-labelledby="ask-instruction">
        <h3 id="ask-instruction" className="section-lead">Ask in Telugu or English. I’ll look through what your family saved.</h3>
        <VoiceRecorder onTranscript={(transcript) => {
          setQuestion(transcript);
          setAnswer(null);
          setError(null);
        }} />
        <form className="ask-form" onSubmit={ask}>
          <label className="field-label" htmlFor="memory-question">Your question</label>
          <textarea
            id="memory-question"
            className="text-area"
            rows={3}
            maxLength={2000}
            placeholder="Where did we keep the passbook?"
            value={question}
            onChange={updateQuestion}
            lang="te"
          />
          <button className="button button--primary" type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Looking…' : 'Ask'}
          </button>
        </form>
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        {answer ? (
          <section className="answer-panel" aria-live="polite" aria-labelledby="answer-heading">
            <h3 id="answer-heading">Your family's saved memory</h3>
            <p className="answer-text" lang="te">{answer.answer}</p>
            {answer.found && answer.sources.length ? (
              <div className="answer-sources">
                <h4>From what your family saved</h4>
                {answer.sources.map((source) => (
                  <blockquote key={source.id}>
                    <p lang="te">{source.original_text}</p>
                    <footer>{formatSavedDate(source.created_at)}</footer>
                  </blockquote>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {!supabase ? <StatusMessage tone="neutral">Connect Supabase to search saved family memories. Questions are not kept as a chat history.</StatusMessage> : null}
      </section>
    </PageLayout>
  );
}
