import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-headline-xl font-semibold">Not found</h1>
      <p className="mt-2 text-on-surface-variant">
        Nothing lives at this address.{' '}
        <Link to="/" className="text-primary hover:underline">
          Back to Apps
        </Link>
      </p>
    </div>
  );
}
