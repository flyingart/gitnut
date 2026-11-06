import { useId } from "react";

/** The gitnut mark: a coconut whose three "eyes" are commits on a forking branch. */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden className="gitnut-logo">
      <defs>
        <radialGradient id={`${id}s`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#a8704f" />
          <stop offset="0.6" stopColor="#6e412b" />
          <stop offset="1" stopColor="#43261a" />
        </radialGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f9a8d4" />
          <stop offset="0.5" stopColor="#c084fc" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <circle cx="64" cy="64" r="55" fill={`url(#${id}s)`} stroke={`url(#${id}r)`} strokeWidth="8" />
      <path d="M64 118 V86 C64 68 44 70 44 50 M64 86 C64 68 84 70 84 50" fill="none" stroke="#fdf2f8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <g stroke="#fdf2f8" strokeWidth="5">
        <circle cx="44" cy="46" r="12" fill="#f472c6" />
        <circle cx="84" cy="46" r="12" fill="#6d8cf5" />
        <circle cx="64" cy="86" r="11" fill="#a78bfa" />
      </g>
    </svg>
  );
}
