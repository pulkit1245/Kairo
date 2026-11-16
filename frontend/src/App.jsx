import { createBrowserRouter, RouterProvider } from 'react-router';
import { RequireAuth } from './components/auth/auth.jsx';
import { Layout } from './components/common/Layout.jsx';
import { AddRepoPage } from './pages/AddRepoPage.jsx';
import { AppScreens } from './pages/app/AppScreens.jsx';
import { IncidentsScreen } from './pages/app/IncidentsScreen.jsx';
import { LogsScreen } from './pages/app/LogsScreen.jsx';
import { MetricsScreen } from './pages/app/MetricsScreen.jsx';
import { OverviewScreen } from './pages/app/OverviewScreen.jsx';
import { ReleasesScreen } from './pages/app/ReleasesScreen.jsx';
import { TestScreen } from './pages/app/TestScreen.jsx';
import { AppsPage } from './pages/AppsPage.jsx';
import { DeploymentPage } from './pages/DeploymentPage.jsx';
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
      { path: '/', element: <AppsPage /> },
      { path: '/apps/new', element: <AddRepoPage /> },
      // an app's screens (P5d, mockup v2), each at its own address
      {
        path: '/apps/:slug',
        element: <AppScreens />,
        children: [
          { index: true, element: <OverviewScreen /> },
          { path: 'incidents', element: <IncidentsScreen /> },
          { path: 'metrics', element: <MetricsScreen /> },
          { path: 'logs', element: <LogsScreen /> },
          { path: 'releases', element: <ReleasesScreen /> },
          { path: 'test', element: <TestScreen /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      { path: '/deployments/:id', element: <DeploymentPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
