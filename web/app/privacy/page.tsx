import { privacyMarkdown } from '@/content/legal/privacy';
import { LegalDocument } from '@/components/legal/LegalDocument';

export default function PrivacyPage() {
  return <LegalDocument heading="Privacy Policy" markdown={privacyMarkdown} />;
}
