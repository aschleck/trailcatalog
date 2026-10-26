import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';

// 28px tall like the fields in fields.ts, so rows of mixed controls line up
const BUTTON =
    'border cursor-pointer disabled:opacity-50 disabled:pointer-events-none flex h-7 items-center '
        + 'justify-center leading-5 px-3 rounded select-none';
const PRIMARY_BUTTON =
    `${BUTTON} active:bg-gray-700 bg-gray-900 border-gray-900 hover:bg-gray-800 text-white`;
export const SECONDARY_BUTTON =
    `${BUTTON} active:bg-gray-100 bg-white border-gray-300 hover:bg-gray-50`;
const DANGER_BUTTON =
    `${BUTTON} active:bg-red-900 bg-red-700 border-red-700 hover:bg-red-800 text-white`;

type ButtonProps = {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
} & corgi.ButtonProperties;

type LabeledButtonProps = {label: string} & ButtonProps;

export function PrimaryButton({children, className, ...props}: ButtonProps) {
  return <Button {...props} className={join(PRIMARY_BUTTON, className)}>{children ?? []}</Button>;
}

export function SecondaryButton({children, className, ...props}: ButtonProps) {
  return <Button {...props} className={join(SECONDARY_BUTTON, className)}>{children ?? []}</Button>;
}

export function DangerButton({children, className, ...props}: ButtonProps) {
  return <Button {...props} className={join(DANGER_BUTTON, className)}>{children ?? []}</Button>;
}

/** Renders a 28px square button around a 12px stroked icon drawn by children. */
export function IconButton({children, label, ...props}: LabeledButtonProps) {
  return (
    <Button
        {...props}
        ariaLabel={label}
        className="
            active:bg-black/10
            cursor-pointer
            flex
            hover:bg-black/5
            hover:text-gray-800
            p-2
            rounded
            shrink-0
            text-gray-400
        "
        title={label}
    >
      <svg className="h-3 stroke-current w-3" fill="none" viewBox="0 0 12 12">
        {children ?? []}
      </svg>
    </Button>
  );
}

/** Renders a 28px square button around a 20px icon drawn by children, for floating panels. */
export function PanelButton({children, label, ...props}: LabeledButtonProps) {
  return (
    <Button
        {...props}
        ariaLabel={label}
        className="active:bg-black/20 cursor-pointer flex hover:bg-black/10 p-1 rounded shrink-0"
        title={label}
    >
      <svg className="h-5 stroke-current w-5" fill="none" viewBox="0 0 20 20">
        {children ?? []}
      </svg>
    </Button>
  );
}

export function PanelCloseButton(props: Omit<corgi.Properties, 'children'>) {
  return (
    <PanelButton label="Close" {...props}>
      <path d="M5 5 L15 15 M5 15 L15 5" strokeWidth="1.5" />
    </PanelButton>
  );
}

export function RemoveButton(props: {label: string} & Omit<corgi.Properties, 'children'>) {
  return (
    <IconButton {...props}>
      <path d="M2 2 L10 10 M2 10 L10 2" strokeWidth="1.5" />
    </IconButton>
  );
}

function join(base: string, extra: string|undefined): string {
  return extra ? `${base} ${extra}` : base;
}
