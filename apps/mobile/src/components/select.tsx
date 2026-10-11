import { useId, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { CanonicalIcon } from "./navigation";
import { Sheet } from "./sheet";

type Choice = { index: number; value: string; label: string; disabled: boolean; group: string };
type Selection = { choices: Choice[]; values: string[] };

/** Styled mobile selection with native form serialization and constraint validation. */
export function MobileSelect({
  children,
  className = "",
  id,
  title,
  disabled,
  multiple,
  onChange,
  onInvalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const ariaLabel = props["aria-label"];
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>({ choices: [], values: [] });
  const [label, setLabel] = useState(ariaLabel ?? title ?? "选择选项");

  // Reading the actual options preserves React children, optgroups and native defaults.
  useLayoutEffect(() => {
    const select = native.current;
    if (!select) return;
    const next: Selection = {
      choices: Array.from(select.options, (option, index) => ({
        index,
        value: option.value,
        label: option.label,
        disabled:
          option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
        group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "",
      })),
      values: Array.from(select.selectedOptions, (option) => option.value),
    };
    setSelection((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    setLabel(ariaLabel ?? title ?? select.closest("label")?.querySelector("span")?.textContent?.trim() ?? "选择选项");
  }, [children, disabled, multiple, props.value, props.defaultValue, ariaLabel, title]);

  useLayoutEffect(() => {
    const form = native.current?.form;
    const reset = () => {
      queueMicrotask(() => {
        setSelection((previous) => ({
          ...previous,
          values: Array.from(native.current?.selectedOptions ?? [], (option) => option.value),
        }));
        setInvalid(false);
      });
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (choice: Choice) => {
    const select = native.current;
    if (!select || select.matches(":disabled") || choice.disabled) return;
    if (!multiple && select.selectedIndex === choice.index) {
      close();
      return;
    }
    if (multiple) {
      select.options[choice.index].selected = !select.options[choice.index].selected;
    } else {
      select.selectedIndex = choice.index;
    }
    // React's select onChange receives the real select target, including selectedOptions.
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setSelection((previous) => ({ ...previous, values: Array.from(select.selectedOptions, (option) => option.value) }));
    setInvalid(!select.validity.valid);
    if (!multiple) close();
  };
  // Controlled callers may persist asynchronously. Display the committed prop value,
  // rather than the DOM's provisional value before React restores a rejected change.
  const controlledValues = props.value === undefined ? undefined : [props.value].flat().map(String);
  const values =
    controlledValues === undefined
      ? selection.values
      : !multiple && !selection.choices.some((choice) => controlledValues.includes(choice.value))
        ? selection.choices
            .filter((choice) => !choice.disabled)
            .slice(0, 1)
            .map((choice) => choice.value)
        : controlledValues;
  const selected = selection.choices.filter((choice) => values.includes(choice.value));
  const visible = selection.choices.filter((choice) =>
    choice.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  return (
    <span className={`mobile-select${invalid ? " is-invalid" : ""}`}>
      <button
        type="button"
        id={triggerId}
        ref={trigger}
        className={`mobile-select-trigger ${className}`}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={invalid ? `${triggerId}-error` : props["aria-describedby"]}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${triggerId}-choices`}
        onClick={() => setOpen(true)}
      >
        <span className="mobile-select-value">{selected.map((choice) => choice.label).join("、") || "请选择"}</span>
        <CanonicalIcon name="down" size={20} />
      </button>
      <select
        {...props}
        disabled={disabled}
        multiple={multiple}
        ref={native}
        className="mobile-select-backing"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          setInvalid(!event.currentTarget.validity.valid);
          onChange?.(event);
        }}
        onInvalid={(event) => {
          onInvalid?.(event);
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
        }}
      >
        {children}
      </select>
      {invalid && (
        <span className="mobile-select-error" role="alert" id={`${triggerId}-error`}>
          请选择{label === "选择选项" ? "一项" : label}
        </span>
      )}
      {open &&
        createPortal(
          <Sheet title={label} onClose={close} className="mobile-selection-sheet">
            {selection.choices.length > 7 && (
              <label className="mobile-selection-search">
                <CanonicalIcon name="search" size={20} />
                <input
                  type="search"
                  aria-label={`搜索${label}`}
                  placeholder="搜索"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
            <div
              id={`${triggerId}-choices`}
              className="mobile-selection-options"
              role={multiple ? "group" : "radiogroup"}
              aria-label={label}
            >
              {visible.map((choice, index) => (
                <div key={choice.index}>
                  {choice.group && choice.group !== visible[index - 1]?.group && (
                    <div className="mobile-selection-group">{choice.group}</div>
                  )}
                  <button
                    type="button"
                    className={`mobile-selection-option${values.includes(choice.value) ? " is-selected" : ""}`}
                    role={multiple ? "checkbox" : "radio"}
                    aria-checked={values.includes(choice.value)}
                    disabled={choice.disabled}
                    onClick={() => choose(choice)}
                  >
                    <span>{choice.label}</span>
                    <span className={`mobile-selection-mark${multiple ? " is-checkbox" : ""}`} aria-hidden="true">
                      {values.includes(choice.value) && <CanonicalIcon name="check" size={18} />}
                    </span>
                  </button>
                </div>
              ))}
              {!visible.length && <p className="mobile-selection-empty">暂无选项</p>}
            </div>
            {multiple && (
              <button type="button" className="button primary mobile-selection-done" onClick={close}>
                完成
              </button>
            )}
          </Sheet>,
          document.body
        )}
    </span>
  );
}
