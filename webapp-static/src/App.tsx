import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthSessionExpiredListener } from './components/AuthSessionExpiredListener';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomePage } from './pages/HomePage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { ImportPage } from './pages/ImportPage';
import { TeamListPage } from './pages/TeamListPage';
import { TeamDetailPage } from './pages/TeamDetailPage';
import { TeamNewPage } from './pages/TeamNewPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { ProjectNewPage } from './pages/ProjectNewPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { SprintsListPage } from './pages/SprintsListPage';
import { SprintDetailPage } from './pages/SprintDetailPage';
import { SprintNewPage } from './pages/SprintNewPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { TeamWorkflowPage } from './pages/TeamWorkflowPage';
import { TeamMetricsPage } from './pages/TeamMetricsPage';
import { DocsPage } from './pages/DocsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthSessionExpiredListener />
        <Routes>
          {/* Public routes (no auth required) */}
          <Route path="/" element={<SignInPage />} />
          <Route path="sign-up" element={<SignUpPage />} />
          <Route path="auth-callback" element={<AuthCallbackPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />

          {/* Protected routes (auth required) */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="home" element={<HomePage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="team" element={<TeamListPage />} />
              <Route path="team/new" element={<TeamNewPage />} />
              <Route path="team/:id" element={<TeamDetailPage />} />
              <Route path="team/:id/sprints" element={<SprintsListPage />} />
              <Route path="team/:id/sprints/new" element={<SprintNewPage />} />
              <Route path="team/:id/sprints/:sprintId" element={<SprintDetailPage />} />
              <Route path="team/:id/workflow" element={<TeamWorkflowPage />} />
              <Route path="team/:id/metrics" element={<TeamMetricsPage />} />
              <Route path="project" element={<ProjectsListPage />} />
              <Route path="project/new" element={<ProjectNewPage />} />
              <Route path="project/:id" element={<ProjectDetailPage />} />
              <Route path="my-tasks" element={<MyTasksPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
          </Route>

          {/* Catch-all: authenticated users see 404 + link to home; unauthenticated go to sign-in */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
