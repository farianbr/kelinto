import { AUTHOR_LINKS } from '@shared/author';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';

/**
 * The byline fields, for any admin form that authors long-form copy.
 *
 * Shared by the blog post form and the product article form. The two write to
 * the same `author` shape (`shared/author.js`), so authoring it twice would
 * have meant two forms drifting apart the first time a field was added to one.
 *
 * FLAT field names (`authorName`, `authorLinkedin`) rather than nested ones,
 * because that is what a plain `register()` produces and what `authorFromForm`
 * on the server expects. The nesting happens once, on write.
 *
 * `nameRequired` differs between the two callers and is the only difference
 * between them: a blog post must have an author, a product article need not -
 * 773 of them were seeded with no byline and the storefront falls back to the
 * parts-desk line for those.
 */
function AuthorFields({ register, formState, value, onChange, nameRequired = true }) {
  const error = (field) => formState?.errors?.[field]?.message;

  /**
   * Two callers, two form libraries. The blog editor runs react-hook-form and
   * passes `register`; the product article editor holds its fields in local
   * state and passes `value`/`onChange`. Rather than convert one of them - a
   * change to a working editor for the sake of this fieldset - the bindings
   * are produced here, so both get identical markup and identical field names.
   */
  const bind = (field, options) =>
    register
      ? register(field, options ?? {})
      : {
          value: value?.[field] ?? '',
          onChange: (event) => onChange?.(field, event.target.value),
        };

  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="px-1.5 text-sm font-semibold text-ink-900">Byline</legend>

      <p className="mb-4 text-sm text-ink-400">
        Shown beside the article on the website. Everything except the name is optional; an
        empty field is left off rather than printed blank.
      </p>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Author"
            error={error('authorName')}
            {...bind('authorName', nameRequired ? { required: 'Who wrote it?' } : {})}
          />
          <Input
            label="Author role"
            placeholder="Quality lead, Toronto warehouse"
            error={error('authorRole')}
            {...bind('authorRole')}
          />
        </div>

        <Input
          label="Author photo URL"
          placeholder="https://…"
          hint="Optional. Square images work best. Without one the byline draws their initials."
          error={error('authorPhoto')}
          {...bind('authorPhoto')}
        />

        <Textarea
          label="Author bio"
          rows={2}
          placeholder="Fifteen years on the tools, now runs grading at the Toronto warehouse."
          hint="One or two sentences on why they are worth reading on this subject."
          error={error('authorBio')}
          {...bind('authorBio')}
        />

        {/* Four fixed fields rather than an add-your-own list: the byline draws
            a known icon per service, and an open list would need an icon picker
            or a generic glyph for everything. `website` covers the rest. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {AUTHOR_LINKS.map((link) => {
            const field = `author${link.key.charAt(0).toUpperCase()}${link.key.slice(1)}`;
            return (
              <Input
                key={link.key}
                label={link.label}
                placeholder={link.placeholder}
                error={error(field)}
                {...bind(field)}
              />
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

export default AuthorFields;
