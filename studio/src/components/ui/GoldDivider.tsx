export default function GoldDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gold/40" />
      <div className="w-1.5 h-1.5 rounded-full bg-gold rotate-45" />
      <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gold/40" />
    </div>
  );
}
