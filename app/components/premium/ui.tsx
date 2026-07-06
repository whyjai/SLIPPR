'use client';

import type { ComponentType, ReactNode } from 'react';

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

type CardProps = {
  children: ReactNode;
  className?: string;
  hover?: boolean;
};

export function Card({ children, className, hover = false }: CardProps) {
  return (
    <div className={cn('pg-card', hover && 'pg-card-hover', className)}>
      {children}
    </div>
  );
}

type SectionLabelProps = {
  children: ReactNode;
  className?: string;
};

export function SectionLabel({ children, className }: SectionLabelProps) {
  return <p className={cn('eyebrow', className)}>{children}</p>;
}

type BadgeProps = {
  children: ReactNode;
  tone?: 'emerald' | 'amber' | 'rose' | 'violet' | 'zinc';
  className?: string;
};

const badgeTones: Record<NonNullable<BadgeProps['tone']>, string> = {
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  violet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  zinc: 'border-white/10 bg-white/5 text-zinc-300',
};

export function Badge({ children, tone = 'emerald', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type IconTileProps = {
  icon: ComponentType<{ className?: string }>;
  className?: string;
};

export function IconTile({ icon: Icon, className }: IconTileProps) {
  return (
    <div
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20',
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px] text-emerald-400" />
    </div>
  );
}

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
};

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300',
        checked ? 'bg-emerald-500' : 'bg-zinc-700',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="animate-fade-up mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <SectionLabel className="mb-2">{eyebrow}</SectionLabel>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-xl leading-relaxed text-zinc-400">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
