import { Controller } from 'react-hook-form';
import SelectMenu from './SelectMenu';

/**
 * `SelectMenu` wired into a react-hook-form form.
 *
 * `register` only works on a real form element - it hands back a `ref`, a `name`
 * and a DOM `onChange` that reads `event.target.value`. Our dropdown is a button
 * and a listbox, so it goes through `Controller` instead, which is what RHF
 * provides for exactly this. Everything else about the field - label, hint,
 * error, sizing - is `SelectMenu`'s.
 *
 * ```jsx
 * const { control } = useForm(...);
 * <SelectField control={control} name="region" label="Province" options={PROVINCES} />
 * ```
 *
 * `onValueChange` fires after the form value is written, for the cascades that
 * have to clear a dependent field when this one moves.
 */
export function SelectField({ control, name, rules, onValueChange, error, ...rest }) {
  return (
    <Controller
      control={control}
      name={name}
      rules={rules}
      render={({ field, fieldState }) => (
        <SelectMenu
          {...rest}
          size={rest.size ?? 'md'}
          align={rest.align ?? 'left'}
          name={field.name}
          value={field.value ?? ''}
          onBlur={field.onBlur}
          // So a failed submit can focus this field. Without it RHF has no
          // node for a dropdown and simply leaves the page where it is.
          fieldRef={field.ref}
          onChange={(next) => {
            field.onChange(next);
            onValueChange?.(next);
          }}
          error={error ?? fieldState.error?.message}
        />
      )}
    />
  );
}

export default SelectField;
