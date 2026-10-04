'use client';

import { Header } from '@/components/Header';
import { PublicLink, useT } from '@/lib/fa/locale';

/** FSEs are invited via Team — there is no top-level FSE signup. */
export default function SignupFsePage() {
  const t = useT();
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-lg mx-auto w-full px-4 py-16 text-center">
        <h1 className="text-3xl font-extrabold">{t('Technician accounts are by invitation')}</h1>
        <p className="text-[var(--text3)] mt-3 mb-8">
          {t("Field engineers and service techs join through their repair company's Team page. There is no individual technician signup.")}
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <PublicLink href="/signup" className="btn btn-primary">
            {t('Create an organization')}
          </PublicLink>
          <PublicLink href="/login" className="btn btn-secondary">
            {t('Sign in')}
          </PublicLink>
        </div>
      </div>
    </div>
  );
}
