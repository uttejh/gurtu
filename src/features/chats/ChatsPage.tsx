import { Link } from 'react-router-dom';
import { Plus } from '@phosphor-icons/react';
import { PageLayout } from '../../components/PageLayout';
import { StatusMessage } from '../../components/StatusMessage';
import { formatChatTime } from '../../lib/talk';
import { useRecentConversations } from '../shared/useRecentConversations';

export function ChatsPage() {
  const { conversations, loading, failed } = useRecentConversations(200);
  return (
    <PageLayout title="Your chats" backTo="/">
      <section className="page-section">
        <Link className="button button--primary chat-new-button" to="/talk"><Plus aria-hidden="true" /> New chat</Link>
        {loading ? <p className="muted-copy">Loading your chats…</p> : null}
        {failed ? <StatusMessage tone="error">We could not load your chats. Please try again.</StatusMessage> : null}
        {!loading && !failed && conversations.length === 0 ? <p className="empty-state">No chats yet. Start a new chat with Gurtu.</p> : null}
        <ul className="chat-list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link className="chat-row" to={`/talk/${conversation.id}`}>
                <span className="chat-row__title">{conversation.title}</span>
                <time className="chat-row__time" dateTime={conversation.last_activity_at}>{formatChatTime(conversation.last_activity_at)}</time>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageLayout>
  );
}
