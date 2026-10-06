import { termsMarkdown } from '@/content/legal/terms';
import { LegalDocument } from '@/components/legal/LegalDocument';

export default function TermsPage() {
  return <LegalDocument heading="Terms of Service" markdown={termsMarkdown} />;
}
