import Image from 'next/image';

type ReleeveLogoProps = {
  size?: number;
  className?: string;
  tone?: "white" | "black" | "auto";
};

export function ReleeveLogo({ size = 32, className = "", tone = "white" }: ReleeveLogoProps) {
  if (tone === "auto") {
    return (
      <span
        aria-hidden="true"
        className={`releeve-logo releeve-logo--auto ${className}`}
        style={{ width: size, height: size }}
      >
        <Image
          src="/releeve-logo-white.png"
          alt=""
          width={size}
          height={size}
          className="releeve-logo__white"
          priority
        />
        <Image
          src="/releeve-logo-black.png"
          alt=""
          width={size}
          height={size}
          className="releeve-logo__black"
          priority
        />
      </span>
    );
  }

  return (
    <Image
      src={`/releeve-logo-${tone}.png`}
      alt="Releeve"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size, objectFit: "contain" }}
      priority
    />
  );
}
