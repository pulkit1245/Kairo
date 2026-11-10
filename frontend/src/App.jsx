import { createBrowserRouter, RouterProvider } from 'react-router';
import { RequireAuth } from './components/auth/auth.jsx';
import { Layout } from './components/common/Layout.jsx';
import { AddRepoPage } from './pages/AddRepoPage.jsx';
import { DeploymentPage } from './pages/DeploymentPage.jsx';
import { DeploymentsPage } from './pages/DeploymentsPage.jsx';
import { IncidentsPage } from './pages/IncidentsPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { NotInvitedPage } from './pages/NotInvitedPage.jsx';
import { SignInPage } from './pages/SignInPage.jsx';

const router = createBrowserRouter([
  // open: how you get a session (FR-1, FR-2)
  { path: '/signin', element: <SignInPage /> },
  { path: '/not-invited', element: <NotInvitedPage /> },
  // everything else needs a signed-in, allow-listed user (FR-42)
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <DeploymentsPage /> },
      { path: '/apps/new', element: <AddRepoPage /> },
      { path: '/deployments/:id', element: <DeploymentPage /> },
      { path: '/incidents', element: <IncidentsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
