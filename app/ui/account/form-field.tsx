import clsx from 'clsx';

export const inputClassName =
  'block w-full rounded-lg border-2 border-gray-900 px-4 py-3 text-base outline-none focus:border-sky-500 aria-[invalid=true]:border-red-600';

/** ラベル・入力欄・エラーをaria属性で関連付けた欄。 */
export function FormField({
  id,
  label,
  errors,
  children,
}: {
  id: string;
  label: string;
  errors?: string[];
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    className: string;
  }) => React.ReactNode;
}) {
  const errorId = `${id}-error`;
  const hasError = !!errors && errors.length > 0;
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-base font-bold text-gray-900">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': hasError,
        'aria-describedby': hasError ? errorId : undefined,
        className: inputClassName,
      })}
      {hasError && (
        <ul id={errorId} className={clsx('mt-1 space-y-0.5 text-sm text-red-600')}>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
