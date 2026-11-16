import { useOutletContext } from 'react-router';
import { TestPanel } from '../../components/app/TestPanel.jsx';

// Test panel (mockup v2, FR-62, FR-63): Send Traffic and Break It. Send
// Traffic's progress is in the app's own facts, which the screens poll anyway.
export function TestScreen() {
  const { app, now } = useOutletContext();
  return <TestPanel app={app} now={now} />;
}
