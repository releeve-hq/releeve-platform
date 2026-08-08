import { AuthForm } from '@/components/auth/auth-form';
import '../auth.css';

export default function SignInPage() {
  return (
    <main className="auth-page"><AuthForm mode="login" /></main>
  );
}
