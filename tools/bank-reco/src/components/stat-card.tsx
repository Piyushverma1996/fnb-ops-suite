import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "default" | "success" | "warning" | "error" | "muted";
  icon?: LucideIcon;
};

const variants = {
  default: "from-blue-600 to-blue-500",
  success: "from-emerald-600 to-emerald-500",
  warning: "from-amber-600 to-amber-500",
  error:   "from-rose-600 to-rose-500",
  muted:   "from-slate-600 to-slate-500",
};

export function StatCard({ label, value, sub, variant = "default", icon: Icon }: Props) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white shadow-sm",
      variants[variant]
    )}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="mt-1.5 text-xs font-medium uppercase tracking-wide opacity-90">{label}</div>
          {sub && <div className="mt-1 text-xs opacity-80">{sub}</div>}
        </div>
        {Icon && <Icon className="h-5 w-5 opacity-60" />}
      </div>
    </div>
  );
}
