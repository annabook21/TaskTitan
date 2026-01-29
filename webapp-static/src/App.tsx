import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { SignInPage } from './pages/SignInPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { TeamListPage } from './pages/TeamListPage';
import { TeamDetailPage } from './pages/TeamDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="auth-callback" element={<AuthCallbackPage />} />
          <Route path="team" element={<TeamListPage />} />
          <Route path="team/:id" element={<TeamDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
