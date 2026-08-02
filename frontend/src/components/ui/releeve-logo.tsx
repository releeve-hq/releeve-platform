import Image from 'next/image';

export function ReleeveLogo({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/seidar-logo.png"
      alt="Releeve"
      width={size}
      height={size}
      className="shrink-0"
      style={{ width: size, height: size }}
      priority
    />
  );
}