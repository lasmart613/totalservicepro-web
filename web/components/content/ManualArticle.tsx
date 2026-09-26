import { JsonLdScript } from '@/components/content/JsonLdScript';
import { Breadcrumbs, Byline, ContentBlocks, RelatedLinks } from '@/components/content/ContentBlocks';
import { contentJsonLdScript } from '@/lib/seo/contentPage';
import {
  MANUAL_LOGIN_HREF,
  MANUAL_LOGIN_LABEL,
  MANUAL_LOGIN_LEAD,
  MANUAL_SIGNUP_HREF,
  MANUAL_SIGNUP_LABEL,
  manualIndexable,
  type ServiceManual,
} from '@/lib/seo/publicContent';

export function ManualArticle({ manual }: { manual: ServiceManual }) {
  const page = manualIndexable(manual);
  return (
    <article className="content-prose">
      <JsonLdScript json={contentJsonLdScript(page)} />
      <Breadcrumbs crumbs={page.breadcrumbs} />
      <h1>{manual.title}</h1>
      <Byline updatedAt={manual.updatedAt} />
      <dl className="content-facts">
        <dt>Title</dt>
        <dd>{manual.title}</dd>
        <dt>Make</dt>
        <dd>{manual.makeName}</dd>
        <dt>Model</dt>
        <dd>{manual.modelName}</dd>
        <dt>Document type</dt>
        <dd>{manual.documentType}</dd>
        <dt>Equipment type</dt>
        <dd>{manual.equipmentType}</dd>
      </dl>
      <div className="content-cta">
        <p>
          <a className="lp-btn lp-btn-primary" href={MANUAL_SIGNUP_HREF}>
            {MANUAL_SIGNUP_LABEL}
          </a>
        </p>
        <p>
          {MANUAL_LOGIN_LEAD} <a href={MANUAL_LOGIN_HREF}>{MANUAL_LOGIN_LABEL}</a>
        </p>
      </div>
      <ContentBlocks blocks={manual.notes} />
      <RelatedLinks links={manual.related} />
    </article>
  );
}
