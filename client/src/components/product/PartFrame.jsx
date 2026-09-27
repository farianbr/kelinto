import cn from '@/lib/cn';
import { productTitle } from '@/lib/format';
import { productPhoto } from '@/lib/partPhoto';
import { uploadSrcSet } from '@/lib/media';
import PartIllustration from './PartIllustration';

/**
 * The product visual: the model name set as a large watermark BEHIND the part,
 * with the drawing (or the photograph) sat over it.
 *
 * The caption used to sit inside the top of the frame and inset the drawing
 * below it, which cost the part a third of its own height on the surface where
 * a buyer is scanning for the part. It is a backdrop now - full-bleed, centred,
 * in ink at very low opacity - so the picture keeps the whole frame and the
 * watermark reads as texture behind it rather than as a label competing with
 * it. The part type and the model both
 * moved down into the card body, where the rest of the text details live.
 *
 * One component for the card and the detail page: the watermark's type scales
 * with the FRAME's width (@container), so a two-up phone card and a 600px
 * detail panel get the same layout at different sizes.
 *
 * `caption={false}` for the many small placements - cart lines, search rows,
 * order items - where the frame is ~40px and any text in it would be noise.
 */
/**
 * A product's picture: its own photograph, else the brand stock photo for its
 * part type, else the line drawing.
 *
 * The fallback chain lives here rather than at each call site because there are
 * a dozen of them - cards, cart lines, search rows, order items - and a chain
 * copied a dozen times is a chain that drifts.
 *
 * `alt=""` throughout: every placement already names the product in text beside
 * the image, so the picture is decorative and announcing it repeats the name.
 */
/**
 * `sizes` is how wide the picture is drawn, so the browser can choose between
 * an uploaded picture's 480 px and 1600 px copies (`lib/media.js`). The default
 * fits every thumbnail placement - cards, cart lines, search rows - which all
 * draw well under 480 px, so they never fetch the large one.
 */
export function PartVisual({ product, className, sizes = '(min-width: 1024px) 240px, 45vw', priority = false }) {
  const photo = productPhoto(product);

  if (photo) {
    return (
      <img
        src={photo}
        srcSet={uploadSrcSet(photo)}
        sizes={uploadSrcSet(photo) ? sizes : undefined}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className={cn('size-full object-contain', className)}
      />
    );
  }

  return (
    <PartIllustration
      partType={product?.partType}
      label={product?.partTypeLabel}
      className={cn('size-full', className)}
    />
  );
}

export function PartFrame({
  product,
  caption = true,
  className,
  aspect = 'aspect-4/3',
  children,
  // Passed to the picture: see `PartVisual`. The product page draws it large
  // and above the fold, so it passes its own and `priority`.
  sizes,
  priority,
}) {
  const model = productTitle(product.name, product.partTypeLabel);
  const showCaption = caption && Boolean(model);

  return (
    <div className={cn('relative @container overflow-hidden', aspect, className)}>
      {showCaption && (
        // The watermark. Always aria-hidden: on the card the body's <h3> names
        // the product and on the detail page the <h1> does, so this is a
        // decorative echo of a name that is already in the accessibility tree.
        //
        // `break-words` and the container-driven size keep a long model name
        // inside the frame rather than clipping it - it fills the width, which
        // is the point, but it wraps to do it.
        <div
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-[2cqw]"
          aria-hidden="true"
        >
          {/* Sized in `cqw` - a percentage of the FRAME's own width - rather
              than at two breakpoints. Stepped sizes left a dead band between
              them: the detail page on a phone is a ~350px frame, which fell
              under the 420px step and took the 40px type, so a full-bleed
              square photo covered the name and the watermark read as missing.
              Proportional, every frame gets the same treatment at its own size
              and there is no width where it disappears.

              The opacity was pushed to 25% to make the name readable through a
              photo, and that was the wrong goal. At 25% brand red the letters
              compete with the part for the same pixels: the eye tries to read
              "GALAXY S21 ULTRA" as a label, finds a phone sitting across the
              middle of it, and the whole frame reads as a rendering fault
              rather than as a designed surface. It is a watermark, not a
              caption - the product's name is set properly two lines below it,
              so nothing is lost by making this texture again.

              8% ink instead of 25% brand does that. Ink, because a red
              watermark on every card was another way of spending brand colour
              on chrome; and 8%, which registers as a tonal shift in the frame
              without ever asking to be read. */}
          <span className="w-full break-words text-center font-watermark text-[13cqw] font-extrabold uppercase leading-[0.92] tracking-tight text-ink-900/8">
            {model}
          </span>
        </div>
      )}

      {/* The part sits ABOVE the watermark, inset enough to let the watermark
          read past it on both sides. In `cqw` for the same reason as the type:
          a fixed inset is a different proportion of a 170px card than of a
          600px detail panel, so the image crowded the name at one size and
          floated in the middle at the other. 22% a side leaves the part at
          ~56% of the frame. */}
      <div className="relative z-1 size-full p-[22cqw]">
        {children ?? <PartVisual product={product} sizes={sizes} priority={priority} />}
      </div>
    </div>
  );
}

export default PartFrame;
