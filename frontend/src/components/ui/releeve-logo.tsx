import Image from 'next/image';

export function ReleeveLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/releeve-logo-white.png"
      alt="Releeve"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size, objectFit: "contain" }}
      priority
    />
  );
}
