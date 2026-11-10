import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/common/Layout.jsx';
import { DeploymentsPage } from './pages/DeploymentsPage.jsx';
import { IncidentsPage } from './pages/IncidentsPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DeploymentsPage /> },
      { path: '/incidents', element: <IncidentsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
