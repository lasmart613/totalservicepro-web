import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleFromEntry } from '@/components/content/ArticleBody';
import { contentPageMetadata } from '@/lib/seo/contentPage';
import { BLOG_POSTS, blogIndexable, getBlogPost } from '@/lib/seo/publicContent';

export const dynamic = 'force-static';
export const revalidate = 86400;
export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await Promise.resolve(params);
  const post = getBlogPost(slug);
  if (!post) return { robots: { index: false, follow: false }, title: 'Field notes' };
  return contentPageMetadata(blogIndexable(post));
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await Promise.resolve(params);
  const post = getBlogPost(slug);
  if (!post) notFound();
  return <ArticleFromEntry page={blogIndexable(post)} entry={post} />;
}
