/**
 * SHCQ 品牌标：深藏蓝底 + 金色外框 + 大号衬线堆叠字母 + 金菱形点缀
 * 与经营管理系统（BizManager）同款，小尺寸优先保证可读性，纯矢量，深浅主题通用
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="SHCQ"
    >
      <defs>
        {/* 底色：深邃藏蓝（自上而下渐暗，营造纵深） */}
        <linearGradient id="shcq-bg" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1E3557" />
          <stop offset="1" stopColor="#0B1524" />
        </linearGradient>
        {/* 金箔主色（文字与外框） */}
        <linearGradient id="shcq-gold" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F2C879" />
          <stop offset="1" stopColor="#D39A35" />
        </linearGradient>
      </defs>

      {/* 底 */}
      <rect width="48" height="48" rx="10" fill="url(#shcq-bg)" />

      {/* 金色外框（单框，克制） */}
      <rect x="1.5" y="1.5" width="45" height="45" rx="8.8" stroke="url(#shcq-gold)" strokeWidth="1.4" />

      {/* 上行 SH */}
      <text
        x="25" y="20.6" textAnchor="middle" fontSize="17" fontWeight="800" letterSpacing="1.5"
        fill="url(#shcq-gold)"
        fontFamily="Georgia,'Times New Roman','Songti SC',serif"
      >
        SH
      </text>

      {/* 金菱形分隔点缀 */}
      <path d="M24 23.4 L25.5 25 L24 26.6 L22.5 25 Z" fill="url(#shcq-gold)" />

      {/* 下行 CQ */}
      <text
        x="25" y="40.2" textAnchor="middle" fontSize="17" fontWeight="800" letterSpacing="1.5"
        fill="url(#shcq-gold)"
        fontFamily="Georgia,'Times New Roman','Songti SC',serif"
      >
        CQ
      </text>
    </svg>
  )
}
