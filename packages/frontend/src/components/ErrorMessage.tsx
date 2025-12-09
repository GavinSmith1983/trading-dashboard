import { AlertCircle } from 'lucide-react';
import Button from './Button';

export interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export default function ErrorMessage({ message, onRetry, className }: ErrorMessageProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className || ''}`}>
      <AlertCircle className="h-12 w-12 text-red-500" />
      <p className="mt-4 text-lg font-medium text-gray-900">Something went wrong</p>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}
