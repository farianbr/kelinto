import { BookOpen, Wrench } from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import RichText, { extractHeadings } from '@/lib/richText';
import scrollToSection from '@/lib/scrollToSection';
import AuthorCard from '@/components/content/AuthorCard';
import useBusinessInfo from '@/hooks/useBusinessInfo';

/**
 * The long-form article written for ONE product, authored in admin under SEO.
 *
 * WHY IT IS NOT THE DESCRIPTION. `product.description` is a sentence or two in
 * the buy column, read while deciding; this is several hundred words read
 * instead of deciding - how to tell an OEM panel from a copy, what a Pull A
 * actually means on a workshop, which failures a part does and does not fix. Two
 * different jobs, so two different fields and two different places on the page.
 *
 * WHY IT LOOKS LIKE THIS. The first cut was a heading and `RichText` on the
 * bare page ground, and it read as paragraphs pasted onto the page rather than
 * as a section: nothing bounded it, nothing announced it, and at 1400px wide
 * with prose capped at 68ch it was a column of text floating in half a screen
 * of nothing. Three things fix that, and each is doing a job rather than
 * decorating:
 *
 * - The **eyebrow pill and display heading** are the pattern every other
 *   section on this page opens with (`ProductFaq`, the storefront slabs), so
 *   the reader meets a section boundary they already recognise.
 * - The **panel** gives the prose an edge to sit against. Bordered on
 *   `surface`, never shadowed as well (Instructions §2).
 * - The **contents rail** uses the width the measure cannot. The headings are
 *   already in the body and `extractHeadings` reads them, so this costs no
 *   authoring: it turns dead space into the thing that tells a reader whether
 *   the next four hundred words are worth their time.
 *
 * WHY IT SITS LOW ON THE PAGE. It is the longest thing here and the least
 * urgent: a buyer who knows the part is adding to cart at the top, and this is
 * for the one who does not.
 *
 * Rendered through `RichText`, never `dangerouslySetInnerHTML`. The body is
 * stored as plain text in that renderer's small vocabulary precisely so
 * admin-authored copy never has to be trusted as markup (Instructions §8).
 */
export function ProductArticle({ article, product, className }) {
  const info = useBusinessInfo();
  // No article for this product, or only a draft - the server sends published
  // ones only, so there is simply nothing here.
  if (!article?.body) return null;

  // The body's own subheadings, read back out of it. `headingIds` below puts
  // the matching ids on the rendered headings, so the two cannot disagree.
  const headings = extractHeadings(article.body);

  // One subheading is not a table of contents, it is a repeat of the heading
  // above; a byline with no name was never authored. Both rails are priced into
  // the grid template above, so these decide the layout, not just the render.
  const hasContents = headings.length > 1;
  const hasAuthor = Boolean(article.author?.name);

  return (
    <section aria-labelledby="product-article" className={cn('min-w-0', className)}>
      {/* ---- section opener ---------------------------------------------
          The same shape `ProductFaq` opens with, so this reads as a peer of
          the sections around it rather than as loose copy between them. */}
      <div className="mb-6">
        <p className="eyebrow mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-ink-400">
          <span className="size-1 rounded-full bg-brand" aria-hidden="true" />
          From the workshop
        </p>
        <h2
          id="product-article"
          className="text-2xl tracking-[-0.03em] sm:text-3xl"
        >
          {article.heading}
        </h2>
      </div>

      {/* The prose column is sized to the MEASURE, not to the page.
          `minmax(0,1fr)` gave the panel the whole remaining width and the text
          then capped itself at 68ch inside it, which left a third of the panel
          as blank paper down the right. Sizing the track to the measure plus
          its own padding makes the panel the shape of what is in it. */}
      {/* Contents LEFT, prose centre, author RIGHT - the same three-part shape
          the blog post uses, so the two long-form pages on the site read as one
          layout rather than as two that happen to both have sidebars.

          The contents moved from the right to the left with the author rail's
          arrival: an index is navigation for the thing beside it, so reaching
          it before the prose is the right order for a screen reader and a Tab
          key as much as for the eye, and it now matches `BlogPostPage`.

          Each rail track collapses to nothing when its content is absent, so an
          article with one subheading and no byline still sizes its prose panel
          correctly rather than leaving two empty columns. */}
      <div
        className={cn(
          'grid gap-4 lg:gap-6',
          hasContents && hasAuthor && 'lg:grid-cols-[220px_minmax(0,76ch)_260px]',
          hasContents && !hasAuthor && 'lg:grid-cols-[220px_minmax(0,76ch)]',
          !hasContents && hasAuthor && 'lg:grid-cols-[minmax(0,76ch)_260px]',
        )}
      >
        {/* ---- contents ---------------------------------------------------
            Only where there is something to list. One subheading is not a
            table of contents, it is a repeat of the heading above. */}
        {hasContents && (
          <aside className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:self-start">
            <div className="overflow-hidden rounded-xl border border-line bg-surface-2 p-5">
              <p className="eyebrow mb-3 flex items-center gap-1.5 text-ink-400">
                <BookOpen className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                {article.readMinutes} min read
              </p>

              <ul className="space-y-1">
                {headings.map((heading) => (
                  <li key={heading.id}>
                    {/* A button, not an anchor: `scrollToSection` animates the
                        jump and re-asserts it every frame, because a native
                        anchor scroll is cancelled by the motion library
                        measuring keyframes mid-flight. Same helper the FAQ rail
                        and the article table of contents already use. */}
                    <button
                      type="button"
                      onClick={() => scrollToSection(heading.id)}
                      className={cn(
                        pressable,
                        'block w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-500 hover:bg-surface hover:text-ink-900',
                      )}
                    >
                      {heading.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}

        {/* ---- the article ------------------------------------------------ */}
        <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface p-5 sm:p-7 lg:p-8">
          {/* `headingIds` so the contents rail has something to jump to. The
              prose stays capped at a reading measure: the panel is wide, and a
              line of text that long loses the eye on the way back. */}
          <RichText headingIds className="max-w-[68ch]">
            {article.body}
          </RichText>

          {/* The parts-desk line, for an article with no byline authored - 773
              seeded articles are in that state, so this is the common case, not
              the edge one. Where there IS a byline the rail carries it and this
              would be a second, contradictory answer to the same question. */}
          {!hasAuthor && (
            <p className="mt-7 flex items-center gap-2 border-t border-line pt-4 text-xs text-ink-400">
              <Wrench className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              Written by the {info.name} team
              {product?.partTypeLabel ? ` · ${product.partTypeLabel}` : ''}
            </p>
          )}
        </div>

        {/* ---- the author -------------------------------------------------
            The same card the blog rail draws, so a byline looks the same
            wherever the reader meets one. */}
        {hasAuthor && (
          <aside
            className="lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:self-start"
            aria-label="About the author"
          >
            <AuthorCard author={article.author} eyebrow="Written by" />
          </aside>
        )}
      </div>
    </section>
  );
}

export default ProductArticle;
