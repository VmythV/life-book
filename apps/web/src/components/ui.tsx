import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
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
    ghost:
      'text-fg-muted hover:bg-surface-subtle hover:text-fg disabled:text-on-disabled',
    danger:
      'border border-line-strong text-danger hover:bg-danger-container disabled:text-on-disabled',
  };
  const sizes = { md: 'h-11 px-5 text-sm', sm: 'h-8 px-3 text-xs' };
  return (
    <button
      type="button"
      disabled={disabled === true || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? '请稍候…' : children}
    </button>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

const controlClass =
  'rounded-lg border border-line bg-surface px-3 text-base text-fg placeholder:text-fg-subtle aria-invalid:border-danger disabled:text-fg-subtle';

interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

/** 标签、控件和提示/错误文字的统一排版；`children` 接收控件的 id 和描述 id。 */
function Field({
  label,
  hint,
  error,
  children,
}: FieldProps & { children: (ids: { id: string; describedBy: string }) => ReactNode }) {
  const id = useId();
  const describedBy = error === undefined ? `${id}-hint` : `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children({ id, describedBy })}
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

export function TextField({ label, hint, error, ...props }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={`h-11 ${controlClass}`}
          {...props}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={`min-h-28 py-2 leading-relaxed ${controlClass}`}
          {...props}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <select
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={`h-11 ${controlClass}`}
          {...props}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  ...props
}: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-(--color-primary)" {...props} />
      {label}
    </label>
  );
}

const badgeTones = {
  neutral: 'bg-surface-subtle text-fg-muted',
  info: 'bg-info-container text-info',
  success: 'bg-success-container text-success',
  warning: 'bg-warning-container text-warning',
  danger: 'bg-danger-container text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children === undefined ? null : (
        <div className="mt-2 text-sm text-fg-muted">{children}</div>
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

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 md:p-6">
      {title === undefined ? null : (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
