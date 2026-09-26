import { ogImageAlt, ogImageContentType, ogImageSize, renderOgImage } from '@/components/seo/OgImage';

export const alt = ogImageAlt;
export const size = ogImageSize;
export const contentType = ogImageContentType;

export default function TwitterImage() {
  return renderOgImage();
}
