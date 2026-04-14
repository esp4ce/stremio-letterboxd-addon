import type { FastifyReply } from 'fastify';

// ─── Low-level response helper ────────────────────────────────────────────────

export function sendHtml(reply: FastifyReply, html: string, statusCode = 200): void {
  reply
    .status(statusCode)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    )
    .header('X-Content-Type-Options', 'nosniff')
    .send(html);
}

// ─── Shared layout primitives ─────────────────────────────────────────────────

const BASE_BODY_STYLE =
  'font-family: system-ui, -apple-system, sans-serif; background: #18181b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;';

const AUTO_REDIRECT_SCRIPT = (url: string) => `
<script>
  setTimeout(function() {
    window.location.href = "${url}";
  }, 800);
</script>`;

// ─── Generic error page ───────────────────────────────────────────────────────

export function buildErrorPage(title: string, message?: string): string {
  return `
    <html>
      <head><title>Error</title></head>
      <body style="${BASE_BODY_STYLE}">
        <div style="text-align: center;">
          <h1 style="color: #ef4444;">${title}</h1>
          ${message ? `<p style="color: #a1a1aa;">${message}</p>` : ''}
        </div>
      </body>
    </html>
  `;
}

// ─── Action success page (watched / liked / watchlist) ────────────────────────

export interface ActionSuccessOptions {
  message: string;
  statusLine?: string;
  stremioDeepLink: string | null;
}

export function buildActionSuccessPage({ message, statusLine, stremioDeepLink }: ActionSuccessOptions): string {
  const redirectMeta = stremioDeepLink
    ? `<meta http-equiv="refresh" content="1;url=${stremioDeepLink}">`
    : '';
  const clickLink = stremioDeepLink
    ? `<p style="margin-top: 1.5rem;">
         <a href="${stremioDeepLink}" style="color: #71717a; font-size: 0.75rem; text-decoration: none;">
           Click here if not redirected
         </a>
       </p>`
    : '';
  const statusEl = statusLine
    ? `<p style="color: #52525b; font-size: 0.75rem; margin-top: 1.5rem;">${statusLine}</p>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>${message}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        ${redirectMeta}
      </head>
      <body style="${BASE_BODY_STYLE}">
        <div style="text-align: center; padding: 2rem;">
          <p style="font-size: 2rem; margin: 0 0 1rem 0; color: #22c55e;">&#10003;</p>
          <h1 style="color: #fafafa; margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 500;">${message}</h1>
          <p style="color: #71717a; margin: 0; font-size: 0.875rem;">Returning to Stremio...</p>
          ${statusEl}
          ${clickLink}
        </div>
      </body>
      ${stremioDeepLink ? AUTO_REDIRECT_SCRIPT(stremioDeepLink) : ''}
    </html>
  `;
}

// ─── Rating selection UI page ─────────────────────────────────────────────────

export interface RatingPageOptions {
  safeFilmName: string;
  submitBase: string;
  currentRating: number | null;
  stremioDeepLink: string | null;
}

export function buildRatingPage({ safeFilmName, submitBase, currentRating, stremioDeepLink }: RatingPageOptions): string {
  const removeButton = currentRating
    ? `<div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #3f3f46;">
         <a href="${submitBase}remove" class="remove"
            style="display: inline-block; padding: 0.5rem 1rem;
                   background: transparent; color: #a1a1aa;
                   border-radius: 0.375rem; text-decoration: none; font-size: 0.875rem;
                   border: 1px solid #3f3f46; transition: all 0.15s;">
           Remove rating
         </a>
       </div>`
    : '';

  const backLink = stremioDeepLink
    ? `<p style="margin-top: 2rem;">
         <a href="${stremioDeepLink}" class="back"
            style="color: #71717a; font-size: 0.875rem; text-decoration: none; transition: color 0.15s;">
           Back to Stremio
         </a>
       </p>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Rate ${safeFilmName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          .stars { display: inline-flex; gap: 0.25rem; cursor: pointer; padding: 0.5rem 0; }
          .star {
            font-size: 2.75rem;
            position: relative;
            -webkit-user-select: none;
            user-select: none;
            line-height: 1;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            background: #3f3f46;
            transition: transform 0.15s;
          }
          .remove:hover { color: #fafafa !important; border-color: #71717a !important; }
          a.back:hover { color: #fafafa !important; }
        </style>
      </head>
      <body style="font-family: system-ui, -apple-system, sans-serif; background: #18181b; color: #fafafa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem;">
        <div style="text-align: center; max-width: 420px; width: 100%;">
          <h1 style="margin: 0 0 0.75rem 0; font-size: 1.25rem; font-weight: 500; color: #fafafa;">Rate <em>${safeFilmName}</em></h1>
          <div class="stars" id="stars">
            <span class="star" data-r="1">&#9733;</span>
            <span class="star" data-r="2">&#9733;</span>
            <span class="star" data-r="3">&#9733;</span>
            <span class="star" data-r="4">&#9733;</span>
            <span class="star" data-r="5">&#9733;</span>
          </div>
          ${removeButton}
          ${backLink}
        </div>
      </body>
      <script>
        (function() {
          var stars = document.querySelectorAll('.star');
          var current = ${currentRating ?? 0};
          var base = '${submitBase}';

          function fillStar(star, pct, color) {
            var c = color || '#f59e0b';
            if (pct >= 100) {
              star.style.background = c;
            } else if (pct <= 0) {
              star.style.background = '#3f3f46';
            } else {
              star.style.background = 'linear-gradient(90deg, ' + c + ' ' + pct + '%, #3f3f46 ' + pct + '%)';
            }
            star.style.webkitBackgroundClip = 'text';
            star.style.webkitTextFillColor = 'transparent';
            star.style.backgroundClip = 'text';
          }

          function render(rating, color) {
            stars.forEach(function(s) {
              var r = parseInt(s.getAttribute('data-r'));
              var pct;
              if (rating >= r) { pct = 100; }
              else if (rating >= r - 0.5) { pct = 50; }
              else { pct = 0; }
              fillStar(s, pct, color);
              s.style.transform = rating > 0 && r <= Math.ceil(rating) ? 'scale(1.1)' : 'scale(1)';
            });
          }

          function getRating(star, e) {
            var rect = star.getBoundingClientRect();
            var isLeft = (e.clientX - rect.left) < (rect.width / 2);
            var r = parseInt(star.getAttribute('data-r'));
            return isLeft ? r - 0.5 : r;
          }

          render(current, '#f59e0b');

          stars.forEach(function(s) {
            s.addEventListener('mousemove', function(e) {
              var rating = getRating(s, e);
              render(rating, '#fbbf24');
            });
            s.addEventListener('click', function(e) {
              var rating = getRating(s, e);
              window.location.href = base + rating;
            });
          });

          document.getElementById('stars').addEventListener('mouseleave', function() {
            render(current, '#f59e0b');
          });
        })();
      </script>
    </html>
  `;
}
