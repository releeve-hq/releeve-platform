import { AuthForm } from '@/components/auth/auth-form';
import '../auth.css';

export default function SignupPage() {
  return (
    <main className="auth-page"><AuthForm mode="signup" /></main>
  );
}
