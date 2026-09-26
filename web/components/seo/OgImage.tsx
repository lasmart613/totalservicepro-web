import { ImageResponse } from 'next/og';

export const ogImageSize = { width: 1200, height: 630 };
export const ogImageContentType = 'image/png';
export const ogImageAlt =
  'RepairPlanet — Total Service Pro, field service software for biomedical and laser repair';

/** Default 1200×630 share image. No ratings or review markup. */
export function renderOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#111827',
          color: '#F3E8D8',
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 28,
              letterSpacing: '0.14em',
              color: '#9CA3AF',
              fontWeight: 700,
            }}
          >
            MEDICAL REPAIR NETWORK
          </div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 800,
              color: '#FBBF24',
              marginTop: 18,
              lineHeight: 1,
            }}
          >
            RepairPlanet
          </div>
          <div style={{ fontSize: 42, fontWeight: 700, marginTop: 24, lineHeight: 1.2 }}>
            Total Service Pro
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 32, lineHeight: 1.35, maxWidth: 980 }}>
          Field service software for biomedical and laser repair — lithotriptors, C-arms, and more.
        </div>
      </div>
    ),
    { ...ogImageSize },
  );
}
