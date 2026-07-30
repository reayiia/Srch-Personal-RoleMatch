import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

export interface SelectMenuOption<Value extends string | number> {
  value: Value;
  label: string;
}

interface SelectMenuProps<Value extends string | number> {
  label: string;
  value: Value;
  options: Array<SelectMenuOption<Value>>;
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
}

export function SelectMenu<Value extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
}: SelectMenuProps<Value>) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!detailsRef.current || !(event.target instanceof Node)) return;
      if (!detailsRef.current.contains(event.target)) {
        detailsRef.current.open = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handleSelect = (nextValue: Value) => {
    if (disabled) return;
    onChange(nextValue);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details className={`select-menu${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`} ref={detailsRef}>
      <summary
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <span>{label}</span>
        <strong>{selectedOption?.label ?? ''}</strong>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="select-menu-panel">
        {options.map((option) => (
          <button
            className={option.value === value ? 'active' : ''}
            key={String(option.value)}
            type="button"
            onClick={() => handleSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}
