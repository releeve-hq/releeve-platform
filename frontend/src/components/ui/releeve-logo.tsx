import Image from 'next/image';

export function ReleeveLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/seidar-logo.png"
      alt="Releeve"
      width={size}
      height={size}
      className={`shrink-0 invert dark:invert-0 ${className}`}
      style={{ width: size, height: size }}
      priority
    />
  );
}