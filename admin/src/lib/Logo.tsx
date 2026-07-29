'use client';

interface LogoProps {
  size?: number;
  subtitle?: string;
  subtitleStyle?: React.CSSProperties;
}

export function Logo({ size = 20, subtitle, subtitleStyle }: LogoProps) {
  const icon = Math.round(size * 1.5);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={icon} height={icon} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="16" cy="16" r="13.5" stroke="var(--rp-accent)" strokeWidth="2.5"/>
        <circle cx="16" cy="16" r="5" fill="var(--rp-accent)"/>
        <line x1="16" y1="11" x2="16" y2="3.75" stroke="var(--rp-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
        <line x1="20.33" y1="13.5" x2="26.61" y2="9.88" stroke="var(--rp-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
        <line x1="20.33" y1="18.5" x2="26.61" y2="22.13" stroke="var(--rp-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
        <line x1="16" y1="21" x2="16" y2="28.25" stroke="var(--rp-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
        <line x1="11.67" y1="18.5" x2="5.39" y2="22.13" stroke="var(--rp-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
        <line x1="11.67" y1="13.5" x2="5.39" y2="9.88" stroke="var(--rp-accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
      </svg>
      <div>
        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize: size,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--rp-text-primary)',
          lineHeight: 1,
          margin: 0,
        }}>
          rallye<span style={{ color: 'var(--rp-accent)' }}>.</span>photo
        </p>
        {subtitle && (
          <p style={{
            fontSize: Math.round(size * 0.55),
            color: 'var(--rp-text-muted)',
            marginTop: 3,
            lineHeight: 1,
            ...subtitleStyle,
          }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
