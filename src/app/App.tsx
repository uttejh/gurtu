import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { RouteGate } from './RouteGate';
import { useAuth } from './useAuth';
import { LoadingState } from '../components/LoadingState';

const CalendarPage = lazy(() => import('../features/calendar/CalendarPage').then((module) => ({ default: module.CalendarPage })));
const HistoryPage = lazy(() => import('../features/history/HistoryPage').then((module) => ({ default: module.HistoryPage })));
const HomePage = lazy(() => import('../features/home/HomePage').then((module) => ({ default: module.HomePage })));
const ListsPage = lazy(() => import('../features/lists/ListsPage').then((module) => ({ default: module.ListsPage })));
const LoginPage = lazy(() => import('../features/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const PasswordRecoveryPage = lazy(() => import('../features/auth/PasswordRecoveryPage').then((module) => ({ default: module.PasswordRecoveryPage })));
const MemoriesPage = lazy(() => import('../features/memories/MemoriesPage').then((module) => ({ default: module.MemoriesPage })));
const ChatsPage = lazy(() => import('../features/chats/ChatsPage').then((module) => ({ default: module.ChatsPage })));
const TalkPage = lazy(() => import('../features/talk/TalkPage').then((module) => ({ default: module.TalkPage })));
const FamilyActivityPage = lazy(() => import('../features/admin/FamilyActivityPage').then((module) => ({ default: module.FamilyActivityPage })));

export function App() {
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  if (import.meta.env.DEV && searchParams.get('preview') === 'home' && !session) {
    return <Suspense fallback={<LoadingState label="Opening Gurtu…" />}><HomePage preview /></Suspense>;
  }

  return (
    <Suspense fallback={<LoadingState label="Opening Gurtu…" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<PasswordRecoveryPage />} />
        <Route element={<RouteGate />}>
          <Route index element={<HomePage />} />
          <Route path="/talk/:conversationId?" element={<TalkPage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/remember" element={<Navigate to="/talk" replace />} />
          <Route path="/ask" element={<Navigate to="/talk" replace />} />
          <Route path="/memories" element={<MemoriesPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/family-activity" element={<FamilyActivityPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
