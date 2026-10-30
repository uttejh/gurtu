import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';
import { LoadingState } from '../components/LoadingState';

export function RouteGate() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingState label="Opening your family's memory…" />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}
