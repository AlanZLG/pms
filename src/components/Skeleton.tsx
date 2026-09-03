import clsx from 'clsx'

export function Skeleton({
  className,
  width,
  height = 16,
  rounded = 'md',
  count = 1,
  gap = 8,
}: {
  className?: string
  width?: number | string
  height?: number | string
  rounded?: 'sm' | 'md' | 'lg' | 'full' | 'none'
  count?: number
  gap?: number
}) {
  const roundedCls =
    rounded === 'full' ? 'rounded-full' :
    rounded === 'lg' ? 'rounded-lg' :
    rounded === 'sm' ? 'rounded' :
    rounded === 'none' ? '' :
    'rounded-md'
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    marginBottom: count > 1 ? `${gap}px` : undefined,
  }
  const items = Array.from({ length: count })
  return (
    <>
      {items.map((_, i) => (
        <div
          key={i}
          className={clsx(
            'animate-pulse bg-bg-border/60',
            roundedCls,
            className
          )}
          style={i === count - 1 ? { ...style, marginBottom: 0 } : style}
        />
      ))}
    </>
  )
}

export function CardSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('glass rounded-2xl p-6 shadow-card', className)}>
      <Skeleton width={180} height={20} className="mb-6" />
      <Skeleton count={rows} height={40} gap={12} />
    </div>
  )
}

export function StatSkeleton({ className }: { className?: string }) {
  return (
    <div className={clsx('glass rounded-2xl p-5 shadow-card', className)}>
      <Skeleton width={90} height={14} className="mb-3" />
      <Skeleton width={120} height={32} rounded="none" className="mb-2" />
      <Skeleton width={60} height={12} />
    </div>
  )
}

export function TableSkeleton({ rows = 8 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass rounded-2xl p-4 shadow-card">
      <Skeleton count={rows} height={56} gap={4} className="mx-2" />
    </div>
  )
}
