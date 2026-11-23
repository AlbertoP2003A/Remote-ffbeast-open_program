import React, { useEffect, useRef, useState } from "react";
import type { FieldDef } from "../types";

type ControlKind = "slider" | "number" | "toggle" | "select";

const NUMBER_FIELDS = new Set([
  "encoderCpr",
  "proportionalGain",
  "integralGain",
  "polePairs",
  "speedBufferSize",
]);

const SLIDER_FIELDS = new Set(["motionRange", "softStopRange"]);

function controlFor(field: FieldDef): ControlKind {
  if (field.options && field.options.length > 0) return "select";
  if (SLIDER_FIELDS.has(field.name)) return "slider";
  if (field.min === 0 && field.max === 1) return "toggle";
  if (NUMBER_FIELDS.has(field.name)) return "number";
  if (field.max - field.min <= 100 && field.step <= 1) return "slider";
  return "number";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function format(value: number, field: FieldDef): string {
  if (field.step >= 1) return String(Math.round(value));
  const decimals = Math.min(3, Math.max(0, String(field.step).split(".")[1]?.length ?? 0));
  return value.toFixed(decimals);
}

export function FieldRow({
  field,
  value,
  disabled,
  onCommit,
}: {
  field: FieldDef;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const control = controlFor(field);
  const id = `field-${field.name}`;
  return (
    <div className={`field field-${control}`}>
      <div className="field-head">
        <label className="field-label" htmlFor={id}>
          {field.label}
        </label>
        {field.description && <p className="field-desc">{field.description}</p>}
      </div>
      <div className="field-control">
        {control === "slider" && (
          <Slider
            id={id}
            field={field}
            value={value}
            disabled={disabled}
            onCommit={onCommit}
          />
        )}
        {control === "number" && (
          <NumberField
            id={id}
            field={field}
            value={value}
            disabled={disabled}
            onCommit={onCommit}
          />
        )}
        {control === "toggle" && (
          <Toggle id={id} value={value} disabled={disabled} onCommit={onCommit} />
        )}
        {control === "select" && (
          <Select id={id} field={field} value={value} disabled={disabled} onCommit={onCommit} />
        )}
      </div>
    </div>
  );
}

function Slider({
  id,
  field,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  field: FieldDef;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);

  const percent = field.max > field.min ? ((local - field.min) / (field.max - field.min)) * 100 : 0;

  const commit = (): void => {
    if (!dragging.current) return;
    dragging.current = false;
    if (local !== value) onCommit(local);
  };

  return (
    <div className="slider">
      <input
        id={id}
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={local}
        disabled={disabled}
        aria-label={field.label}
        aria-valuetext={`${format(local, field)}${field.unit ?? ""}`}
        style={{ "--pct": `${percent}%` } as React.CSSProperties}
        onChange={(event) => {
          dragging.current = true;
          setLocal(Number(event.target.value));
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output className="slider-value" htmlFor={id}>
        {format(local, field)}
        {field.unit && <span>{field.unit}</span>}
      </output>
    </div>
  );
}

function NumberField({
  id,
  field,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  field: FieldDef;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const next = clamp(Math.round(parsed), field.min, field.max);
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="number-field">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={text}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setText(String(value));
            event.currentTarget.blur();
          }
        }}
      />
      {field.unit && <span className="number-unit">{field.unit}</span>}
    </div>
  );
}

function Toggle({
  id,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}): React.ReactElement {
  const on = value !== 0;
  return (
    <div className="toggle">
      <ToggleSwitch
        id={id}
        checked={on}
        disabled={disabled}
        onChange={(next) => onCommit(next ? 1 : 0)}
      />
      <span className="toggle-state">{on ? "Activado" : "Desactivado"}</span>
    </div>
  );
}

export function ToggleSwitch({
  id,
  checked,
  onChange,
  disabled,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}): React.ReactElement {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

function Select({
  id,
  field,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  field: FieldDef;
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}): React.ReactElement {
  return (
    <select
      id={id}
      className="select"
      value={value}
      disabled={disabled}
      onChange={(event) => onCommit(Number(event.target.value))}
    >
      {field.options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function AdvancedSection({
  children,
  title = "Avanzado",
  hint,
}: {
  children: React.ReactNode;
  title?: string;
  hint?: string;
}): React.ReactElement {
  return (
    <details className="advanced">
      <summary>
        <span>{title}</span>
        {hint && <em>{hint}</em>}
      </summary>
      <div className="advanced-body">{children}</div>
    </details>
  );
}
