import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:bg-disabled disabled:text-on-disabled',
    secondary:
      'border border-line-strong text-fg hover:bg-surface-subtle disabled:text-on-disabled',
  };
  return (
    <button
      type="button"
      disabled={disabled === true || loading}
      className={`inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? '请稍候…' : children}
    </button>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | undefined;
}

export function TextField({ label, hint, error, ...props }: TextFieldProps) {
  const id = useId();
  const describedBy = error === undefined ? `${id}-hint` : `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
        className="h-11 rounded-lg border border-line bg-surface px-3 text-base text-fg placeholder:text-fg-subtle aria-invalid:border-danger"
        {...props}
      />
      {error === undefined ? (
        hint === undefined ? null : (
          <p id={`${id}-hint`} className="text-xs text-fg-subtle">
            {hint}
          </p>
        )
      ) : (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg bg-danger-container px-4 py-3 text-sm text-danger"
    >
      {children}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      {title === undefined ? null : (
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      )}
      {children}
    </section>
  );
}
