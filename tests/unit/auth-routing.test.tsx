import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/app/App';
import { AuthProvider } from '../../src/app/AuthProvider';

afterEach(cleanup);

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
}

describe('authentication routes', () => {
  it.each(['/remember', '/ask', '/memories', '/history', '/lists', '/calendar', '/family-activity'])(
    'sends an unauthenticated visit to %s to the login page', async (path) => {
      renderApp(path);
      expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
      expect(screen.queryByText(/create an account|sign up/i)).not.toBeInTheDocument();
    },
  );

  it('provides password recovery without public account registration', () => {
    renderApp('/login');
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign up|create account/i })).not.toBeInTheDocument();
  });
});
