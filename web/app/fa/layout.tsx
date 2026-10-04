import type { Metadata } from 'next';
import { FaProvider } from '@/lib/fa/locale';
import './fa-preview.css';

export const metadata: Metadata = {
  title: { absolute: 'پیش‌نمایش فارسی · RepairPlanet' },
  robots: { index: false, follow: false },
};

export default function FaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="fa" dir="rtl" className="fa-preview-root">
      <FaProvider>
        <p className="fa-draft-banner">
          این متن پیش‌نویس است و برای اصلاح نوشته شده. نام‌های RepairPlanet، Total Service Pro، Premium و
          Team، و همین‌طور قیمت‌ها، همان نسخهٔ انگلیسی است.
        </p>
        {children}
      </FaProvider>
    </div>
  );
}
