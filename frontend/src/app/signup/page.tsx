import { BrandPanel } from '@/components/auth/brand-panel';
import { AuthForm } from '@/components/auth/auth-form';
import '../auth.css';

export default function SignupPage() {
  return (
    <div className="auth-container">
      <BrandPanel />
      <div className="form-panel">
        <AuthForm mode="signup" />
      </div>
    </div>
  );
}
